import { Logger } from '../logging/logger';

// Base error class for all application errors
export abstract class BaseError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: string;
  abstract readonly isOperational: boolean;
  abstract readonly logLevel: 'error' | 'warn' | 'info';
  
  public readonly timestamp: Date;
  public readonly correlationId?: string;
  public readonly tenantId?: string;
  public readonly userId?: string;
  public readonly context?: Record<string, any>;

  constructor(
    message: string,
    options: {
      correlationId?: string;
      tenantId?: string;
      userId?: string;
      context?: Record<string, any>;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.correlationId = options.correlationId;
    this.tenantId = options.tenantId;
    this.userId = options.userId;
    this.context = options.context;
    
    if (options.cause) {
      this.cause = options.cause;
    }

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errorCode: this.errorCode,
      timestamp: this.timestamp.toISOString(),
      correlationId: this.correlationId,
      tenantId: this.tenantId,
      userId: this.userId,
      context: this.context,
      stack: this.stack
    };
  }
}

// Validation Errors
export class ValidationError extends BaseError {
  readonly statusCode = 400;
  readonly errorCode = 'VALIDATION_ERROR';
  readonly isOperational = true;
  readonly logLevel = 'warn' as const;

  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: any,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(message, options);
  }
}

export class InvalidTenantError extends ValidationError {
  readonly errorCode = 'INVALID_TENANT';

  constructor(tenantId: string, options?: { correlationId?: string }) {
    super(`Invalid tenant: ${tenantId}`, 'tenantId', tenantId, { ...options, tenantId });
  }
}

export class InvalidAmountError extends ValidationError {
  readonly errorCode = 'INVALID_AMOUNT';

  constructor(amount: number, field: string = 'amount', options?: { correlationId?: string; tenantId?: string }) {
    super(`Invalid amount: ${amount}`, field, amount, options);
  }
}

export class MissingRequiredFieldError extends ValidationError {
  readonly errorCode = 'MISSING_REQUIRED_FIELD';

  constructor(field: string, options?: { correlationId?: string; tenantId?: string; userId?: string }) {
    super(`Missing required field: ${field}`, field, undefined, options);
  }
}

// Authentication & Authorization Errors
export class AuthenticationError extends BaseError {
  readonly statusCode = 401;
  readonly errorCode = 'AUTHENTICATION_ERROR';
  readonly isOperational = true;
  readonly logLevel = 'warn' as const;

  constructor(
    message: string = 'Authentication failed',
    options?: { correlationId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(message, options);
  }
}

export class InvalidTokenError extends AuthenticationError {
  readonly errorCode = 'INVALID_TOKEN';

  constructor(tokenType: string = 'JWT', options?: { correlationId?: string; context?: Record<string, any> }) {
    super(`Invalid ${tokenType} token`, options);
  }
}

export class TokenExpiredError extends AuthenticationError {
  readonly errorCode = 'TOKEN_EXPIRED';

  constructor(options?: { correlationId?: string; userId?: string }) {
    super('Token has expired', options);
  }
}

export class AuthorizationError extends BaseError {
  readonly statusCode = 403;
  readonly errorCode = 'AUTHORIZATION_ERROR';
  readonly isOperational = true;
  readonly logLevel = 'warn' as const;

  constructor(
    message: string = 'Insufficient permissions',
    public readonly requiredPermission?: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(message, options);
  }
}

export class InsufficientPermissionsError extends AuthorizationError {
  readonly errorCode = 'INSUFFICIENT_PERMISSIONS';

  constructor(
    permission: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string }
  ) {
    super(`Insufficient permissions: ${permission}`, permission, options);
  }
}

// Not Found Errors
export class NotFoundError extends BaseError {
  readonly statusCode = 404;
  readonly errorCode = 'NOT_FOUND';
  readonly isOperational = true;
  readonly logLevel = 'info' as const;

  constructor(
    resource: string,
    identifier?: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    const message = identifier 
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super(message, options);
  }
}

export class TenantNotFoundError extends NotFoundError {
  readonly errorCode = 'TENANT_NOT_FOUND';

  constructor(tenantId: string, options?: { correlationId?: string }) {
    super('Tenant', tenantId, { ...options, tenantId });
  }
}

export class UserNotFoundError extends NotFoundError {
  readonly errorCode = 'USER_NOT_FOUND';

  constructor(userId: string, options?: { correlationId?: string; tenantId?: string }) {
    super('User', userId, { ...options, userId });
  }
}

