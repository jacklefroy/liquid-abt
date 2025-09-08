import crypto from 'crypto';
import { Logger } from '../logging/logger';
import { createRedisCache } from '../cache/redisClient';
import { createConnectionPool } from '../database/connectionPool';
import { getRetryHandler } from '../errors/RetryHandler';
import { 
  InvalidWebhookSignatureError, 
  WebhookReplayAttackError, 
  DuplicateWebhookEventError,
  BaseError 
} from '../errors/CustomErrors';
import { getGlobalErrorReporter } from '../errors/errorReporter';

export interface WebhookEvent {
  id: string;
  provider: string; // stripe, square, paypal, etc.
  eventType: string;
  timestamp: Date;
  signature: string;
  payload: Record<string, any>;
  headers: Record<string, string>;
  rawBody: string;
  tenantId?: string;
  correlationId: string;
}

export interface ProcessedWebhookEvent extends WebhookEvent {
  processedAt: Date;
  processingDurationMs: number;
  attempts: number;
  status: 'success' | 'failed' | 'retry';
  error?: string;
  result?: any;
}

export interface WebhookConfig {
  provider: string;
  signingSecret: string;
  signatureHeader: string;
  timestampHeader?: string;
  timestampTolerance: number; // seconds
  signatureValidation: 'hmac-sha256' | 'hmac-sha1' | 'rsa';
  retryAttempts: number;
  retryDelayMs: number;
  deduplicationWindowMs: number;
}

export interface WebhookReliabilityOptions {
  maxRetryAttempts: number;
  retryDelayMs: number;
  replayAttackWindowMs: number;
  deduplicationWindowMs: number;
  enableEventLogging: boolean;
  enableSignatureRotation: boolean;
  signatureRotationIntervalMs: number;
  cleanupIntervalMs: number;
}

export class WebhookReliabilityService {
  private logger: Logger;
  private cache = createRedisCache();
  private pool = createConnectionPool();
  private retryHandler = getRetryHandler();
  private errorReporter = getGlobalErrorReporter();
  private options: WebhookReliabilityOptions;
  private webhookConfigs = new Map<string, WebhookConfig>();
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private rotationIntervalId: NodeJS.Timeout | null = null;

  constructor(options: Partial<WebhookReliabilityOptions> = {}) {
    this.logger = new Logger({ module: 'WebhookReliabilityService' });
    
    this.options = {
      maxRetryAttempts: 3,
      retryDelayMs: 5000, // 5 seconds
      replayAttackWindowMs: 5 * 60 * 1000, // 5 minutes
      deduplicationWindowMs: 60 * 60 * 1000, // 1 hour
      enableEventLogging: true,
      enableSignatureRotation: false,
      signatureRotationIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
      cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
      ...options
    };

    this.startCleanupProcess();
    
    if (this.options.enableSignatureRotation) {
      this.startSignatureRotation();
    }
  }

  // Register webhook configuration for a provider
  registerWebhookConfig(config: WebhookConfig): void {
    this.webhookConfigs.set(config.provider, config);
    this.logger.info('Webhook configuration registered', {
      provider: config.provider,
      signatureValidation: config.signatureValidation
    });
  }

