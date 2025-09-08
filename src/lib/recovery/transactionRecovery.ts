import { Logger } from '../logging/logger';
import { createRedisCache } from '../cache/redisClient';
import { createConnectionPool } from '../database/connectionPool';
import { getRetryHandler } from '../errors/RetryHandler';
import { BaseError, BitcoinPurchaseFailedError, InternalServerError } from '../errors/CustomErrors';
import { getGlobalErrorReporter } from '../errors/errorReporter';

export enum TransactionState {
  PENDING = 'pending',
  PROCESSING = 'processing',
  AWAITING_CONFIRMATION = 'awaiting_confirmation',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  STUCK = 'stuck',
  RECOVERING = 'recovering'
}

export interface TransactionRecord {
  id: string;
  tenantId: string;
  userId?: string;
  type: 'bitcoin_purchase' | 'payment_processing' | 'webhook_processing' | 'treasury_rule_execution';
  state: TransactionState;
  data: Record<string, any>;
  idempotencyKey: string;
  correlationId: string;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  metadata: {
    originalAmount?: number;
    bitcoinAmount?: number;
    exchangeOrderId?: string;
    paymentId?: string;
    webhookEventId?: string;
    ruleId?: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
    tags: string[];
  };
}

export interface RecoveryOptions {
  maxAttempts: number;
  retryDelayMs: number;
  exponentialBackoff: boolean;
  deadLetterAfterAttempts: number;
  autoRecoveryEnabled: boolean;
  recoveryIntervalMs: number;
}

export interface DeadLetterRecord extends TransactionRecord {
  deadLetteredAt: Date;
  deadLetterReason: string;
  requiresManualIntervention: boolean;
  escalationLevel: 'support' | 'engineering' | 'management';
}

export class TransactionRecoveryService {
  private logger: Logger;
  private cache = createRedisCache();
  private pool = createConnectionPool();
  private retryHandler = getRetryHandler();
  private errorReporter = getGlobalErrorReporter();
  private recoveryOptions: RecoveryOptions;
  private recoveryIntervalId: NodeJS.Timeout | null = null;

  constructor(options: Partial<RecoveryOptions> = {}) {
    this.logger = new Logger({ module: 'TransactionRecoveryService' });
    
    this.recoveryOptions = {
      maxAttempts: 5,
      retryDelayMs: 30000, // 30 seconds
      exponentialBackoff: true,
      deadLetterAfterAttempts: 3,
      autoRecoveryEnabled: true,
      recoveryIntervalMs: 60000, // 1 minute
      ...options
    };

    if (this.recoveryOptions.autoRecoveryEnabled) {
      this.startAutoRecovery();
    }
  }

