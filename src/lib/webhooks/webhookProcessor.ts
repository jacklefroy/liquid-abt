import { Logger } from '../logging/logger';
import { getWebhookReliabilityService, WebhookEvent } from './webhookReliability';
import { getTransactionRecoveryService, TransactionState } from '../recovery/transactionRecovery';
import { getIdempotencyManager } from '../recovery/idempotencyManager';
import { createRedisCache } from '../cache/redisClient';
import { createConnectionPool } from '../database/connectionPool';
import { BaseError, PaymentProcessorError } from '../errors/CustomErrors';
import { getGlobalErrorReporter } from '../errors/errorReporter';

export interface WebhookProcessorConfig {
  enableTransactionRecovery: boolean;
  enableIdempotencyProtection: boolean;
  enableEventOrdering: boolean;
  batchProcessing: boolean;
  batchSize: number;
  batchTimeoutMs: number;
}

export interface PaymentWebhookData {
  paymentId: string;
  tenantId: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending' | 'cancelled';
  metadata?: Record<string, any>;
  failureReason?: string;
}

export interface BitcoinPurchaseWebhookData {
  purchaseId: string;
  tenantId: string;
  bitcoinAmount: number;
  fiatAmount: number;
  exchangeOrderId: string;
  status: 'completed' | 'failed' | 'pending';
  confirmations?: number;
  transactionHash?: string;
}

export class WebhookProcessor {
  private logger: Logger;
  private webhookReliability = getWebhookReliabilityService();
  private transactionRecovery = getTransactionRecoveryService();
  private idempotencyManager = getIdempotencyManager();
  private cache = createRedisCache();
  private pool = createConnectionPool();
  private errorReporter = getGlobalErrorReporter();
  private config: WebhookProcessorConfig;
  private batchQueue = new Map<string, WebhookEvent[]>();
  private batchTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(config: Partial<WebhookProcessorConfig> = {}) {
    this.logger = new Logger({ module: 'WebhookProcessor' });
    
    this.config = {
      enableTransactionRecovery: true,
      enableIdempotencyProtection: true,
      enableEventOrdering: false,
      batchProcessing: false,
      batchSize: 10,
      batchTimeoutMs: 5000,
      ...config
    };

    this.initializeWebhookConfigurations();
  }

  private initializeWebhookConfigurations(): void {
    // Configure Stripe webhooks with enhanced security
    this.webhookReliability.registerWebhookConfig({
      provider: 'stripe',
      signingSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      signatureHeader: 'stripe-signature',
      timestampHeader: 'stripe-timestamp',
      timestampTolerance: 300, // 5 minutes (threat model requirement)
      signatureValidation: 'hmac-sha256',
      retryAttempts: 3,
      retryDelayMs: 2000,
      deduplicationWindowMs: 24 * 60 * 60 * 1000, // 24 hours (threat model requirement)
      enableReplayPrevention: true,
      enableTimestampValidation: true,
      maxPayloadSize: 1024 * 1024 // 1MB limit (threat model requirement)
    });

    // Configure Square webhooks
    this.webhookReliability.registerWebhookConfig({
      provider: 'square',
      signingSecret: process.env.SQUARE_WEBHOOK_SECRET || '',
      signatureHeader: 'x-square-signature',
      timestampTolerance: 300,
      signatureValidation: 'hmac-sha1',
      retryAttempts: 3,
      retryDelayMs: 2000,
      deduplicationWindowMs: 60 * 60 * 1000
    });

    // Configure PayPal webhooks
    this.webhookReliability.registerWebhookConfig({
      provider: 'paypal',
      signingSecret: process.env.PAYPAL_WEBHOOK_SECRET || '',
      signatureHeader: 'paypal-auth-algo',
      timestampTolerance: 300,
      signatureValidation: 'rsa',
      retryAttempts: 3,
      retryDelayMs: 2000,
      deduplicationWindowMs: 60 * 60 * 1000
    });
  }

