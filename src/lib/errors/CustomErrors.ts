// Base error class for all application errors
export abstract class BaseError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: string;
  abstract readonly isOperational: boolean;
  
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

  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: any,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(message, options);
  }
}

// Authentication Errors
export class AuthenticationError extends BaseError {
  readonly statusCode = 401;
  readonly errorCode = 'AUTHENTICATION_ERROR';
  readonly isOperational = true;

  constructor(
    message: string = 'Authentication failed',
    options?: { correlationId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(message, options);
  }
}

// Authorization Errors
export class AuthorizationError extends BaseError {
  readonly statusCode = 403;
  readonly errorCode = 'AUTHORIZATION_ERROR';
  readonly isOperational = true;

  constructor(
    message: string = 'Insufficient permissions',
    public readonly requiredPermission?: string,
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
  ) {
    super(message, options);
  }
}

// Not Found Errors
export class NotFoundError extends BaseError {
  readonly statusCode = 404;
  readonly errorCode = 'NOT_FOUND';
  readonly isOperational = true;

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

// Business Logic Errors
export class BusinessLogicError extends BaseError {
  readonly statusCode = 422;
  readonly errorCode = 'BUSINESS_LOGIC_ERROR';
  readonly isOperational = true;
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

// External Service Errors
export class ExternalServiceError extends BaseError {
  readonly statusCode = 502;
  readonly errorCode = 'EXTERNAL_SERVICE_ERROR';
  readonly isOperational = true;

  constructor(
    service: string,
    message: string,
    public readonly serviceStatusCode?: number,
    options?: { correlationId?: string; tenantId?: string; context?: Record<string, any>; cause?: Error }
  ) {
    super(`External service error (${service}): ${message}`, options);
  }
}

// Internal Server Errors
export class InternalServerError extends BaseError {
  readonly statusCode = 500;
  readonly errorCode = 'INTERNAL_SERVER_ERROR';
  readonly isOperational = false;

  constructor(
    message: string = 'Internal server error',
    options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any>; cause?: Error }
  ) {
    super(message, options);
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

export function wrapUnknownError(
  error: unknown,
  options?: { correlationId?: string; tenantId?: string; userId?: string; context?: Record<string, any> }
): BaseError {
  if (error instanceof BaseError) {
    return error;
  }
  
  if (error instanceof Error) {
    return new InternalServerError(error.message, { ...options, cause: error });
  }
  
  return new InternalServerError(String(error), options);
}