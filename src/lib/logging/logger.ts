// LIQUID ABT - Structured Logging Infrastructure
// Enterprise-grade logging with correlation IDs, audit trails, and performance monitoring

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { NextRequest } from 'next/server';

// Async context for correlation IDs
export const correlationIdStorage = new AsyncLocalStorage<string>();

// Log levels
export const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

// Log categories for structured logging
export enum LogCategory {
  API = 'api',
  BITCOIN = 'bitcoin',
  TREASURY = 'treasury',
  PAYMENT = 'payment',
  WEBHOOK = 'webhook',
  AUTH = 'auth',
  DATABASE = 'database',
  EXCHANGE = 'exchange',
  COMPLIANCE = 'compliance',
  SECURITY = 'security',
  SYSTEM = 'system',
  AUDIT = 'audit'
}

// Structured log interface
export interface StructuredLogData {
  correlationId?: string;
  category: LogCategory;
  action: string;
  tenantId?: string;
  userId?: string;
  transactionId?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  exchangeProvider?: string;
  duration?: number;
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  error?: Error | string;
  metadata?: Record<string, any>;
}

// Custom log format
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const correlationId = correlationIdStorage.getStore() || meta.correlationId || 'unknown';
    
    return JSON.stringify({
      timestamp,
      level,
      message,
      correlationId,
      ...meta
    });
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, correlationId, category, action, ...meta }) => {
    const id = correlationId || correlationIdStorage.getStore() || '';
    const cat = category ? `[${category.toUpperCase()}]` : '';
    const act = action ? `${action}` : '';
    const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
    
    return `${timestamp} ${level} ${id.substring(0, 8)} ${cat} ${act} ${message} ${metaStr}`;
  })
);

// Transport configuration
const transports: winston.transport[] = [];

// Console transport (always enabled for development)
if (process.env.NODE_ENV === 'development') {
  transports.push(
    new winston.transports.Console({
      level: 'debug',
      format: consoleFormat
    })
  );
}

// File transports for production
if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
  // Application logs (daily rotation)
  transports.push(
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '100m',
      maxFiles: '30d',
      level: 'info',
      format: customFormat,
      auditFile: 'logs/.audit-app.json'
    })
  );

  // Error logs (separate file)
  transports.push(
    new DailyRotateFile({
      filename: 'logs/errors-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '100m',
      maxFiles: '90d',
      level: 'error',
      format: customFormat,
      auditFile: 'logs/.audit-errors.json'
    })
  );

  // Audit logs (compliance and security events)
  transports.push(
    new DailyRotateFile({
      filename: 'logs/audit-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '100m',
      maxFiles: '2555d', // 7 years for compliance
      level: 'info',
      format: customFormat,
      auditFile: 'logs/.audit-compliance.json'
    })
  );
}

// Create Winston logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  levels: LOG_LEVELS,
  format: customFormat,
  transports,
  exitOnError: false,
});

// Structured logging class
export class Logger {
  private static instance: Logger;
  private winstonLogger: winston.Logger;