  // Process incoming webhook with reliability features
  async processWebhook(
    provider: string,
    headers: Record<string, string>,
    rawBody: string,
    processor: (event: WebhookEvent) => Promise<any>
  ): Promise<{ success: boolean; event: ProcessedWebhookEvent; duplicate?: boolean }> {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();

    try {
      // Get webhook configuration
      const config = this.webhookConfigs.get(provider);
      if (!config) {
        throw new Error(`No webhook configuration found for provider: ${provider}`);
      }

      // Parse webhook event
      const webhookEvent = await this.parseWebhookEvent(
        provider,
        headers,
        rawBody,
        correlationId,
        config
      );

      // Validate signature
      await this.validateSignature(webhookEvent, config);

      // Check for replay attacks
      await this.checkReplayAttack(webhookEvent, config);

      // Check for duplicate events
      const isDuplicate = await this.checkDuplicateEvent(webhookEvent);
      if (isDuplicate) {
        const cachedResult = await this.getCachedEventResult(webhookEvent.id);
        const processedEvent: ProcessedWebhookEvent = {
          ...webhookEvent,
          processedAt: new Date(),
          processingDurationMs: Date.now() - startTime,
          attempts: 0,
          status: 'success',
          result: cachedResult
        };

        this.logger.info('Duplicate webhook event detected', {
          eventId: webhookEvent.id,
          provider,
          eventType: webhookEvent.eventType
        });

        return { success: true, event: processedEvent, duplicate: true };
      }

      // Log event if enabled
      if (this.options.enableEventLogging) {
        await this.logWebhookEvent(webhookEvent);
      }

      // Process event with retry logic
      const result = await this.processEventWithRetry(webhookEvent, processor, config);

      const processedEvent: ProcessedWebhookEvent = {
        ...webhookEvent,
        processedAt: new Date(),
        processingDurationMs: Date.now() - startTime,
        attempts: result.attempts,
        status: result.success ? 'success' : 'failed',
        error: result.error?.message,
        result: result.data
      };

      // Cache successful result for deduplication
      if (result.success) {
        await this.cacheEventResult(webhookEvent.id, result.data);
      }

      // Update event log
      if (this.options.enableEventLogging) {
        await this.updateWebhookEventLog(webhookEvent.id, processedEvent);
      }

      return { success: result.success, event: processedEvent };

    } catch (error) {
      const processedEvent: ProcessedWebhookEvent = {
        id: 'unknown',
        provider,
        eventType: 'unknown',
        timestamp: new Date(),
        signature: '',
        payload: {},
        headers,
        rawBody,
        correlationId,
        processedAt: new Date(),
        processingDurationMs: Date.now() - startTime,
        attempts: 0,
        status: 'failed',
        error: (error as Error).message
      };

      await this.errorReporter.reportWebhookError(
        error as Error,
        provider,
        'unknown',
        { correlationId, additionalContext: { headers } }
      );

      return { success: false, event: processedEvent };
    }
  }

  // Parse webhook event from request
  private async parseWebhookEvent(
    provider: string,
    headers: Record<string, string>,
    rawBody: string,
    correlationId: string,
    config: WebhookConfig
  ): Promise<WebhookEvent> {
    try {
      const payload = JSON.parse(rawBody);
      
      // Extract event details based on provider
      const eventDetails = this.extractEventDetails(provider, payload, headers);
      
      return {
        id: eventDetails.id,
        provider,
        eventType: eventDetails.type,
        timestamp: eventDetails.timestamp,
        signature: headers[config.signatureHeader] || '',
        payload,
        headers,
        rawBody,
        tenantId: eventDetails.tenantId,
        correlationId
      };
    } catch (error) {
      this.logger.error('Failed to parse webhook event', {
        provider,
        correlationId,
        error: (error as Error).message
      });
      throw new Error(`Invalid webhook payload from ${provider}`);
    }
  }

  // Extract event details based on provider format
  private extractEventDetails(
    provider: string,
    payload: any,
    headers: Record<string, string>
  ): { id: string; type: string; timestamp: Date; tenantId?: string } {
    switch (provider.toLowerCase()) {
      case 'stripe':
        return {
          id: payload.id,
          type: payload.type,
          timestamp: new Date(payload.created * 1000),
          tenantId: payload.account // Stripe Connect account
        };
      
      case 'square':
        return {
          id: payload.event_id || payload.id,
          type: payload.type,
          timestamp: new Date(payload.created_at || Date.now()),
          tenantId: payload.merchant_id
        };
      
      case 'paypal':
        return {
          id: payload.id,
          type: payload.event_type,
          timestamp: new Date(payload.create_time || Date.now()),
          tenantId: payload.resource?.merchant_id
        };
      
      default:
        // Generic format
        return {
          id: payload.id || payload.event_id || this.generateEventId(),
          type: payload.type || payload.event_type || 'unknown',
          timestamp: new Date(payload.timestamp || payload.created_at || Date.now()),
          tenantId: payload.tenant_id || payload.account_id
        };
    }
  }

  // Validate webhook signature
  private async validateSignature(event: WebhookEvent, config: WebhookConfig): Promise<void> {
    if (!event.signature) {
      throw new InvalidWebhookSignatureError(
        event.provider,
        { correlationId: event.correlationId }
      );
    }

    const isValid = await this.verifySignature(
      event.rawBody,
      event.signature,
      config.signingSecret,
      config.signatureValidation,
      event.timestamp
    );

    if (!isValid) {
      throw new InvalidWebhookSignatureError(
        event.provider,
        { 
          correlationId: event.correlationId,
          context: { 
            eventId: event.id,
            signatureMethod: config.signatureValidation 
          }
        }
      );
    }

    this.logger.debug('Webhook signature validated', {
      eventId: event.id,
      provider: event.provider,
      signatureMethod: config.signatureValidation
    });
  }

