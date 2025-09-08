import * as Sentry from '@sentry/node';
import { Logger } from '../logging/logger';
import { BaseError, isOperationalError, getErrorLogLevel } from './CustomErrors';
import { AlertingSystem } from '../monitoring/alerting';

interface ErrorContext {
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  requestUrl?: string;
  userAgent?: string;
  ipAddress?: string;
  method?: string;
  additionalContext?: Record<string, any>;
}

interface ErrorReportingConfig {
  sentryDsn?: string;
  environment: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  enableSentryReporting: boolean;
  enableSlackAlerts: boolean;
  enableMetricsCollection: boolean;
  rateLimitWindowMs: number;
  maxErrorsPerWindow: number;
}

export class ErrorReporter {
  private logger: Logger;
  private alerting?: AlertingSystem;
  private config: ErrorReportingConfig;
  private errorCounts = new Map<string, { count: number; lastReset: number }>();

  constructor(config: ErrorReportingConfig, alerting?: AlertingSystem) {
    this.config = config;
    this.alerting = alerting;
    this.logger = new Logger({ module: 'ErrorReporter' });

    // Initialize Sentry if configured
    if (config.enableSentryReporting && config.sentryDsn) {
      this.initializeSentry();
    }

    // Start error count cleanup interval
    setInterval(() => this.cleanupErrorCounts(), 60000); // Every minute
  }

  private initializeSentry(): void {
    Sentry.init({
      dsn: this.config.sentryDsn,
      environment: this.config.environment,
      tracesSampleRate: this.config.environment === 'production' ? 0.1 : 1.0,
      beforeSend: (event) => this.beforeSendToSentry(event),
      integrations: [
        Sentry.nodeContextIntegration(),
        Sentry.consoleIntegration(),
        Sentry.httpIntegration(),
      ],
    });
  }

  private beforeSendToSentry(event: Sentry.Event): Sentry.Event | null {
    // Filter out operational errors from Sentry if they're too frequent
    if (event.exception?.values?.[0]) {
      const error = event.exception.values[0];
      const errorKey = `${error.type}:${error.value}`;
      
      if (this.isRateLimited(errorKey)) {
        this.logger.debug('Error rate limited for Sentry reporting', { errorKey });
        return null;
      }
    }

    // Scrub sensitive information
    if (event.extra) {
      event.extra = this.scrubSensitiveData(event.extra);
    }

    if (event.contexts?.user) {
      // Remove sensitive user data but keep identifiers
      delete event.contexts.user.email;
      delete event.contexts.user.ip_address;
    }

    return event;
  }

  // Main error reporting method
  async reportError(
    error: Error,
    context: ErrorContext = {},
    severity: 'low' | 'normal' | 'high' | 'critical' = 'normal'
  ): Promise<void> {
    try {
      const enhancedContext = await this.enhanceContext(error, context);
      const logLevel = getErrorLogLevel(error);

      // Always log to application logs
      this.logError(error, enhancedContext, logLevel);

      // Report to external services based on configuration
      if (this.config.enableSentryReporting && this.shouldReportToSentry(error)) {
        await this.reportToSentry(error, enhancedContext);
      }

      // Send alerts for critical errors
      if (this.config.enableSlackAlerts && this.shouldSendAlert(error, severity)) {
        await this.sendAlert(error, enhancedContext, severity);
      }

      // Collect metrics
      if (this.config.enableMetricsCollection) {
        await this.collectMetrics(error, enhancedContext);
      }

    } catch (reportingError) {
      // Never let error reporting crash the application
      this.logger.error('Error reporting failed', {
        originalError: error.message,
        reportingError: (reportingError as Error).message,
        correlationId: context.correlationId
      });
    }
  }

  private async enhanceContext(error: Error, context: ErrorContext): Promise<ErrorContext> {
    const enhanced: ErrorContext = { ...context };

    // Add error-specific context
    if (error instanceof BaseError) {
      enhanced.correlationId = enhanced.correlationId || error.correlationId;
      enhanced.tenantId = enhanced.tenantId || error.tenantId;
      enhanced.userId = enhanced.userId || error.userId;
      
      if (error.context) {
        enhanced.additionalContext = {
          ...enhanced.additionalContext,
          ...error.context
        };
      }
    }

    // Add system context
    enhanced.additionalContext = {
      ...enhanced.additionalContext,
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };

    return enhanced;
  }

  private logError(error: Error, context: ErrorContext, level: 'error' | 'warn' | 'info'): void {
    const logData = {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      userId: context.userId,
      requestUrl: context.requestUrl,
      method: context.method,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      additionalContext: context.additionalContext
    };

    switch (level) {
      case 'error':
        this.logger.error('Application error occurred', logData);
        break;
      case 'warn':
        this.logger.warn('Application warning occurred', logData);
        break;
      case 'info':
        this.logger.info('Application info event occurred', logData);
        break;
    }
  }