  // Main webhook processing entry point
  async processWebhook(
    provider: string,
    headers: Record<string, string>,
    rawBody: string
  ): Promise<{ success: boolean; message: string; eventId?: string }> {
    try {
      const result = await this.webhookReliability.processWebhook(
        provider,
        headers,
        rawBody,
        (event) => this.handleWebhookEvent(event)
      );

      if (result.duplicate) {
        return {
          success: true,
          message: 'Duplicate event - already processed',
          eventId: result.event.id
        };
      }

      if (result.success) {
        return {
          success: true,
          message: 'Webhook processed successfully',
          eventId: result.event.id
        };
      } else {
        return {
          success: false,
          message: result.event.error || 'Webhook processing failed',
          eventId: result.event.id
        };
      }
    } catch (error) {
      this.logger.error('Webhook processing failed', {
        provider,
        error: (error as Error).message
      });

      await this.errorReporter.reportWebhookError(
        error as Error,
        provider,
        'unknown'
      );

      return {
        success: false,
        message: (error as Error).message
      };
    }
  }

  // Handle individual webhook events
  private async handleWebhookEvent(event: WebhookEvent): Promise<any> {
    this.logger.info('Processing webhook event', {
      eventId: event.id,
      provider: event.provider,
      eventType: event.eventType,
      tenantId: event.tenantId
    });

    // Use idempotency protection if enabled
    if (this.config.enableIdempotencyProtection) {
      const idempotencyKey = `webhook:${event.provider}:${event.id}`;
      
      return await this.idempotencyManager.executeWithIdempotency(
        idempotencyKey,
        event.tenantId || 'system',
        'webhook_processing',
        () => this.processEventByType(event),
        {
          correlationId: event.correlationId,
          requestHash: event.signature
        }
      );
    }

    return await this.processEventByType(event);
  }

  // Process events based on type and provider
  private async processEventByType(event: WebhookEvent): Promise<any> {
    const { provider, eventType } = event;

    try {
      switch (provider.toLowerCase()) {
        case 'stripe':
          return await this.processStripeEvent(event);
        case 'square':
          return await this.processSquareEvent(event);
        case 'paypal':
          return await this.processPayPalEvent(event);
        case 'zerocap':
          return await this.processZeroCapEvent(event);
        case 'kraken':
          return await this.processKrakenEvent(event);
        default:
          throw new Error(`Unknown webhook provider: ${provider}`);
      }
    } catch (error) {
      // Create transaction recovery record if enabled
      if (this.config.enableTransactionRecovery) {
        await this.createRecoveryRecord(event, error as Error);
      }
      throw error;
    }
  }

  // Process Stripe webhook events
  private async processStripeEvent(event: WebhookEvent): Promise<any> {
    const { eventType, payload } = event;

    switch (eventType) {
      case 'payment_intent.succeeded':
        return await this.handlePaymentSuccess({
          paymentId: payload.data.object.id,
          tenantId: event.tenantId!,
          amount: payload.data.object.amount / 100, // Convert from cents
          currency: payload.data.object.currency.toUpperCase(),
          status: 'succeeded',
          metadata: payload.data.object.metadata
        });

      case 'payment_intent.payment_failed':
        return await this.handlePaymentFailure({
          paymentId: payload.data.object.id,
          tenantId: event.tenantId!,
          amount: payload.data.object.amount / 100,
          currency: payload.data.object.currency.toUpperCase(),
          status: 'failed',
          failureReason: payload.data.object.last_payment_error?.message
        });

      case 'account.updated':
        return await this.handleAccountUpdate(event.tenantId!, payload.data.object);

      case 'invoice.payment_succeeded':
        return await this.handleSubscriptionPayment(event.tenantId!, payload.data.object);

      default:
        this.logger.warn('Unhandled Stripe event type', {
          eventType,
          eventId: event.id
        });
        return { handled: false, eventType };
    }
  }

  // Process Square webhook events
  private async processSquareEvent(event: WebhookEvent): Promise<any> {
    const { eventType, payload } = event;

    switch (eventType) {
      case 'payment.created':
        return await this.handlePaymentSuccess({
          paymentId: payload.data.id,
          tenantId: event.tenantId!,
          amount: payload.data.amount_money.amount / 100,
          currency: payload.data.amount_money.currency,
          status: 'succeeded'
        });

      case 'payment.failed':
        return await this.handlePaymentFailure({
          paymentId: payload.data.id,
          tenantId: event.tenantId!,
          amount: payload.data.amount_money.amount / 100,
          currency: payload.data.amount_money.currency,
          status: 'failed',
          failureReason: payload.data.processing_fee?.[0]?.type
        });

      default:
        this.logger.warn('Unhandled Square event type', {
          eventType,
          eventId: event.id
        });
        return { handled: false, eventType };
    }
  }