export class TreasuryRuleNotFoundError extends NotFoundError {
  readonly errorCode = 'TREASURY_RULE_NOT_FOUND';

  constructor(ruleId: string, options?: { correlationId?: string; tenantId?: string; userId?: string }) {
    super('Treasury rule', ruleId, options);
  }
}

export class BitcoinPurchaseNotFoundError extends NotFoundError {
  readonly errorCode = 'BITCOIN_PURCHASE_NOT_FOUND';

  constructor(purchaseId: string, options?: { correlationId?: string; tenantId?: string; userId?: string }) {
    super('Bitcoin purchase', purchaseId, options);
  }
}

// Conflict Errors
export class ConflictError extends BaseError {
  readonly statusCode = 409;
  readonly errorCode = 'CONFLICT_ERROR';
  readonly isOperational = true;
  readonly logLevel = 'warn' as const;

  constructor(
    message: string,
    public readonly conflictingResource?: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(message, options);
  }
}

export class DuplicateResourceError extends ConflictError {
  readonly errorCode = 'DUPLICATE_RESOURCE';

  constructor(
    resource: string,
    identifier: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string }
  ) {
    super(`${resource} already exists: ${identifier}`, resource, options);
  }
}

export class ConcurrentModificationError extends ConflictError {
  readonly errorCode = 'CONCURRENT_MODIFICATION';

  constructor(
    resource: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(`Concurrent modification detected: ${resource}`, resource, options);
  }
}

// Rate Limiting Errors
export class RateLimitError extends BaseError {
  readonly statusCode = 429;
  readonly errorCode = 'RATE_LIMIT_EXCEEDED';
  readonly isOperational = true;
  readonly logLevel = 'warn' as const;

  constructor(
    public readonly limit: number,
    public readonly resetTime: Date,
    options?: { correlationId?: string; tenantId?: string; userId?: string }
  ) {
    super(`Rate limit exceeded. Limit: ${limit}, Reset: ${resetTime.toISOString()}`, options);
  }
}

// Business Logic Errors
export class BusinessLogicError extends BaseError {
  readonly statusCode = 422;
  readonly errorCode = 'BUSINESS_LOGIC_ERROR';
  readonly isOperational = true;
  readonly logLevel = 'warn' as const;
}

export class InsufficientFundsError extends BusinessLogicError {
  readonly errorCode = 'INSUFFICIENT_FUNDS';

  constructor(
    available: number,
    required: number,
    currency: string = 'AUD',
    options?: { correlationId?: string; tenantId?: string; userId?: string }
  ) {
    super(
      `Insufficient funds: ${available} ${currency} available, ${required} ${currency} required`,
      { ...options, context: { available, required, currency } }
    );
  }
}

export class InvalidTreasuryRuleError extends BusinessLogicError {
  readonly errorCode = 'INVALID_TREASURY_RULE';

  constructor(
    ruleId: string,
    reason: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string }
  ) {
    super(`Invalid treasury rule ${ruleId}: ${reason}`, options);
  }
}

export class BitcoinPurchaseFailedError extends BusinessLogicError {
  readonly errorCode = 'BITCOIN_PURCHASE_FAILED';

  constructor(
    purchaseId: string,
    reason: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(`Bitcoin purchase failed ${purchaseId}: ${reason}`, options);
  }
}

export class ExchangeNotAvailableError extends BusinessLogicError {
  readonly errorCode = 'EXCHANGE_NOT_AVAILABLE';

  constructor(
    exchange: string,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any> }
  ) {
    super(`Exchange not available: ${exchange}`, options);
  }
}

// External Service Errors
export class ExternalServiceError extends BaseError {
  readonly statusCode = 502;
  readonly errorCode = 'EXTERNAL_SERVICE_ERROR';
  readonly isOperational = true;
  readonly logLevel = 'error' as const;

  constructor(
    service: string,
    message: string,
    public readonly serviceStatusCode?: number,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any>; cause?: Error }
  ) {
    super(`External service error (${service}): ${message}`, options);
  }
}

export class ExchangeApiError extends ExternalServiceError {
  readonly errorCode = 'EXCHANGE_API_ERROR';

  constructor(
    exchange: string,
    operation: string,
    message: string,
    statusCode?: number,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any>; cause?: Error }
  ) {
    super(`${exchange}`, `${operation} failed: ${message}`, statusCode, options);
  }
}