  private async reportToSentry(error: Error, context: ErrorContext): Promise<void> {
    Sentry.withScope((scope) => {
      // Set user context
      if (context.userId || context.tenantId) {
        scope.setUser({
          id: context.userId,
          username: context.tenantId
        });
      }

      // Set tags for better filtering
      scope.setTag('tenant_id', context.tenantId);
      scope.setTag('correlation_id', context.correlationId);
      
      if (error instanceof BaseError) {
        scope.setTag('error_code', error.errorCode);
        scope.setTag('operational', error.isOperational);
      }

      // Set additional context
      scope.setContext('request', {
        url: context.requestUrl,
        method: context.method,
        user_agent: context.userAgent,
        ip_address: context.ipAddress
      });

      if (context.additionalContext) {
        scope.setContext('additional', context.additionalContext);
      }

      // Set level based on error type
      if (error instanceof BaseError) {
        const sentryLevel = this.mapLogLevelToSentryLevel(error.logLevel);
        scope.setLevel(sentryLevel);
      }

      Sentry.captureException(error);
    });
  }

  private async sendAlert(
    error: Error,
    context: ErrorContext,
    severity: 'low' | 'normal' | 'high' | 'critical'
  ): Promise<void> {
    if (!this.alerting) return;

    const alertLevel = severity === 'critical' ? 'error' : 
                     severity === 'high' ? 'error' :
                     severity === 'normal' ? 'warning' : 'info';

    const alertTitle = `${severity.toUpperCase()}: ${error.name}`;
    const alertData = {
      error: error.message,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      userId: context.userId,
      url: context.requestUrl,
      timestamp: new Date().toISOString()
    };

    await this.alerting.sendAlert(alertLevel, alertTitle, alertData);
  }

  private async collectMetrics(error: Error, context: ErrorContext): Promise<void> {
    // Increment error counters by type
    const errorType = error.constructor.name;
    const metricName = `errors.${errorType.toLowerCase()}`;
    
    // This would integrate with your metrics collection system
    // For now, we'll just log the metric
    this.logger.debug('Error metric collected', {
      metric: metricName,
      value: 1,
      tags: {
        error_type: errorType,
        tenant_id: context.tenantId,
        operational: error instanceof BaseError ? error.isOperational : false
      }
    });
  }

  private shouldReportToSentry(error: Error): boolean {
    // Don't report operational errors that are expected
    if (error instanceof BaseError && error.isOperational) {
      // Only report operational errors if they're not too frequent
      const errorKey = `${error.constructor.name}:${error.errorCode}`;
      return !this.isRateLimited(errorKey);
    }

    return true;
  }

  private shouldSendAlert(error: Error, severity: 'low' | 'normal' | 'high' | 'critical'): boolean {
    // Always alert on critical errors
    if (severity === 'critical') return true;

    // Alert on high severity non-operational errors
    if (severity === 'high' && !isOperationalError(error)) return true;

    // Rate limit other alerts
    const errorKey = `alert:${error.constructor.name}`;
    return !this.isRateLimited(errorKey);
  }

  private isRateLimited(errorKey: string): boolean {
    const now = Date.now();
    const errorData = this.errorCounts.get(errorKey);

    if (!errorData || (now - errorData.lastReset) > this.config.rateLimitWindowMs) {
      this.errorCounts.set(errorKey, { count: 1, lastReset: now });
      return false;
    }

    if (errorData.count >= this.config.maxErrorsPerWindow) {
      return true;
    }

    errorData.count++;
    return false;
  }

  private cleanupErrorCounts(): void {
    const now = Date.now();
    const cutoff = now - (this.config.rateLimitWindowMs * 2); // Keep data for 2 windows

    for (const [key, data] of this.errorCounts.entries()) {
      if (data.lastReset < cutoff) {
        this.errorCounts.delete(key);
      }
    }
  }

  private mapLogLevelToSentryLevel(level: 'error' | 'warn' | 'info'): Sentry.SeverityLevel {
    switch (level) {
      case 'error': return 'error';
      case 'warn': return 'warning';
      case 'info': return 'info';
      default: return 'error';
    }
  }

  private scrubSensitiveData(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const scrubbed = { ...data };
    const sensitiveKeys = [
      'password', 'token', 'secret', 'key', 'authorization',
      'credit_card', 'ssn', 'phone', 'email', 'address',
      'api_key', 'private_key', 'webhook_secret'
    ];

    for (const key of Object.keys(scrubbed)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        scrubbed[key] = '[REDACTED]';
      } else if (typeof scrubbed[key] === 'object') {
        scrubbed[key] = this.scrubSensitiveData(scrubbed[key]);
      }
    }