  // Process PayPal webhook events
  private async processPayPalEvent(event: WebhookEvent): Promise<any> {
    const { eventType, payload } = event;

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        return await this.handlePaymentSuccess({
          paymentId: payload.resource.id,
          tenantId: event.tenantId!,
          amount: parseFloat(payload.resource.amount.value),
          currency: payload.resource.amount.currency_code,
          status: 'succeeded'
        });

      case 'PAYMENT.CAPTURE.DENIED':
        return await this.handlePaymentFailure({
          paymentId: payload.resource.id,
          tenantId: event.tenantId!,
          amount: parseFloat(payload.resource.amount.value),
          currency: payload.resource.amount.currency_code,
          status: 'failed',
          failureReason: payload.resource.reason_code
        });

      default:
        this.logger.warn('Unhandled PayPal event type', {
          eventType,
          eventId: event.id
        });
        return { handled: false, eventType };
    }
  }

  // Process ZeroCap webhook events (Bitcoin exchange)
  private async processZeroCapEvent(event: WebhookEvent): Promise<any> {
    const { eventType, payload } = event;

    switch (eventType) {
      case 'order.filled':
        return await this.handleBitcoinPurchaseComplete({
          purchaseId: payload.client_order_id,
          tenantId: event.tenantId!,
          bitcoinAmount: parseFloat(payload.filled_amount),
          fiatAmount: parseFloat(payload.filled_value),
          exchangeOrderId: payload.order_id,
          status: 'completed',
          transactionHash: payload.transaction_hash
        });

      case 'order.cancelled':
        return await this.handleBitcoinPurchaseFailure({
          purchaseId: payload.client_order_id,
          tenantId: event.tenantId!,
          bitcoinAmount: 0,
          fiatAmount: parseFloat(payload.original_value),
          exchangeOrderId: payload.order_id,
          status: 'failed'
        });

      default:
        this.logger.warn('Unhandled ZeroCap event type', {
          eventType,
          eventId: event.id
        });
        return { handled: false, eventType };
    }
  }

  // Process Kraken webhook events
  private async processKrakenEvent(event: WebhookEvent): Promise<any> {
    const { eventType, payload } = event;

    switch (eventType) {
      case 'executionUpdate':
        if (payload.status === 'filled') {
          return await this.handleBitcoinPurchaseComplete({
            purchaseId: payload.userref,
            tenantId: event.tenantId!,
            bitcoinAmount: parseFloat(payload.vol_exec),
            fiatAmount: parseFloat(payload.cost),
            exchangeOrderId: payload.order_id,
            status: 'completed'
          });
        }
        break;

      default:
        this.logger.warn('Unhandled Kraken event type', {
          eventType,
          eventId: event.id
        });
        return { handled: false, eventType };
    }
  }

  // Handle successful payment
  private async handlePaymentSuccess(data: PaymentWebhookData): Promise<any> {
    this.logger.info('Processing successful payment', {
      paymentId: data.paymentId,
      tenantId: data.tenantId,
      amount: data.amount,
      currency: data.currency
    });

    try {
      // Check if this payment should trigger a Bitcoin purchase
      const shouldPurchase = await this.shouldTriggerBitcoinPurchase(data);
      
      if (shouldPurchase) {
        // Create Bitcoin purchase request
        const purchaseRequest = await this.createBitcoinPurchaseRequest(data);
        
        // Update payment record
        await this.updatePaymentRecord(data.paymentId, data.tenantId, {
          status: 'succeeded',
          bitcoinPurchaseTriggered: true,
          bitcoinPurchaseId: purchaseRequest.id
        });

        return {
          processed: true,
          paymentId: data.paymentId,
          bitcoinPurchaseTriggered: true,
          bitcoinPurchaseId: purchaseRequest.id
        };
      } else {
        // Just update payment record
        await this.updatePaymentRecord(data.paymentId, data.tenantId, {
          status: 'succeeded',
          bitcoinPurchaseTriggered: false
        });

        return {
          processed: true,
          paymentId: data.paymentId,
          bitcoinPurchaseTriggered: false
        };
      }
    } catch (error) {
      this.logger.error('Failed to process payment success', {
        paymentId: data.paymentId,
        tenantId: data.tenantId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Handle failed payment
  private async handlePaymentFailure(data: PaymentWebhookData): Promise<any> {
    this.logger.warn('Processing failed payment', {
      paymentId: data.paymentId,
      tenantId: data.tenantId,
      reason: data.failureReason
    });

    await this.updatePaymentRecord(data.paymentId, data.tenantId, {
      status: 'failed',
      failureReason: data.failureReason
    });

    return {
      processed: true,
      paymentId: data.paymentId,
      failed: true,
      reason: data.failureReason
    };
  }

  // Handle completed Bitcoin purchase
  private async handleBitcoinPurchaseComplete(data: BitcoinPurchaseWebhookData): Promise<any> {
    this.logger.info('Processing completed Bitcoin purchase', {
      purchaseId: data.purchaseId,
      tenantId: data.tenantId,
      bitcoinAmount: data.bitcoinAmount,
      fiatAmount: data.fiatAmount
    });

    try {
      // Update Bitcoin purchase record
      await this.updateBitcoinPurchaseRecord(data.purchaseId, data.tenantId, {
        status: 'completed',
        bitcoinAmount: data.bitcoinAmount,
        transactionHash: data.transactionHash,
        confirmations: data.confirmations || 0
      });

      // Update transaction recovery if enabled
      if (this.config.enableTransactionRecovery) {
        await this.transactionRecovery.updateTransactionState(
          data.purchaseId,
          TransactionState.COMPLETED,
          {
            bitcoinAmount: data.bitcoinAmount,
            transactionHash: data.transactionHash,
            exchangeOrderId: data.exchangeOrderId
          }
        );
      }

      // Trigger any post-purchase actions (e.g., notifications, wallet transfer)
      await this.triggerPostPurchaseActions(data);

      return {
        processed: true,
        purchaseId: data.purchaseId,
        completed: true,
        bitcoinAmount: data.bitcoinAmount,
        transactionHash: data.transactionHash
      };
    } catch (error) {
      this.logger.error('Failed to process Bitcoin purchase completion', {
        purchaseId: data.purchaseId,
        tenantId: data.tenantId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Handle failed Bitcoin purchase
  private async handleBitcoinPurchaseFailure(data: BitcoinPurchaseWebhookData): Promise<any> {
    this.logger.error('Processing failed Bitcoin purchase', {
      purchaseId: data.purchaseId,
      tenantId: data.tenantId
    });

    await this.updateBitcoinPurchaseRecord(data.purchaseId, data.tenantId, {
      status: 'failed'
    });

    // Update transaction recovery
    if (this.config.enableTransactionRecovery) {
      await this.transactionRecovery.updateTransactionState(
        data.purchaseId,
        TransactionState.FAILED
      );
    }

    return {
      processed: true,
      purchaseId: data.purchaseId,
      failed: true
    };
  }

  // Helper methods

  private async shouldTriggerBitcoinPurchase(paymentData: PaymentWebhookData): Promise<boolean> {
    try {
      // Get tenant's treasury rules
      const rules = await this.getTreasuryRules(paymentData.tenantId);
      
      // Check if any rule matches this payment
      for (const rule of rules) {
        if (rule.enabled && this.ruleMatchesPayment(rule, paymentData)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.logger.error('Failed to check treasury rules', {
        tenantId: paymentData.tenantId,
        error: (error as Error).message
      });
      return false;
    }
  }

  private ruleMatchesPayment(rule: any, paymentData: PaymentWebhookData): boolean {
    // Check minimum amount
    if (rule.minimumAmount && paymentData.amount < rule.minimumAmount) {
      return false;
    }

    // Check maximum amount
    if (rule.maximumAmount && paymentData.amount > rule.maximumAmount) {
      return false;
    }

    // Check currency
    if (rule.allowedCurrencies && !rule.allowedCurrencies.includes(paymentData.currency)) {
      return false;
    }

    return true;
  }

  private async createBitcoinPurchaseRequest(paymentData: PaymentWebhookData): Promise<{ id: string }> {
    // This would create a Bitcoin purchase request
    // Implementation would depend on your Bitcoin purchase service
    return { id: `purchase_${Date.now()}` };
  }

  private async updatePaymentRecord(
    paymentId: string,
    tenantId: string,
    updates: Record<string, any>
  ): Promise<void> {
    try {
      // Update payment record in database
      const setClause = Object.keys(updates)
        .map((key, index) => `${key} = $${index + 3}`)
        .join(', ');

      await this.pool.query(
        `UPDATE payments SET ${setClause}, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [paymentId, tenantId, ...Object.values(updates)]
      );
    } catch (error) {
      this.logger.error('Failed to update payment record', {
        paymentId,
        tenantId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  private async updateBitcoinPurchaseRecord(
    purchaseId: string,
    tenantId: string,
    updates: Record<string, any>
  ): Promise<void> {
    try {
      const setClause = Object.keys(updates)
        .map((key, index) => `${key} = $${index + 3}`)
        .join(', ');

      await this.pool.query(
        `UPDATE bitcoin_purchases SET ${setClause}, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [purchaseId, tenantId, ...Object.values(updates)]
      );
    } catch (error) {
      this.logger.error('Failed to update Bitcoin purchase record', {
        purchaseId,
        tenantId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  private async getTreasuryRules(tenantId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM treasury_rules WHERE tenant_id = $1 AND enabled = true',
        [tenantId]
      );
      return result.rows;
    } catch (error) {
      this.logger.error('Failed to get treasury rules', {
        tenantId,
        error: (error as Error).message
      });
      return [];
    }
  }

  private async triggerPostPurchaseActions(data: BitcoinPurchaseWebhookData): Promise<void> {
    // This would trigger actions like:
    // - Send notification to user
    // - Transfer Bitcoin to user's wallet
    // - Update accounting records
    // - Generate tax documents
    
    this.logger.info('Post-purchase actions triggered', {
      purchaseId: data.purchaseId,
      tenantId: data.tenantId
    });
  }

  private async createRecoveryRecord(event: WebhookEvent, error: Error): Promise<void> {
    try {
      await this.transactionRecovery.createTransaction({
        tenantId: event.tenantId || 'system',
        userId: undefined,
        type: 'webhook_processing',
        state: TransactionState.FAILED,
        data: {
          eventId: event.id,
          provider: event.provider,
          eventType: event.eventType,
          payload: event.payload,
          error: error.message
        },
        idempotencyKey: `webhook_recovery:${event.provider}:${event.id}`,
        correlationId: event.correlationId,
        maxAttempts: 3,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        metadata: {
          priority: 'normal',
          tags: ['webhook_processing', event.provider, event.eventType]
        }
      });
    } catch (recoveryError) {
      this.logger.error('Failed to create recovery record', {
        eventId: event.id,
        originalError: error.message,
        recoveryError: (recoveryError as Error).message
      });
    }
  }

  private async handleAccountUpdate(tenantId: string, accountData: any): Promise<any> {
    // Handle Stripe account updates
    this.logger.info('Processing account update', { tenantId });
    
    // Update tenant account information
    await this.pool.query(
      `UPDATE tenants SET 
         stripe_account_data = $1,
         updated_at = NOW() 
       WHERE tenant_id = $2`,
      [JSON.stringify(accountData), tenantId]
    );

    return { processed: true, accountUpdated: true };
  }

  private async handleSubscriptionPayment(tenantId: string, invoiceData: any): Promise<any> {
    // Handle subscription payments
    this.logger.info('Processing subscription payment', { 
      tenantId, 
      invoiceId: invoiceData.id 
    });

    return { processed: true, subscriptionPayment: true };
  }
}

// Factory function
export function createWebhookProcessor(
  config?: Partial<WebhookProcessorConfig>
): WebhookProcessor {
  return new WebhookProcessor(config);
}

// Global instance
let globalWebhookProcessor: WebhookProcessor | null = null;

export function getWebhookProcessor(): WebhookProcessor {
  if (!globalWebhookProcessor) {
    globalWebhookProcessor = createWebhookProcessor();
  }
  return globalWebhookProcessor;
}