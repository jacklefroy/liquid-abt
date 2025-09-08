import { Logger } from '../logging/logger';
import { BaseError, ExternalServiceError } from './CustomErrors';

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
  jitterMs: number;
  retryCondition?: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, nextDelayMs: number) => void;
  onFinalFailure?: (error: Error, totalAttempts: number) => void;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
}

export class RetryHandler {
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ module: 'RetryHandler' });
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions,
    operationName: string = 'operation'
  ): Promise<RetryResult<T>> {
    const startTime = Date.now();
    let lastError: Error;
    let attempt = 0;

    while (attempt <= options.maxRetries) {
      attempt++;
      
      try {
        this.logger.debug(`Executing ${operationName} (attempt ${attempt}/${options.maxRetries + 1})`);
        
        const result = await operation();
        const totalDuration = Date.now() - startTime;
        
        if (attempt > 1) {
          this.logger.info(`${operationName} succeeded after ${attempt} attempts`, {
            attempts: attempt,
            totalDuration
          });
        }
        
        return {
          success: true,
          result,
          attempts: attempt,
          totalDuration
        };

      } catch (error) {
        lastError = error as Error;
        
        // Check if we should retry this error
        const shouldRetry = this.shouldRetry(lastError, attempt, options);
        
        if (!shouldRetry || attempt > options.maxRetries) {
          const totalDuration = Date.now() - startTime;
          
          this.logger.error(`${operationName} failed after ${attempt} attempts`, {
            error: lastError.message,
            attempts: attempt,
            totalDuration,
            finalAttempt: true
          });
          
          if (options.onFinalFailure) {
            options.onFinalFailure(lastError, attempt);
          }
          
          return {
            success: false,
            error: lastError,
            attempts: attempt,
            totalDuration
          };
        }
        
        // Calculate delay for next attempt
        const delayMs = this.calculateDelay(attempt, options);
        
        this.logger.warn(`${operationName} failed, retrying in ${delayMs}ms`, {
          error: lastError.message,
          attempt,
          nextRetryIn: delayMs,
          maxRetries: options.maxRetries
        });
        
        if (options.onRetry) {
          options.onRetry(lastError, attempt, delayMs);
        }
        
        // Wait before next attempt
        await this.delay(delayMs);
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError;
  }

  private shouldRetry(error: Error, attempt: number, options: RetryOptions): boolean {
    // Check custom retry condition first
    if (options.retryCondition) {
      return options.retryCondition(error, attempt);
    }

    // Default retry logic
    return this.isRetryableError(error);
  }

  private isRetryableError(error: Error): boolean {
    // Don't retry validation errors or authentication errors
    if (error instanceof BaseError && error.isOperational) {
      const nonRetryableErrors = [
        'VALIDATION_ERROR',
        'AUTHENTICATION_ERROR',
        'AUTHORIZATION_ERROR',
        'NOT_FOUND',
        'CONFLICT_ERROR',
        'BUSINESS_LOGIC_ERROR'
      ];
      
      return !nonRetryableErrors.includes(error.errorCode);
    }

    // Retry external service errors
    if (error instanceof ExternalServiceError) {
      // Don't retry client errors (4xx), but retry server errors (5xx) and network errors
      if (error.serviceStatusCode && error.serviceStatusCode >= 400 && error.serviceStatusCode < 500) {
        return false;
      }
      return true;
    }

    // Check for specific error types that should be retried
    const retryableMessages = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'socket hang up',
      'network timeout',
      'connection timeout'
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableMessages.some(msg => errorMessage.includes(msg.toLowerCase()));
  }

  private calculateDelay(attempt: number, options: RetryOptions): number {
    // Calculate exponential backoff delay
    const exponentialDelay = options.initialDelayMs * Math.pow(options.exponentialBase, attempt - 1);
    
    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * options.jitterMs;
    
    return Math.floor(cappedDelay + jitter);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Convenience method for database operations
  async retryDatabaseOperation<T>(
    operation: () => Promise<T>,
    operationName: string = 'database operation'
  ): Promise<T> {
    const options: RetryOptions = {
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 2000,
      exponentialBase: 2,
      jitterMs: 50,
      retryCondition: (error) => {
        const retryableDbErrors = [
          'connection terminated',
          'connection timeout',
          'connection refused',
          'temporary failure',
          'deadlock detected'
        ];
        return retryableDbErrors.some(msg => 
          error.message.toLowerCase().includes(msg)
        );
      }
    };

    const result = await this.executeWithRetry(operation, options, operationName);
    
    if (!result.success) {
      throw result.error;
    }
    
    return result.result!;
  }

  // Convenience method for external API calls
  async retryApiCall<T>(
    operation: () => Promise<T>,
    apiName: string,
    operationName: string = 'API call'
  ): Promise<T> {
    const options: RetryOptions = {
      maxRetries: 5,
      initialDelayMs: 200,
      maxDelayMs: 10000,
      exponentialBase: 2,
      jitterMs: 100,
      retryCondition: (error, attempt) => {
        // Don't retry on the last attempt to avoid infinite loops
        if (attempt >= 5) return false;
        
        if (error instanceof ExternalServiceError) {
          // Retry 5xx errors and network errors, but not 4xx client errors
          return !error.serviceStatusCode || error.serviceStatusCode >= 500;
        }
        
        return this.isRetryableError(error);
      },
      onRetry: (error, attempt, delay) => {
        this.logger.warn(`${apiName} ${operationName} retry`, {
          attempt,
          delay,
          error: error.message
        });
      }
    };

    const result = await this.executeWithRetry(operation, options, `${apiName} ${operationName}`);
    
    if (!result.success) {
      throw result.error;
    }
    
    return result.result!;
  }

  // Convenience method for Bitcoin exchange operations
  async retryExchangeOperation<T>(
    operation: () => Promise<T>,
    exchange: string,
    operationType: string
  ): Promise<T> {
    const options: RetryOptions = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      exponentialBase: 2,
      jitterMs: 500,
      retryCondition: (error, attempt) => {
        // Special handling for exchange rate limits
        if (error.message.includes('rate limit')) {
          // For rate limits, wait longer and allow more retries
          return attempt <= 5;
        }
        
        if (error instanceof ExternalServiceError) {
          // Don't retry insufficient funds or invalid orders
          const nonRetryableErrors = ['insufficient funds', 'invalid order', 'order not found'];
          if (nonRetryableErrors.some(msg => error.message.toLowerCase().includes(msg))) {
            return false;
          }
          
          return error.serviceStatusCode ? error.serviceStatusCode >= 500 : true;
        }
        
        return this.isRetryableError(error);
      },
      onRetry: (error, attempt, delay) => {
        this.logger.warn(`${exchange} ${operationType} retry`, {
          attempt,
          delay,
          error: error.message,
          exchange,
          operation: operationType
        });
      }
    };

    const result = await this.executeWithRetry(
      operation, 
      options, 
      `${exchange} ${operationType}`
    );
    
    if (!result.success) {
      throw result.error;
    }
    
    return result.result!;
  }

  // Convenience method for webhook processing
  async retryWebhookProcessing<T>(
    operation: () => Promise<T>,
    provider: string,
    eventType: string
  ): Promise<T> {
    const options: RetryOptions = {
      maxRetries: 2, // Webhooks should be processed quickly
      initialDelayMs: 500,
      maxDelayMs: 2000,
      exponentialBase: 2,
      jitterMs: 100,
      retryCondition: (error) => {
        // Don't retry validation errors or duplicate events
        if (error instanceof BaseError) {
          const nonRetryableWebhookErrors = [
            'INVALID_WEBHOOK_SIGNATURE',
            'DUPLICATE_WEBHOOK_EVENT',
            'WEBHOOK_REPLAY_ATTACK',
            'VALIDATION_ERROR'
          ];
          return !nonRetryableWebhookErrors.includes(error.errorCode);
        }
        
        return this.isRetryableError(error);
      }
    };

    const result = await this.executeWithRetry(
      operation, 
      options, 
      `${provider} webhook ${eventType}`
    );
    
    if (!result.success) {
      throw result.error;
    }
    
    return result.result!;
  }
}

// Global retry handler instance
let globalRetryHandler: RetryHandler | null = null;

export function getRetryHandler(): RetryHandler {
  if (!globalRetryHandler) {
    globalRetryHandler = new RetryHandler();
  }
  return globalRetryHandler;
}

// Convenience functions for common retry scenarios
export async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  operationName?: string
): Promise<T> {
  return getRetryHandler().retryDatabaseOperation(operation, operationName);
}

export async function retryApiCall<T>(
  operation: () => Promise<T>,
  apiName: string,
  operationName?: string
): Promise<T> {
  return getRetryHandler().retryApiCall(operation, apiName, operationName);
}

export async function retryExchangeOperation<T>(
  operation: () => Promise<T>,
  exchange: string,
  operationType: string
): Promise<T> {
  return getRetryHandler().retryExchangeOperation(operation, exchange, operationType);
}

export async function retryWebhookProcessing<T>(
  operation: () => Promise<T>,
  provider: string,
  eventType: string
): Promise<T> {
  return getRetryHandler().retryWebhookProcessing(operation, provider, eventType);
}