  private constructor() {
    this.winstonLogger = logger;
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Generate correlation ID for request tracking
   */
  static generateCorrelationId(): string {
    return randomUUID();
  }

  /**
   * Set correlation ID in async context
   */
  static setCorrelationId(id: string): void {
    correlationIdStorage.enterWith(id);
  }

  /**
   * Get current correlation ID
   */
  static getCorrelationId(): string | undefined {
    return correlationIdStorage.getStore();
  }

  /**
   * Run function with correlation ID context
   */
  static withCorrelationId<T>(id: string, fn: () => T): T {
    return correlationIdStorage.run(id, fn);
  }

  /**
   * Info level logging
   */
  info(message: string, data: Partial<StructuredLogData> = {}): void {
    this.winstonLogger.info(message, this.sanitizeLogData(data));
  }

  /**
   * Error level logging
   */
  error(message: string, data: Partial<StructuredLogData> = {}): void {
    this.winstonLogger.error(message, this.sanitizeLogData(data));
  }

  /**
   * Warning level logging
   */
  warn(message: string, data: Partial<StructuredLogData> = {}): void {
    this.winstonLogger.warn(message, this.sanitizeLogData(data));
  }

  /**
   * Debug level logging
   */
  debug(message: string, data: Partial<StructuredLogData> = {}): void {
    this.winstonLogger.debug(message, this.sanitizeLogData(data));
  }

  /**
   * HTTP request logging
   */
  http(message: string, data: Partial<StructuredLogData> = {}): void {
    this.winstonLogger.http(message, this.sanitizeLogData(data));
  }

  /**
   * API request/response logging
   */
  logApiRequest(req: NextRequest, data: Partial<StructuredLogData> = {}): void {
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    this.http('API Request', {
      category: LogCategory.API,
      action: 'request',
      endpoint: req.nextUrl.pathname,
      method: req.method,
      ip,
      userAgent: userAgent.substring(0, 100),
      ...data
    });
  }

  /**
   * API response logging
   */
  logApiResponse(
    statusCode: number, 
    duration: number, 
    data: Partial<StructuredLogData> = {}
  ): void {
    this.http('API Response', {
      category: LogCategory.API,
      action: 'response',
      statusCode,
      duration,
      ...data
    });
  }

  /**
   * Bitcoin purchase logging
   */
  logBitcoinPurchase(
    action: 'initiated' | 'completed' | 'failed' | 'refunded',
    data: Partial<StructuredLogData> = {}
  ): void {
    const level = action === 'failed' ? 'error' : 'info';
    
    this.winstonLogger.log(level, `Bitcoin purchase ${action}`, {
      category: LogCategory.BITCOIN,
      action: `purchase_${action}`,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Treasury rule execution logging
   */
  logTreasuryRule(
    action: 'triggered' | 'executed' | 'failed' | 'skipped',
    data: Partial<StructuredLogData> = {}
  ): void {
    const level = action === 'failed' ? 'error' : 'info';
    
    this.winstonLogger.log(level, `Treasury rule ${action}`, {
      category: LogCategory.TREASURY,
      action: `rule_${action}`,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Exchange API interaction logging
   */
  logExchangeApi(
    action: 'price_fetch' | 'order_create' | 'order_status' | 'withdrawal' | 'balance',
    success: boolean,
    data: Partial<StructuredLogData> = {}
  ): void {
    const level = success ? 'info' : 'error';
    
    this.winstonLogger.log(level, `Exchange API ${action} ${success ? 'success' : 'failed'}`, {
      category: LogCategory.EXCHANGE,
      action: `api_${action}`,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Webhook processing logging
   */
  logWebhook(
    action: 'received' | 'processed' | 'failed' | 'ignored',
    provider: string,
    data: Partial<StructuredLogData> = {}
  ): void {
    const level = action === 'failed' ? 'error' : 'info';
    
    this.winstonLogger.log(level, `Webhook ${action} from ${provider}`, {
      category: LogCategory.WEBHOOK,
      action: `webhook_${action}`,
      exchangeProvider: provider,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Authentication/authorization logging
   */
  logAuth(
    action: 'login' | 'logout' | 'register' | 'failed_login' | 'token_refresh',
    data: Partial<StructuredLogData> = {}
  ): void {
    const level = action === 'failed_login' ? 'warn' : 'info';
    
    this.winstonLogger.log(level, `Auth ${action}`, {
      category: LogCategory.AUTH,
      action: `auth_${action}`,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Security event logging
   */
  logSecurity(
    action: 'rate_limit_exceeded' | 'invalid_token' | 'suspicious_activity' | 'blocked_request',
    data: Partial<StructuredLogData> = {}
  ): void {
    this.warn(`Security event: ${action}`, {
      category: LogCategory.SECURITY,
      action: `security_${action}`,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Audit logging for compliance
   */
  logAudit(
    action: string,
    data: Partial<StructuredLogData> = {}
  ): void {
    this.info(`Audit: ${action}`, {
      category: LogCategory.AUDIT,
      action: `audit_${action}`,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Performance timing logging
   */
  logPerformance(
    operation: string,
    duration: number,
    data: Partial<StructuredLogData> = {}
  ): void {
    const level = duration > 5000 ? 'warn' : 'debug'; // Warn if operation takes > 5s
    
    this.winstonLogger.log(level, `Performance: ${operation}`, {
      category: LogCategory.SYSTEM,
      action: 'performance_timing',
      duration,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Database operation logging
   */
  logDatabase(
    operation: 'query' | 'transaction' | 'migration' | 'connection',
    success: boolean,
    data: Partial<StructuredLogData> = {}
  ): void {
    const level = success ? 'debug' : 'error';
    
    this.winstonLogger.log(level, `Database ${operation} ${success ? 'success' : 'failed'}`, {
      category: LogCategory.DATABASE,
      action: `db_${operation}`,
      ...this.sanitizeLogData(data)
    });
  }

  /**
   * Sanitize log data to remove sensitive information
   */
  private sanitizeLogData(data: Partial<StructuredLogData>): Partial<StructuredLogData> {
    const sanitized = { ...data };

    // Remove sensitive fields
    if (sanitized.metadata) {
      const { apiKey, privateKey, password, token, secret, ...safeMeta } = sanitized.metadata;
      sanitized.metadata = safeMeta;
    }

    // Truncate long strings
    if (sanitized.userAgent && sanitized.userAgent.length > 100) {
      sanitized.userAgent = sanitized.userAgent.substring(0, 100) + '...';
    }

    // Ensure correlation ID is present
    if (!sanitized.correlationId) {
      sanitized.correlationId = Logger.getCorrelationId();
    }

    return sanitized;
  }
}

// Performance timer for operation timing
export class PerformanceLogger {
  private startTime: number;
  private operation: string;
  private logger: Logger;
  private metadata: Partial<StructuredLogData>;

  constructor(operation: string, metadata: Partial<StructuredLogData> = {}) {
    this.startTime = performance.now();
    this.operation = operation;
    this.logger = Logger.getInstance();
    this.metadata = metadata;
  }

  /**
   * Finish timing and log performance
   */
  finish(): number {
    const duration = performance.now() - this.startTime;
    
    this.logger.logPerformance(this.operation, duration, {
      ...this.metadata,
      duration
    });

    return duration;
  }

  /**
   * Static method for one-shot timing
   */
  static time<T>(operation: string, fn: () => T, metadata?: Partial<StructuredLogData>): T {
    const timer = new PerformanceLogger(operation, metadata);
    try {
      const result = fn();
      timer.finish();
      return result;
    } catch (error) {
      timer.finish();
      throw error;
    }
  }

  /**
   * Static method for async operation timing
   */
  static async timeAsync<T>(
    operation: string, 
    fn: () => Promise<T>, 
    metadata?: Partial<StructuredLogData>
  ): Promise<T> {
    const timer = new PerformanceLogger(operation, metadata);
    try {
      const result = await fn();
      timer.finish();
      return result;
    } catch (error) {
      timer.finish();
      throw error;
    }
  }
}

// Singleton instance
export const appLogger = Logger.getInstance();

// Express middleware for request logging
export function requestLoggingMiddleware() {
  return (req: any, res: any, next: any) => {
    const correlationId = Logger.generateCorrelationId();
    Logger.setCorrelationId(correlationId);

    const startTime = performance.now();
    
    appLogger.logApiRequest(req, {
      correlationId
    });

    // Log response when finished
    res.on('finish', () => {
      const duration = performance.now() - startTime;
      appLogger.logApiResponse(res.statusCode, duration, {
        correlationId,
        endpoint: req.url,
        method: req.method
      });
    });

    next();
  };
}

// Correlation ID middleware for Next.js
export function withCorrelationId(handler: any) {
  return async (req: NextRequest, context: any) => {
    const correlationId = req.headers.get('x-correlation-id') || Logger.generateCorrelationId();
    
    return Logger.withCorrelationId(correlationId, () => {
      appLogger.logApiRequest(req, { correlationId });
      return handler(req, context);
    });
  };
}