  // Create a new transaction record
  async createTransaction(
    transactionData: Omit<TransactionRecord, 'id' | 'createdAt' | 'updatedAt' | 'attempts' | 'lastAttemptAt'>
  ): Promise<TransactionRecord> {
    const transaction: TransactionRecord = {
      ...transactionData,
      id: this.generateTransactionId(),
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      // Store in database
      await this.pool.query(
        `INSERT INTO transaction_recovery (
          id, tenant_id, user_id, type, state, data, idempotency_key, 
          correlation_id, attempts, max_attempts, expires_at, metadata,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          transaction.id,
          transaction.tenantId,
          transaction.userId,
          transaction.type,
          transaction.state,
          JSON.stringify(transaction.data),
          transaction.idempotencyKey,
          transaction.correlationId,
          transaction.attempts,
          transaction.maxAttempts,
          transaction.expiresAt,
          JSON.stringify(transaction.metadata),
          transaction.createdAt,
          transaction.updatedAt
        ]
      );

      // Cache for quick access
      await this.cacheTransaction(transaction);

      this.logger.info('Transaction created', {
        transactionId: transaction.id,
        type: transaction.type,
        state: transaction.state,
        tenantId: transaction.tenantId,
        correlationId: transaction.correlationId
      });

      return transaction;
    } catch (error) {
      this.logger.error('Failed to create transaction', {
        error: (error as Error).message,
        transactionData
      });
      throw error;
    }
  }

  // Update transaction state
  async updateTransactionState(
    transactionId: string,
    newState: TransactionState,
    data?: Partial<TransactionRecord['data']>,
    error?: Error
  ): Promise<TransactionRecord> {
    try {
      const transaction = await this.getTransaction(transactionId);
      if (!transaction) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }

      const updatedData = data ? { ...transaction.data, ...data } : transaction.data;
      const updatedTransaction: TransactionRecord = {
        ...transaction,
        state: newState,
        data: updatedData,
        updatedAt: new Date(),
        lastError: error?.message
      };

      // Update in database
      await this.pool.query(
        `UPDATE transaction_recovery 
         SET state = $1, data = $2, updated_at = $3, last_error = $4
         WHERE id = $5`,
        [
          newState,
          JSON.stringify(updatedData),
          updatedTransaction.updatedAt,
          error?.message,
          transactionId
        ]
      );

      // Update cache
      await this.cacheTransaction(updatedTransaction);

      this.logger.info('Transaction state updated', {
        transactionId,
        oldState: transaction.state,
        newState,
        error: error?.message
      });

      return updatedTransaction;
    } catch (updateError) {
      this.logger.error('Failed to update transaction state', {
        transactionId,
        newState,
        error: (updateError as Error).message
      });
      throw updateError;
    }
  }

  // Get transaction by ID
  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    try {
      // Check cache first
      const cached = await this.cache.get<TransactionRecord>(`transaction:${transactionId}`);
      if (cached) {
        return cached;
      }

      // Query database
      const result = await this.pool.query(
        'SELECT * FROM transaction_recovery WHERE id = $1',
        [transactionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const transaction = this.mapRowToTransaction(result.rows[0]);
      
      // Cache result
      await this.cacheTransaction(transaction);
      
      return transaction;
    } catch (error) {
      this.logger.error('Failed to get transaction', {
        transactionId,
        error: (error as Error).message
      });
      return null;
    }
  }

  // Get transaction by idempotency key
  async getTransactionByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<TransactionRecord | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM transaction_recovery WHERE tenant_id = $1 AND idempotency_key = $2',
        [tenantId, idempotencyKey]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const transaction = this.mapRowToTransaction(result.rows[0]);
      
      // Cache result
      await this.cacheTransaction(transaction);
      
      return transaction;
    } catch (error) {
      this.logger.error('Failed to get transaction by idempotency key', {
        tenantId,
        idempotencyKey,
        error: (error as Error).message
      });
      return null;
    }
  }

  // Attempt to recover a stuck transaction
  async recoverTransaction(transactionId: string): Promise<boolean> {
    try {
      const transaction = await this.getTransaction(transactionId);
      if (!transaction) {
        this.logger.warn('Cannot recover non-existent transaction', { transactionId });
        return false;
      }

      // Check if transaction can be recovered
      if (!this.canRecover(transaction)) {
        this.logger.warn('Transaction cannot be recovered', {
          transactionId,
          state: transaction.state,
          attempts: transaction.attempts,
          maxAttempts: transaction.maxAttempts
        });
        return false;
      }

      // Mark as recovering
      await this.updateTransactionState(transactionId, TransactionState.RECOVERING);

      // Increment attempt counter
      const updatedAttempts = transaction.attempts + 1;
      await this.pool.query(
        'UPDATE transaction_recovery SET attempts = $1, last_attempt_at = $2 WHERE id = $3',
        [updatedAttempts, new Date(), transactionId]
      );

      // Execute recovery based on transaction type
      const recovered = await this.executeRecovery(transaction);

      if (recovered) {
        this.logger.info('Transaction recovered successfully', {
          transactionId,
          attempts: updatedAttempts
        });
        return true;
      } else {
        // Check if we should move to dead letter queue
        if (updatedAttempts >= this.recoveryOptions.deadLetterAfterAttempts) {
          await this.moveToDeadLetter(transaction, 'Max recovery attempts exceeded');
        } else {
          await this.updateTransactionState(transactionId, TransactionState.STUCK);
        }
        return false;
      }
    } catch (error) {
      this.logger.error('Transaction recovery failed', {
        transactionId,
        error: (error as Error).message
      });

      await this.errorReporter.reportError(error, {
        correlationId: transactionId,
        additionalContext: { operation: 'transaction_recovery' }
      });

      return false;
    }
  }

  // Execute recovery based on transaction type
  private async executeRecovery(transaction: TransactionRecord): Promise<boolean> {
    switch (transaction.type) {
      case 'bitcoin_purchase':
        return this.recoverBitcoinPurchase(transaction);
      case 'payment_processing':
        return this.recoverPaymentProcessing(transaction);
      case 'webhook_processing':
        return this.recoverWebhookProcessing(transaction);
      case 'treasury_rule_execution':
        return this.recoverTreasuryRuleExecution(transaction);
      default:
        this.logger.error('Unknown transaction type for recovery', {
          transactionId: transaction.id,
          type: transaction.type
        });
        return false;
    }
  }

  // Recover Bitcoin purchase transaction
  private async recoverBitcoinPurchase(transaction: TransactionRecord): Promise<boolean> {
    try {
      const { amount, exchange, orderId } = transaction.data;

      switch (transaction.state) {
        case TransactionState.PROCESSING:
          // Check if order exists on exchange
          if (orderId) {
            const orderStatus = await this.checkExchangeOrderStatus(exchange, orderId);
            if (orderStatus === 'completed') {
              await this.updateTransactionState(transaction.id, TransactionState.COMPLETED);
              return true;
            } else if (orderStatus === 'failed') {
              await this.updateTransactionState(transaction.id, TransactionState.FAILED);
              return false;
            }
          }
          // If no order ID or order is still pending, recreate the order
          return this.recreateBitcoinOrder(transaction);

        case TransactionState.AWAITING_CONFIRMATION:
          // Check confirmation status
          if (orderId) {
            const confirmations = await this.checkOrderConfirmations(exchange, orderId);
            if (confirmations >= 1) {
              await this.updateTransactionState(transaction.id, TransactionState.COMPLETED);
              return true;
            }
          }
          break;

        default:
          this.logger.warn('Cannot recover Bitcoin purchase in this state', {
            transactionId: transaction.id,
            state: transaction.state
          });
          return false;
      }

      return false;
    } catch (error) {
      this.logger.error('Bitcoin purchase recovery failed', {
        transactionId: transaction.id,
        error: (error as Error).message
      });
      return false;
    }
  }

  // Recover payment processing transaction
  private async recoverPaymentProcessing(transaction: TransactionRecord): Promise<boolean> {
    try {
      const { paymentId, processor } = transaction.data;

      // Check payment status with processor
      const paymentStatus = await this.checkPaymentProcessorStatus(processor, paymentId);
      
      switch (paymentStatus) {
        case 'succeeded':
          await this.updateTransactionState(transaction.id, TransactionState.COMPLETED);
          return true;
        case 'failed':
          await this.updateTransactionState(transaction.id, TransactionState.FAILED);
          return false;
        case 'pending':
          // Keep monitoring
          return false;
        default:
          this.logger.warn('Unknown payment status during recovery', {
            transactionId: transaction.id,
            paymentStatus
          });
          return false;
      }
    } catch (error) {
      this.logger.error('Payment processing recovery failed', {
        transactionId: transaction.id,
        error: (error as Error).message
      });
      return false;
    }
  }

  // Recover webhook processing transaction
  private async recoverWebhookProcessing(transaction: TransactionRecord): Promise<boolean> {
    try {
      const { eventId, provider, eventType } = transaction.data;

      // Re-process the webhook event
      const reprocessed = await this.reprocessWebhookEvent(provider, eventType, eventId, transaction.data);
      
      if (reprocessed) {
        await this.updateTransactionState(transaction.id, TransactionState.COMPLETED);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      this.logger.error('Webhook processing recovery failed', {
        transactionId: transaction.id,
        error: (error as Error).message
      });
      return false;
    }
  }

  // Recover treasury rule execution transaction
  private async recoverTreasuryRuleExecution(transaction: TransactionRecord): Promise<boolean> {
    try {
      const { ruleId, triggerData } = transaction.data;

      // Re-execute the treasury rule
      const executed = await this.retryTreasuryRuleExecution(ruleId, triggerData, transaction.tenantId);
      
      if (executed) {
        await this.updateTransactionState(transaction.id, TransactionState.COMPLETED);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      this.logger.error('Treasury rule execution recovery failed', {
        transactionId: transaction.id,
        error: (error as Error).message
      });
      return false;
    }
  }

  // Move transaction to dead letter queue
  async moveToDeadLetter(
    transaction: TransactionRecord,
    reason: string,
    requiresManualIntervention: boolean = true
  ): Promise<void> {
    try {
      const deadLetterRecord: DeadLetterRecord = {
        ...transaction,
        deadLetteredAt: new Date(),
        deadLetterReason: reason,
        requiresManualIntervention,
        escalationLevel: this.determineEscalationLevel(transaction)
      };

      // Insert into dead letter table
      await this.pool.query(
        `INSERT INTO transaction_dead_letter (
          id, tenant_id, user_id, type, state, data, idempotency_key,
          correlation_id, attempts, max_attempts, last_attempt_at, last_error,
          expires_at, metadata, created_at, updated_at, dead_lettered_at,
          dead_letter_reason, requires_manual_intervention, escalation_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          deadLetterRecord.id,
          deadLetterRecord.tenantId,
          deadLetterRecord.userId,
          deadLetterRecord.type,
          TransactionState.FAILED,
          JSON.stringify(deadLetterRecord.data),
          deadLetterRecord.idempotencyKey,
          deadLetterRecord.correlationId,
          deadLetterRecord.attempts,
          deadLetterRecord.maxAttempts,
          deadLetterRecord.lastAttemptAt,
          deadLetterRecord.lastError,
          deadLetterRecord.expiresAt,
          JSON.stringify(deadLetterRecord.metadata),
          deadLetterRecord.createdAt,
          deadLetterRecord.updatedAt,
          deadLetterRecord.deadLetteredAt,
          deadLetterRecord.deadLetterReason,
          deadLetterRecord.requiresManualIntervention,
          deadLetterRecord.escalationLevel
        ]
      );

      // Update original record state
      await this.updateTransactionState(transaction.id, TransactionState.FAILED);

      // Send alert for critical transactions
      if (transaction.metadata.priority === 'critical' || requiresManualIntervention) {
        await this.errorReporter.reportError(
          new BitcoinPurchaseFailedError(transaction.id, reason),
          {
            tenantId: transaction.tenantId,
            correlationId: transaction.correlationId,
            additionalContext: {
              deadLetterReason: reason,
              escalationLevel: deadLetterRecord.escalationLevel,
              attempts: transaction.attempts
            }
          },
          'high'
        );
      }

      this.logger.error('Transaction moved to dead letter queue', {
        transactionId: transaction.id,
        reason,
        escalationLevel: deadLetterRecord.escalationLevel,
        requiresManualIntervention
      });

    } catch (error) {
      this.logger.error('Failed to move transaction to dead letter queue', {
        transactionId: transaction.id,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Get stuck transactions for recovery
  async getStuckTransactions(limit: number = 50): Promise<TransactionRecord[]> {
    try {
      const cutoffTime = new Date(Date.now() - this.recoveryOptions.retryDelayMs);
      
      const result = await this.pool.query(`
        SELECT * FROM transaction_recovery 
        WHERE state IN ($1, $2) 
        AND (last_attempt_at IS NULL OR last_attempt_at < $3)
        AND attempts < max_attempts
        AND expires_at > NOW()
        ORDER BY metadata->>'priority' DESC, created_at ASC
        LIMIT $4
      `, [
        TransactionState.STUCK,
        TransactionState.PROCESSING,
        cutoffTime,
        limit
      ]);

      return result.rows.map(row => this.mapRowToTransaction(row));
    } catch (error) {
      this.logger.error('Failed to get stuck transactions', {
        error: (error as Error).message
      });
      return [];
    }
  }

  // Start auto recovery process
  private startAutoRecovery(): void {
    this.recoveryIntervalId = setInterval(async () => {
      try {
        const stuckTransactions = await this.getStuckTransactions();
        
        this.logger.debug('Auto recovery check', {
          stuckTransactionsCount: stuckTransactions.length
        });

        for (const transaction of stuckTransactions) {
          await this.recoverTransaction(transaction.id);
          
          // Add delay between recoveries to prevent overwhelming
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        this.logger.error('Auto recovery failed', {
          error: (error as Error).message
        });
      }
    }, this.recoveryOptions.recoveryIntervalMs);

    this.logger.info('Auto recovery started', {
      intervalMs: this.recoveryOptions.recoveryIntervalMs
    });
  }

  // Stop auto recovery
  stopAutoRecovery(): void {
    if (this.recoveryIntervalId) {
      clearInterval(this.recoveryIntervalId);
      this.recoveryIntervalId = null;
      this.logger.info('Auto recovery stopped');
    }
  }

  // Manual intervention tools
  async manuallyCompleteTransaction(
    transactionId: string,
    adminUserId: string,
    reason: string,
    completionData?: Record<string, any>
  ): Promise<boolean> {
    try {
      const transaction = await this.getTransaction(transactionId);
      if (!transaction) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }

      // Update transaction with completion data
      await this.updateTransactionState(
        transactionId, 
        TransactionState.COMPLETED, 
        completionData
      );

      // Log manual intervention
      await this.pool.query(
        `INSERT INTO transaction_interventions (
          transaction_id, admin_user_id, action, reason, data, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          transactionId,
          adminUserId,
          'manual_completion',
          reason,
          JSON.stringify(completionData || {}),
          new Date()
        ]
      );

      this.logger.info('Transaction manually completed', {
        transactionId,
        adminUserId,
        reason
      });

      return true;
    } catch (error) {
      this.logger.error('Manual transaction completion failed', {
        transactionId,
        adminUserId,
        error: (error as Error).message
      });
      return false;
    }
  }

  async manuallyCancelTransaction(
    transactionId: string,
    adminUserId: string,
    reason: string
  ): Promise<boolean> {
    try {
      const transaction = await this.getTransaction(transactionId);
      if (!transaction) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }

      await this.updateTransactionState(transactionId, TransactionState.CANCELLED);

      // Log manual intervention
      await this.pool.query(
        `INSERT INTO transaction_interventions (
          transaction_id, admin_user_id, action, reason, created_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [transactionId, adminUserId, 'manual_cancellation', reason, new Date()]
      );

      this.logger.info('Transaction manually cancelled', {
        transactionId,
        adminUserId,
        reason
      });

      return true;
    } catch (error) {
      this.logger.error('Manual transaction cancellation failed', {
        transactionId,
        adminUserId,
        error: (error as Error).message
      });
      return false;
    }
  }

  // Utility methods

  private canRecover(transaction: TransactionRecord): boolean {
    // Cannot recover completed, cancelled, or expired transactions
    const nonRecoverableStates = [
      TransactionState.COMPLETED,
      TransactionState.CANCELLED
    ];

    if (nonRecoverableStates.includes(transaction.state)) {
      return false;
    }

    // Check if expired
    if (transaction.expiresAt && transaction.expiresAt < new Date()) {
      return false;
    }

    // Check if max attempts exceeded
    if (transaction.attempts >= transaction.maxAttempts) {
      return false;
    }

    return true;
  }

  private determineEscalationLevel(transaction: TransactionRecord): 'support' | 'engineering' | 'management' {
    if (transaction.metadata.priority === 'critical') {
      return 'management';
    }
    
    if (transaction.type === 'bitcoin_purchase' && transaction.metadata.originalAmount && transaction.metadata.originalAmount > 10000) {
      return 'management';
    }
    
    if (transaction.attempts >= 5) {
      return 'engineering';
    }
    
    return 'support';
  }

  private async cacheTransaction(transaction: TransactionRecord): Promise<void> {
    const cacheKey = `transaction:${transaction.id}`;
    await this.cache.set(cacheKey, transaction, { ttl: 3600 }); // 1 hour cache
  }

  private mapRowToTransaction(row: any): TransactionRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      type: row.type,
      state: row.state,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    };
  }

  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // External service integration methods (these would call actual services)
  private async checkExchangeOrderStatus(exchange: string, orderId: string): Promise<string> {
    // This would integrate with the actual exchange API
    return 'pending'; // placeholder
  }

  private async checkOrderConfirmations(exchange: string, orderId: string): Promise<number> {
    // This would check blockchain confirmations
    return 0; // placeholder
  }

  private async checkPaymentProcessorStatus(processor: string, paymentId: string): Promise<string> {
    // This would integrate with payment processor API
    return 'pending'; // placeholder
  }

  private async recreateBitcoinOrder(transaction: TransactionRecord): Promise<boolean> {
    // This would recreate a Bitcoin purchase order
    return false; // placeholder
  }

  private async reprocessWebhookEvent(provider: string, eventType: string, eventId: string, data: any): Promise<boolean> {
    // This would reprocess a webhook event
    return false; // placeholder
  }

  private async retryTreasuryRuleExecution(ruleId: string, triggerData: any, tenantId: string): Promise<boolean> {
    // This would retry treasury rule execution
    return false; // placeholder
  }
}

// Factory function
export function createTransactionRecoveryService(options?: Partial<RecoveryOptions>): TransactionRecoveryService {
  return new TransactionRecoveryService(options);
}

// Global instance
let globalTransactionRecovery: TransactionRecoveryService | null = null;

export function getTransactionRecoveryService(): TransactionRecoveryService {
  if (!globalTransactionRecovery) {
    globalTransactionRecovery = createTransactionRecoveryService();
  }
  return globalTransactionRecovery;
}

// Convenience function for creating idempotency keys
export function generateIdempotencyKey(
  tenantId: string,
  operationType: string,
  uniqueData: string
): string {
  const crypto = require('crypto');
  const data = `${tenantId}:${operationType}:${uniqueData}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}