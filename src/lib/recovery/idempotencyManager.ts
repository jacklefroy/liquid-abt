import { Logger } from '../logging/logger';
import { createRedisCache } from '../cache/redisClient';
import { createConnectionPool } from '../database/connectionPool';
import { ConflictError, BaseError } from '../errors/CustomErrors';

export interface IdempotencyRecord {
  key: string;
  tenantId: string;
  operationType: string;
  status: 'pending' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  metadata: {
    userId?: string;
    correlationId?: string;
    requestHash?: string;
    clientInfo?: {
      ipAddress?: string;
      userAgent?: string;
    };
  };
}

export interface IdempotencyOptions {
  ttlMs: number; // Time to live for idempotency records
  lockTimeoutMs: number; // How long to wait for concurrent operations
  enableDistributedLock: boolean; // Use Redis for distributed locking
  cleanupIntervalMs: number; // How often to clean up expired records
}

export class IdempotencyManager {
  private logger: Logger;
  private cache = createRedisCache();
  private pool = createConnectionPool();
  private options: IdempotencyOptions;
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor(options: Partial<IdempotencyOptions> = {}) {
    this.logger = new Logger({ module: 'IdempotencyManager' });
    
    this.options = {
      ttlMs: 24 * 60 * 60 * 1000, // 24 hours default
      lockTimeoutMs: 30000, // 30 seconds
      enableDistributedLock: true,
      cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
      ...options
    };

    this.startCleanupProcess();
  }

