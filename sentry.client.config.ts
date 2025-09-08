// This file configures the initialization of Sentry on the browser/client
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Performance monitoring sample rate  
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: process.env.NODE_ENV === 'development',
  
  environment: process.env.NODE_ENV,
  
  // Custom error filtering
  beforeSend(event, hint) {
    // Filter out specific errors
    if (event.exception) {
      const error = hint.originalException;
      
      // Don't send network errors to Sentry (they're usually external issues)
      if (error instanceof Error && error.message.includes('NetworkError')) {
        return null;
      }
      
      // Don't send CSP violations (they're security-related but not app errors)
      if (error instanceof Error && error.message.includes('Content Security Policy')) {
        return null;
      }
    }
    
    return event;
  },
  
  // Set user context
  initialScope: {
    tags: {
      component: 'client',
      app: 'liquid-abt'
    }
  }
});