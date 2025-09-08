// This file configures the initialization of Sentry for server-side code
import * as Sentry from '@sentry/nextjs';
import { appLogger } from '@/lib/logging/logger';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  
  // Performance monitoring sample rate
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: process.env.NODE_ENV === 'development',
  
  environment: process.env.NODE_ENV,
  
  // Custom error filtering for server-side
  beforeSend(event, hint) {
    const error = hint.originalException;
    
    // Don't send expected business logic errors
    if (error instanceof Error) {
      // Rate limit errors are expected and handled
      if (error.message.includes('Rate limit exceeded')) {
        return null;
      }
      
      // Exchange API temporary failures are expected
      if (error.message.includes('Exchange API timeout') || 
          error.message.includes('Circuit breaker')) {
        return null;
      }
    }
    
    // Log to our structured logging system as well
    if (error instanceof Error) {
      appLogger.error('Sentry error captured', {
        error: error.message,
        stack: error.stack,
        metadata: {
          sentryEventId: event.event_id
        }
      });
    }
    
    return event;
  },
  
  // Capture custom contexts
  beforeSendTransaction(event) {
    // Add custom transaction data
    event.tags = {
      ...event.tags,
      component: 'server',
      app: 'liquid-abt'
    };
    
    return event;
  },
  
  // Integration configuration
  integrations: [
    // Enable HTTP integration for API monitoring
    new Sentry.Integrations.Http({
      tracing: true,
      breadcrumbs: true
    }),
    
    // File system integration
    new Sentry.Integrations.OnUncaughtException({
      exitEvenIfOtherHandlersAreRegistered: false
    }),
    
    // Unhandled promise rejections
    new Sentry.Integrations.OnUnhandledRejection({
      mode: 'warn'
    })
  ],
  
  // Custom scope data
  initialScope: {
    tags: {
      component: 'server',
      app: 'liquid-abt'
    }
  }
});

// Custom Sentry helpers for LIQUID ABT
export class LiquidSentry {
  /**
   * Capture Bitcoin purchase errors with context
   */
  static captureBitcoinPurchaseError(
    error: Error, 
    context: {
      tenantId?: string;
      amount?: number;
      currency?: string;
      exchangeProvider?: string;
      transactionId?: string;
    }
  ): string {
    return Sentry.withScope((scope) => {
      scope.setTag('error_type', 'bitcoin_purchase');
      scope.setContext('bitcoin_purchase', context);
      scope.setLevel('error');
      
      if (context.tenantId) {
        scope.setUser({ id: context.tenantId });
      }
      
      return Sentry.captureException(error);
    });
  }
  
  /**
   * Capture treasury rule execution errors
   */
  static captureTreasuryRuleError(
    error: Error,
    context: {
      tenantId?: string;
      ruleName?: string;
      ruleType?: string;
      triggeredAmount?: number;
    }
  ): string {
    return Sentry.withScope((scope) => {
      scope.setTag('error_type', 'treasury_rule');
      scope.setContext('treasury_rule', context);
      scope.setLevel('error');
      
      if (context.tenantId) {
        scope.setUser({ id: context.tenantId });
      }
      
      return Sentry.captureException(error);
    });
  }
  
  /**
   * Capture API errors with request context
   */
  static captureApiError(
    error: Error,
    context: {
      endpoint?: string;
      method?: string;
      statusCode?: number;
      userId?: string;
      tenantId?: string;
      duration?: number;
    }
  ): string {
    return Sentry.withScope((scope) => {
      scope.setTag('error_type', 'api_error');
      scope.setContext('api_request', context);
      scope.setLevel('error');
      
      if (context.userId) {
        scope.setUser({ id: context.userId });
      }
      
      return Sentry.captureException(error);
    });
  }
  
  /**
   * Capture exchange API errors
   */
  static captureExchangeApiError(
    error: Error,
    context: {
      exchangeProvider?: string;
      operation?: string;
      tenantId?: string;
      amount?: number;
      duration?: number;
    }
  ): string {
    return Sentry.withScope((scope) => {
      scope.setTag('error_type', 'exchange_api');
      scope.setContext('exchange_api', context);
      scope.setLevel('error');
      
      return Sentry.captureException(error);
    });
  }
  
  /**
   * Capture performance issues
   */
  static capturePerformanceIssue(
    message: string,
    context: {
      operation?: string;
      duration?: number;
      threshold?: number;
      tenantId?: string;
    }
  ): string {
    return Sentry.withScope((scope) => {
      scope.setTag('issue_type', 'performance');
      scope.setContext('performance', context);
      scope.setLevel('warning');
      
      return Sentry.captureMessage(message, 'warning');
    });
  }
}