    return scrubbed;
  }

  // Utility methods for common error reporting scenarios
  async reportValidationError(
    error: Error,
    field: string,
    value: any,
    context: ErrorContext = {}
  ): Promise<void> {
    await this.reportError(error, {
      ...context,
      additionalContext: {
        ...context.additionalContext,
        validationField: field,
        validationValue: value
      }
    }, 'low');
  }

  async reportAuthenticationError(
    error: Error,
    context: ErrorContext = {}
  ): Promise<void> {
    await this.reportError(error, context, 'normal');
  }

  async reportExternalServiceError(
    error: Error,
    service: string,
    operation: string,
    context: ErrorContext = {}
  ): Promise<void> {
    await this.reportError(error, {
      ...context,
      additionalContext: {
        ...context.additionalContext,
        externalService: service,
        failedOperation: operation
      }
    }, 'high');
  }

  async reportCriticalSystemError(
    error: Error,
    context: ErrorContext = {}
  ): Promise<void> {
    await this.reportError(error, context, 'critical');
  }

  async reportBitcoinPurchaseError(
    error: Error,
    purchaseId: string,
    amount: number,
    context: ErrorContext = {}
  ): Promise<void> {
    await this.reportError(error, {
      ...context,
      additionalContext: {
        ...context.additionalContext,
        purchaseId,
        amount,
        operation: 'bitcoin_purchase'
      }
    }, 'high');
  }

  async reportWebhookError(
    error: Error,
    provider: string,
    eventType: string,
    context: ErrorContext = {}
  ): Promise<void> {
    await this.reportError(error, {
      ...context,
      additionalContext: {
        ...context.additionalContext,
        webhookProvider: provider,
        eventType,
        operation: 'webhook_processing'
      }
    }, 'normal');
  }

  // Health check for error reporting system
  async healthCheck(): Promise<{ healthy: boolean; errors?: string[] }> {
    const errors: string[] = [];

    try {
      // Test Sentry connection if enabled
      if (this.config.enableSentryReporting) {
        // This is a simple way to test Sentry connectivity
        Sentry.addBreadcrumb({ message: 'Health check', level: 'info' });
      }

      // Test alerting system if configured
      if (this.alerting && this.config.enableSlackAlerts) {
        const alertHealthy = await this.alerting.healthCheck();
        if (!alertHealthy) {
          errors.push('Alerting system unhealthy');
        }
      }

      return {
        healthy: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      return {
        healthy: false,
        errors: [`Health check failed: ${(error as Error).message}`]
      };
    }
  }

  // Get error reporting statistics
  getStatistics(): {
    errorCounts: Array<{ errorKey: string; count: number; lastReset: Date }>;
    rateLimitWindowMs: number;
    maxErrorsPerWindow: number;
  } {
    return {
      errorCounts: Array.from(this.errorCounts.entries()).map(([key, data]) => ({
        errorKey: key,
        count: data.count,
        lastReset: new Date(data.lastReset)
      })),
      rateLimitWindowMs: this.config.rateLimitWindowMs,
      maxErrorsPerWindow: this.config.maxErrorsPerWindow
    };
  }
}

// Factory function
export function createErrorReporter(
  config: Partial<ErrorReportingConfig> = {},
  alerting?: AlertingSystem
): ErrorReporter {
  const defaultConfig: ErrorReportingConfig = {
    environment: process.env.NODE_ENV || 'development',
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    sentryDsn: process.env.SENTRY_DSN,
    enableSentryReporting: !!process.env.SENTRY_DSN && process.env.NODE_ENV === 'production',
    enableSlackAlerts: !!process.env.SLACK_WEBHOOK_URL,
    enableMetricsCollection: true,
    rateLimitWindowMs: 5 * 60 * 1000, // 5 minutes
    maxErrorsPerWindow: 10
  };

  return new ErrorReporter({ ...defaultConfig, ...config }, alerting);
}

// Global error reporter instance
let globalErrorReporter: ErrorReporter | null = null;

export function getGlobalErrorReporter(): ErrorReporter {
  if (!globalErrorReporter) {
    throw new Error('Global error reporter not initialized. Call initializeGlobalErrorReporter first.');
  }
  return globalErrorReporter;
}

export function initializeGlobalErrorReporter(
  config?: Partial<ErrorReportingConfig>,
  alerting?: AlertingSystem
): ErrorReporter {
  globalErrorReporter = createErrorReporter(config, alerting);
  return globalErrorReporter;
}

// Convenience function for reporting errors from anywhere in the application
export async function reportError(
  error: Error,
  context?: ErrorContext,
  severity?: 'low' | 'normal' | 'high' | 'critical'
): Promise<void> {
  const reporter = getGlobalErrorReporter();
  await reporter.reportError(error, context, severity);
}