export class PaymentProcessorError extends ExternalServiceError {
  readonly errorCode = 'PAYMENT_PROCESSOR_ERROR';

  constructor(
    processor: string,
    operation: string,
    message: string,
    statusCode?: number,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any>; cause?: Error }
  ) {
    super(`${processor}`, `${operation} failed: ${message}`, statusCode, options);
  }
}

export class DatabaseConnectionError extends ExternalServiceError {
  readonly errorCode = 'DATABASE_CONNECTION_ERROR';

  constructor(
    message: string,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any>; cause?: Error }
  ) {
    super('PostgreSQL', message, undefined, options);
  }
}

export class CacheConnectionError extends ExternalServiceError {
  readonly errorCode = 'CACHE_CONNECTION_ERROR';

  constructor(
    message: string,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any>; cause?: Error }
  ) {
    super('Redis', message, undefined, options);
  }
}

// Internal Server Errors
export class InternalServerError extends BaseError {
  readonly statusCode = 500;
  readonly errorCode = 'INTERNAL_SERVER_ERROR';
  readonly isOperational = false;
  readonly logLevel = 'error' as const;

  constructor(
    message: string = 'Internal server error',
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any>; cause?: Error }
  ) {
    super(message, options);
  }
}

export class ConfigurationError extends InternalServerError {
  readonly errorCode = 'CONFIGURATION_ERROR';

  constructor(
    configKey: string,
    options?: { correlationId?: string; context?: Record<string, any> }
  ) {
    super(`Configuration error: ${configKey}`, options);
  }
}

export class UnexpectedError extends InternalServerError {
  readonly errorCode = 'UNEXPECTED_ERROR';

  constructor(
    originalError: Error,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(`Unexpected error: ${originalError.message}`, { ...options, cause: originalError });
  }
}

// Webhook Errors
export class WebhookError extends BaseError {
  readonly statusCode = 400;
  readonly errorCode = 'WEBHOOK_ERROR';
  readonly isOperational = true;
  readonly logLevel = 'warn' as const;
}

export class InvalidWebhookSignatureError extends WebhookError {
  readonly errorCode = 'INVALID_WEBHOOK_SIGNATURE';

  constructor(
    provider: string,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any> }
  ) {
    super(`Invalid webhook signature from ${provider}`, options);
  }
}

export class WebhookReplayAttackError extends WebhookError {
  readonly errorCode = 'WEBHOOK_REPLAY_ATTACK';

  constructor(
    provider: string,
    timestamp: Date,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any> }
  ) {
    super(`Webhook replay attack detected from ${provider} at ${timestamp.toISOString()}`, options);
  }
}

export class DuplicateWebhookEventError extends WebhookError {
  readonly errorCode = 'DUPLICATE_WEBHOOK_EVENT';

  constructor(
    provider: string,
    eventId: string,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any> }
  ) {
    super(`Duplicate webhook event from ${provider}: ${eventId}`, options);
  }
}

// Utility functions for error handling
export function isOperationalError(error: Error): boolean {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
}

export function getErrorStatusCode(error: Error): number {
  if (error instanceof BaseError) {
    return error.statusCode;
  }
  return 500;
}

export function getErrorCode(error: Error): string {
  if (error instanceof BaseError) {
    return error.errorCode;
  }
  return 'UNKNOWN_ERROR';
}

export function getErrorLogLevel(error: Error): 'error' | 'warn' | 'info' {
  if (error instanceof BaseError) {
    return error.logLevel;
  }
  return 'error';
}

// Error factory functions
export function createValidationError(
  message: string,
  field?: string,
  value?: any,
  options?: { correlationId?: string; tenantId?: string; userId?: string }
): ValidationError {
  return new ValidationError(message, field, value, options);
}

export function createNotFoundError(
  resource: string,
  identifier?: string,
  options?: { correlationId?: string; tenantId?: string; userId?: string }
): NotFoundError {
  return new NotFoundError(resource, identifier, options);
}

export function createExternalServiceError(
  service: string,
  message: string,
  statusCode?: number,
  options?: { correlationId?: string; tenantId?: string; context?: Record<string, any>; cause?: Error }
): ExternalServiceError {
  return new ExternalServiceError(service, message, statusCode, options);
}

export function wrapUnknownError(
  error: unknown,
  options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
): BaseError {
  if (error instanceof BaseError) {
    return error;
  }
  
  if (error instanceof Error) {
    return new UnexpectedError(error, options);
  }
  
  return new UnexpectedError(new Error(String(error)), options);
}