  // Execute an operation with idempotency protection
  async executeWithIdempotency<T>(
    idempotencyKey: string,
    tenantId: string,
    operationType: string,
    operation: () => Promise<T>,
    metadata: Partial<IdempotencyRecord['metadata']> = {}
  ): Promise<T> {
    const fullKey = this.buildFullKey(tenantId, idempotencyKey);
    
    try {
      // Check if operation already exists
      const existing = await this.getIdempotencyRecord(fullKey);
      
      if (existing) {
        return this.handleExistingRecord(existing);
      }

      // Acquire distributed lock if enabled
      let lockAcquired = false;
      if (this.options.enableDistributedLock) {
        lockAcquired = await this.acquireDistributedLock(fullKey);
        if (!lockAcquired) {
          // Wait and retry
          await this.waitForOperation(fullKey);
          const retryExisting = await this.getIdempotencyRecord(fullKey);
          if (retryExisting) {
            return this.handleExistingRecord(retryExisting);
          }
          throw new ConflictError('Failed to acquire idempotency lock', fullKey);
        }
      }

      try {
        // Create pending record
        const record = await this.createIdempotencyRecord(
          fullKey,
          tenantId,
          operationType,
          'pending',
          metadata
        );

        // Execute the operation
        const result = await operation();

        // Mark as completed with result
        await this.updateIdempotencyRecord(fullKey, 'completed', result);

        this.logger.info('Idempotent operation completed', {
          idempotencyKey: fullKey,
          operationType,
          tenantId
        });

        return result;

      } catch (operationError) {
        // Mark as failed with error
        await this.updateIdempotencyRecord(fullKey, 'failed', null, operationError);
        
        this.logger.error('Idempotent operation failed', {
          idempotencyKey: fullKey,
          operationType,
          tenantId,
          error: (operationError as Error).message
        });

        throw operationError;
      } finally {
        // Release distributed lock
        if (lockAcquired) {
          await this.releaseDistributedLock(fullKey);
        }
      }

    } catch (error) {
      this.logger.error('Idempotency operation failed', {
        idempotencyKey: fullKey,
        operationType,
        tenantId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Create a new idempotency record
  private async createIdempotencyRecord(
    key: string,
    tenantId: string,
    operationType: string,
    status: 'pending' | 'completed' | 'failed',
    metadata: Partial<IdempotencyRecord['metadata']> = {},
    result?: any,
    error?: Error
  ): Promise<IdempotencyRecord> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.options.ttlMs);
    
    const record: IdempotencyRecord = {
      key,
      tenantId,
      operationType,
      status,
      result,
      error: error?.message,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      metadata: {
        correlationId: this.generateCorrelationId(),
        ...metadata
      }
    };

    try {
      // Store in database for persistence
      await this.pool.query(
        `INSERT INTO idempotency_records (
          key, tenant_id, operation_type, status, result, error,
          created_at, updated_at, expires_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (key) DO UPDATE SET
          status = EXCLUDED.status,
          result = EXCLUDED.result,
          error = EXCLUDED.error,
          updated_at = EXCLUDED.updated_at`,
        [
          key,
          tenantId,
          operationType,
          status,
          result ? JSON.stringify(result) : null,
          error?.message,
          now,
          now,
          expiresAt,
          JSON.stringify(record.metadata)
        ]
      );

      // Cache for quick access
      await this.cache.set(
        `idempotency:${key}`,
        record,
        { ttl: Math.floor(this.options.ttlMs / 1000) }
      );

      this.logger.debug('Idempotency record created', {
        key,
        tenantId,
        operationType,
        status
      });

      return record;
    } catch (dbError) {
      this.logger.error('Failed to create idempotency record', {
        key,
        tenantId,
        operationType,
        error: (dbError as Error).message
      });
      throw dbError;
    }
  }

  // Update an existing idempotency record
  private async updateIdempotencyRecord(
    key: string,
    status: 'completed' | 'failed',
    result?: any,
    error?: Error
  ): Promise<void> {
    const now = new Date();
    
    try {
      // Update in database
      await this.pool.query(
        `UPDATE idempotency_records 
         SET status = $1, result = $2, error = $3, updated_at = $4
         WHERE key = $5`,
        [
          status,
          result ? JSON.stringify(result) : null,
          error?.message,
          now,
          key
        ]
      );

      // Update cache
      const existing = await this.cache.get<IdempotencyRecord>(`idempotency:${key}`);
      if (existing) {
        const updated = {
          ...existing,
          status,
          result,
          error: error?.message,
          updatedAt: now
        };
        
        await this.cache.set(
          `idempotency:${key}`,
          updated,
          { ttl: Math.floor(this.options.ttlMs / 1000) }
        );
      }

      this.logger.debug('Idempotency record updated', {
        key,
        status,
        hasResult: !!result,
        hasError: !!error
      });

    } catch (updateError) {
      this.logger.error('Failed to update idempotency record', {
        key,
        status,
        error: (updateError as Error).message
      });
      throw updateError;
    }
  }

  // Get an existing idempotency record
  private async getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
    try {
      // Check cache first
      const cached = await this.cache.get<IdempotencyRecord>(`idempotency:${key}`);
      if (cached) {
        // Check if expired
        if (new Date() > new Date(cached.expiresAt)) {
          await this.deleteIdempotencyRecord(key);
          return null;
        }
        return cached;
      }

      // Query database
      const result = await this.pool.query(
        'SELECT * FROM idempotency_records WHERE key = $1 AND expires_at > NOW()',
        [key]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const record: IdempotencyRecord = {
        key: row.key,
        tenantId: row.tenant_id,
        operationType: row.operation_type,
        status: row.status,
        result: row.result ? JSON.parse(row.result) : undefined,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
        metadata: JSON.parse(row.metadata || '{}')
      };

      // Cache the result
      await this.cache.set(
        `idempotency:${key}`,
        record,
        { ttl: Math.floor(this.options.ttlMs / 1000) }
      );

      return record;
    } catch (error) {
      this.logger.error('Failed to get idempotency record', {
        key,
        error: (error as Error).message
      });
      return null;
    }
  }

  // Handle existing idempotency record
  private async handleExistingRecord<T>(record: IdempotencyRecord): Promise<T> {
    switch (record.status) {
      case 'completed':
        this.logger.info('Idempotent operation already completed', {
          idempotencyKey: record.key,
          operationType: record.operationType
        });
        return record.result;

      case 'failed':
        this.logger.warn('Idempotent operation previously failed', {
          idempotencyKey: record.key,
          operationType: record.operationType,
          error: record.error
        });
        
        // Recreate the original error if possible
        if (record.error) {
          const error = new BaseError(record.error);
          throw error;
        }
        throw new Error('Operation previously failed');

      case 'pending':
        // Wait for the operation to complete
        this.logger.info('Idempotent operation in progress, waiting', {
          idempotencyKey: record.key,
          operationType: record.operationType
        });
        
        const completed = await this.waitForOperation(record.key);
        return this.handleExistingRecord(completed);

      default:
        throw new Error(`Unknown idempotency record status: ${record.status}`);
    }
  }

  // Wait for a pending operation to complete
  private async waitForOperation(key: string): Promise<IdempotencyRecord> {
    const startTime = Date.now();
    const pollInterval = 500; // 500ms
    
    while (Date.now() - startTime < this.options.lockTimeoutMs) {
      const record = await this.getIdempotencyRecord(key);
      
      if (!record) {
        throw new Error('Idempotency record disappeared while waiting');
      }
      
      if (record.status !== 'pending') {
        return record;
      }
      
      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error('Timeout waiting for idempotent operation to complete');
  }

  // Distributed locking using Redis
  private async acquireDistributedLock(key: string): Promise<boolean> {
    const lockKey = `lock:idempotency:${key}`;
    const lockValue = this.generateLockValue();
    const lockTtlSeconds = Math.ceil(this.options.lockTimeoutMs / 1000);

    try {
      // Try to acquire lock using SET NX EX
      const result = await this.cache.get(lockKey);
      if (result) {
        return false; // Lock already exists
      }

      await this.cache.set(lockKey, lockValue, { ttl: lockTtlSeconds });
      return true;
    } catch (error) {
      this.logger.error('Failed to acquire distributed lock', {
        lockKey,
        error: (error as Error).message
      });
      return false;
    }
  }

  private async releaseDistributedLock(key: string): Promise<void> {
    const lockKey = `lock:idempotency:${key}`;
    
    try {
      await this.cache.del(lockKey);
    } catch (error) {
      this.logger.error('Failed to release distributed lock', {
        lockKey,
        error: (error as Error).message
      });
    }
  }

  // Delete an expired idempotency record
  private async deleteIdempotencyRecord(key: string): Promise<void> {
    try {
      await Promise.all([
        this.pool.query('DELETE FROM idempotency_records WHERE key = $1', [key]),
        this.cache.del(`idempotency:${key}`)
      ]);
      
      this.logger.debug('Expired idempotency record deleted', { key });
    } catch (error) {
      this.logger.error('Failed to delete idempotency record', {
        key,
        error: (error as Error).message
      });
    }
  }

  // Start cleanup process for expired records
  private startCleanupProcess(): void {
    this.cleanupIntervalId = setInterval(async () => {
      try {
        const deletedCount = await this.cleanupExpiredRecords();
        if (deletedCount > 0) {
          this.logger.info('Cleaned up expired idempotency records', {
            deletedCount
          });
        }
      } catch (error) {
        this.logger.error('Idempotency cleanup failed', {
          error: (error as Error).message
        });
      }
    }, this.options.cleanupIntervalMs);

    this.logger.info('Idempotency cleanup process started', {
      intervalMs: this.options.cleanupIntervalMs
    });
  }

  // Clean up expired records
  private async cleanupExpiredRecords(): Promise<number> {
    try {
      const result = await this.pool.query(
        'DELETE FROM idempotency_records WHERE expires_at <= NOW()'
      );
      
      return result.rowCount || 0;
    } catch (error) {
      this.logger.error('Failed to cleanup expired idempotency records', {
        error: (error as Error).message
      });
      return 0;
    }
  }

  // Stop cleanup process
  stopCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      this.logger.info('Idempotency cleanup process stopped');
    }
  }

  // Utility methods
  private buildFullKey(tenantId: string, idempotencyKey: string): string {
    return `${tenantId}:${idempotencyKey}`;
  }

  private generateCorrelationId(): string {
    return `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateLockValue(): string {
    return `lock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public methods for inspection and management

  // Get statistics about idempotency usage
  async getStatistics(): Promise<{
    totalRecords: number;
    pendingOperations: number;
    completedOperations: number;
    failedOperations: number;
    oldestRecord: Date | null;
  }> {
    try {
      const result = await this.pool.query(`
        SELECT 
          COUNT(*) as total_records,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_operations,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_operations,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_operations,
          MIN(created_at) as oldest_record
        FROM idempotency_records 
        WHERE expires_at > NOW()
      `);

      const row = result.rows[0];
      return {
        totalRecords: parseInt(row.total_records) || 0,
        pendingOperations: parseInt(row.pending_operations) || 0,
        completedOperations: parseInt(row.completed_operations) || 0,
        failedOperations: parseInt(row.failed_operations) || 0,
        oldestRecord: row.oldest_record || null
      };
    } catch (error) {
      this.logger.error('Failed to get idempotency statistics', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Get records for a specific tenant
  async getTenantRecords(
    tenantId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<IdempotencyRecord[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM idempotency_records 
         WHERE tenant_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC 
         LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset]
      );

      return result.rows.map(row => ({
        key: row.key,
        tenantId: row.tenant_id,
        operationType: row.operation_type,
        status: row.status,
        result: row.result ? JSON.parse(row.result) : undefined,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
        metadata: JSON.parse(row.metadata || '{}')
      }));
    } catch (error) {
      this.logger.error('Failed to get tenant idempotency records', {
        tenantId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Force clear a specific idempotency key (admin function)
  async clearIdempotencyKey(key: string, adminReason: string): Promise<boolean> {
    try {
      const fullKey = key.includes(':') ? key : `unknown:${key}`;
      
      await this.deleteIdempotencyRecord(fullKey);
      
      this.logger.warn('Idempotency key manually cleared', {
        key: fullKey,
        adminReason
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to clear idempotency key', {
        key,
        adminReason,
        error: (error as Error).message
      });
      return false;
    }
  }
}

// Factory function
export function createIdempotencyManager(options?: Partial<IdempotencyOptions>): IdempotencyManager {
  return new IdempotencyManager(options);
}

// Global instance
let globalIdempotencyManager: IdempotencyManager | null = null;

export function getIdempotencyManager(): IdempotencyManager {
  if (!globalIdempotencyManager) {
    globalIdempotencyManager = createIdempotencyManager();
  }
  return globalIdempotencyManager;
}

// Convenience function for idempotent operations
export async function executeIdempotentOperation<T>(
  idempotencyKey: string,
  tenantId: string,
  operationType: string,
  operation: () => Promise<T>,
  metadata?: Partial<IdempotencyRecord['metadata']>
): Promise<T> {
  const manager = getIdempotencyManager();
  return manager.executeWithIdempotency(
    idempotencyKey,
    tenantId,
    operationType,
    operation,
    metadata
  );
}