  // Verify signature based on method
  private async verifySignature(
    payload: string,
    signature: string,
    secret: string,
    method: string,
    timestamp?: Date
  ): Promise<boolean> {
    try {
      switch (method) {
        case 'hmac-sha256':
          return this.verifyHmacSha256(payload, signature, secret, timestamp);
        
        case 'hmac-sha1':
          return this.verifyHmacSha1(payload, signature, secret);
        
        case 'rsa':
          return this.verifyRsa(payload, signature, secret);
        
        default:
          this.logger.error('Unknown signature validation method', { method });
          return false;
      }
    } catch (error) {
      this.logger.error('Signature verification failed', {
        method,
        error: (error as Error).message
      });
      return false;
    }
  }

  // HMAC SHA-256 verification (Stripe style)
  private verifyHmacSha256(payload: string, signature: string, secret: string, timestamp?: Date): boolean {
    // Handle Stripe format: t=timestamp,v1=signature
    if (signature.includes('t=') && signature.includes('v1=')) {
      const parts = signature.split(',');
      const timestampPart = parts.find(p => p.startsWith('t='));
      const signaturePart = parts.find(p => p.startsWith('v1='));
      
      if (!timestampPart || !signaturePart) {
        return false;
      }
      
      const eventTimestamp = timestampPart.split('=')[1];
      const eventSignature = signaturePart.split('=')[1];
      
      const signedPayload = `${eventTimestamp}.${payload}`;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload, 'utf8')
        .digest('hex');
      
      return crypto.timingSafeEqual(
        Buffer.from(eventSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    }
    
    // Simple HMAC verification
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
    
    const providedSignature = signature.replace(/^sha256=/, '');
    
    return crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  // HMAC SHA-1 verification
  private verifyHmacSha1(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha1', secret)
      .update(payload, 'utf8')
      .digest('hex');
    
    const providedSignature = signature.replace(/^sha1=/, '');
    
    return crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  // RSA signature verification
  private verifyRsa(payload: string, signature: string, publicKey: string): boolean {
    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(payload);
      return verifier.verify(publicKey, signature, 'base64');
    } catch (error) {
      this.logger.error('RSA verification failed', {
        error: (error as Error).message
      });
      return false;
    }
  }

  // Check for replay attacks
  private async checkReplayAttack(event: WebhookEvent, config: WebhookConfig): Promise<void> {
    const now = Date.now();
    const eventTime = event.timestamp.getTime();
    const timeDiff = Math.abs(now - eventTime);

    // Check if event is too old (potential replay attack)
    if (timeDiff > this.options.replayAttackWindowMs) {
      throw new WebhookReplayAttackError(
        event.provider,
        event.timestamp,
        {
          correlationId: event.correlationId,
          context: {
            eventId: event.id,
            timeDifferenceMs: timeDiff,
            maxAllowedMs: this.options.replayAttackWindowMs
          }
        }
      );
    }

    // Check if we've seen this exact signature recently (replay detection)
    const signatureKey = `webhook_signature:${event.provider}:${event.signature}`;
    const seenBefore = await this.cache.exists(signatureKey);
    
    if (seenBefore) {
      throw new WebhookReplayAttackError(
        event.provider,
        event.timestamp,
        {
          correlationId: event.correlationId,
          context: {
            eventId: event.id,
            reason: 'signature_reuse'
          }
        }
      );
    }

    // Cache the signature to prevent reuse
    await this.cache.set(
      signatureKey,
      { eventId: event.id, timestamp: event.timestamp },
      { ttl: Math.floor(this.options.replayAttackWindowMs / 1000) }
    );
  }

  // Check for duplicate events
  private async checkDuplicateEvent(event: WebhookEvent): Promise<boolean> {
    const dedupeKey = `webhook_event:${event.provider}:${event.id}`;
    const existing = await this.cache.exists(dedupeKey);
    
    if (existing) {
      return true;
    }

    // Mark event as seen
    await this.cache.set(
      dedupeKey,
      { 
        eventType: event.eventType,
        timestamp: event.timestamp,
        processed: true 
      },
      { ttl: Math.floor(this.options.deduplicationWindowMs / 1000) }
    );

    return false;
  }

  // Process event with retry logic
  private async processEventWithRetry(
    event: WebhookEvent,
    processor: (event: WebhookEvent) => Promise<any>,
    config: WebhookConfig
  ): Promise<{ success: boolean; data?: any; error?: Error; attempts: number }> {
    return await this.retryHandler.executeWithRetry(
      () => processor(event),
      {
        maxRetries: this.options.maxRetryAttempts,
        initialDelayMs: this.options.retryDelayMs,
        maxDelayMs: this.options.retryDelayMs * 8,
        exponentialBase: 2,
        jitterMs: 1000,
        retryCondition: (error, attempt) => {
          // Don't retry validation errors or duplicate events
          if (error instanceof BaseError) {
            const nonRetryableErrors = [
              'INVALID_WEBHOOK_SIGNATURE',
              'WEBHOOK_REPLAY_ATTACK',
              'DUPLICATE_WEBHOOK_EVENT',
              'VALIDATION_ERROR'
            ];
            return !nonRetryableErrors.includes(error.errorCode);
          }
          return true;
        },
        onRetry: (error, attempt, delay) => {
          this.logger.warn('Retrying webhook processing', {
            eventId: event.id,
            provider: event.provider,
            attempt,
            delay,
            error: error.message
          });
        }
      },
      `webhook processing (${event.provider}:${event.eventType})`
    );
  }

  // Log webhook event to database
  private async logWebhookEvent(event: WebhookEvent): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO webhook_events (
          id, provider, event_type, timestamp, signature, payload, 
          headers, tenant_id, correlation_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          event.id,
          event.provider,
          event.eventType,
          event.timestamp,
          event.signature,
          JSON.stringify(event.payload),
          JSON.stringify(event.headers),
          event.tenantId,
          event.correlationId,
          new Date()
        ]
      );
    } catch (error) {
      this.logger.error('Failed to log webhook event', {
        eventId: event.id,
        provider: event.provider,
        error: (error as Error).message
      });
      // Don't throw - logging failure shouldn't break webhook processing
    }
  }

  // Update webhook event log with processing results
  private async updateWebhookEventLog(
    eventId: string,
    processedEvent: ProcessedWebhookEvent
  ): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE webhook_events 
         SET processed_at = $1, processing_duration_ms = $2, attempts = $3, 
             status = $4, error = $5, result = $6
         WHERE id = $7`,
        [
          processedEvent.processedAt,
          processedEvent.processingDurationMs,
          processedEvent.attempts,
          processedEvent.status,
          processedEvent.error,
          processedEvent.result ? JSON.stringify(processedEvent.result) : null,
          eventId
        ]
      );
    } catch (error) {
      this.logger.error('Failed to update webhook event log', {
        eventId,
        error: (error as Error).message
      });
    }
  }

  // Cache event result for deduplication
  private async cacheEventResult(eventId: string, result: any): Promise<void> {
    const cacheKey = `webhook_result:${eventId}`;
    await this.cache.set(
      cacheKey,
      result,
      { ttl: Math.floor(this.options.deduplicationWindowMs / 1000) }
    );
  }

  // Get cached event result
  private async getCachedEventResult(eventId: string): Promise<any> {
    const cacheKey = `webhook_result:${eventId}`;
    return await this.cache.get(cacheKey);
  }

  // Signature rotation for enhanced security
  private startSignatureRotation(): void {
    this.rotationIntervalId = setInterval(async () => {
      try {
        await this.rotateWebhookSignatures();
      } catch (error) {
        this.logger.error('Webhook signature rotation failed', {
          error: (error as Error).message
        });
      }
    }, this.options.signatureRotationIntervalMs);

    this.logger.info('Webhook signature rotation started', {
      intervalMs: this.options.signatureRotationIntervalMs
    });
  }

  // Rotate webhook signatures
  private async rotateWebhookSignatures(): Promise<void> {
    for (const [provider, config] of this.webhookConfigs) {
      try {
        // Generate new signing secret
        const newSecret = this.generateSigningSecret();
        
        // Update configuration
        const updatedConfig = { ...config, signingSecret: newSecret };
        this.webhookConfigs.set(provider, updatedConfig);
        
        // Store in database for persistence
        await this.pool.query(
          `UPDATE webhook_configs 
           SET signing_secret = $1, updated_at = $2 
           WHERE provider = $3`,
          [newSecret, new Date(), provider]
        );

        this.logger.info('Webhook signature rotated', { provider });
        
      } catch (error) {
        this.logger.error('Failed to rotate signature', {
          provider,
          error: (error as Error).message
        });
      }
    }
  }

  // Cleanup old webhook events
  private startCleanupProcess(): void {
    this.cleanupIntervalId = setInterval(async () => {
      try {
        await this.cleanupOldWebhookEvents();
      } catch (error) {
        this.logger.error('Webhook cleanup failed', {
          error: (error as Error).message
        });
      }
    }, this.options.cleanupIntervalMs);
  }

  private async cleanupOldWebhookEvents(): Promise<void> {
    const cutoffDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)); // 7 days
    
    try {
      const result = await this.pool.query(
        'DELETE FROM webhook_events WHERE created_at < $1',
        [cutoffDate]
      );
      
      if (result.rowCount && result.rowCount > 0) {
        this.logger.info('Cleaned up old webhook events', {
          deletedCount: result.rowCount
        });
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old webhook events', {
        error: (error as Error).message
      });
    }
  }

  // Utility methods
  private generateCorrelationId(): string {
    return `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSigningSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // Public methods for management and monitoring

  // Get webhook statistics
  async getWebhookStatistics(
    provider?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    averageProcessingTime: number;
    duplicateEvents: number;
    replayAttacks: number;
  }> {
    try {
      let query = `
        SELECT 
          COUNT(*) as total_events,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_events,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_events,
          AVG(processing_duration_ms) as avg_processing_time
        FROM webhook_events 
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (provider) {
        query += ` AND provider = $${paramIndex++}`;
        params.push(provider);
      }

      if (startDate) {
        query += ` AND created_at >= $${paramIndex++}`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND created_at <= $${paramIndex++}`;
        params.push(endDate);
      }

      const result = await this.pool.query(query, params);
      const row = result.rows[0];

      return {
        totalEvents: parseInt(row.total_events) || 0,
        successfulEvents: parseInt(row.successful_events) || 0,
        failedEvents: parseInt(row.failed_events) || 0,
        averageProcessingTime: parseFloat(row.avg_processing_time) || 0,
        duplicateEvents: 0, // Would need separate query
        replayAttacks: 0 // Would need separate query
      };
    } catch (error) {
      this.logger.error('Failed to get webhook statistics', {
        provider,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Get recent webhook events
  async getRecentWebhookEvents(
    provider?: string,
    limit: number = 50
  ): Promise<ProcessedWebhookEvent[]> {
    try {
      let query = `
        SELECT * FROM webhook_events 
        WHERE 1=1
      `;

      const params: any[] = [];
      if (provider) {
        query += ' AND provider = $1';
        params.push(provider);
      }

      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const result = await this.pool.query(query, params);
      
      return result.rows.map(row => ({
        id: row.id,
        provider: row.provider,
        eventType: row.event_type,
        timestamp: row.timestamp,
        signature: row.signature,
        payload: JSON.parse(row.payload || '{}'),
        headers: JSON.parse(row.headers || '{}'),
        rawBody: '', // Not stored for space reasons
        tenantId: row.tenant_id,
        correlationId: row.correlation_id,
        processedAt: row.processed_at,
        processingDurationMs: row.processing_duration_ms || 0,
        attempts: row.attempts || 0,
        status: row.status || 'unknown',
        error: row.error,
        result: row.result ? JSON.parse(row.result) : undefined
      }));
    } catch (error) {
      this.logger.error('Failed to get recent webhook events', {
        provider,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Cleanup methods
  stopAllProcesses(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    if (this.rotationIntervalId) {
      clearInterval(this.rotationIntervalId);
      this.rotationIntervalId = null;
    }

    this.logger.info('Webhook reliability processes stopped');
  }
}

// Factory function
export function createWebhookReliabilityService(
  options?: Partial<WebhookReliabilityOptions>
): WebhookReliabilityService {
  return new WebhookReliabilityService(options);
}

// Global instance
let globalWebhookReliability: WebhookReliabilityService | null = null;

export function getWebhookReliabilityService(): WebhookReliabilityService {
  if (!globalWebhookReliability) {
    globalWebhookReliability = createWebhookReliabilityService();
  }
  return globalWebhookReliability;
}