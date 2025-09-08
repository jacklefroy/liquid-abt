import React, { Component, ReactNode, ErrorInfo } from 'react';
import { BaseError, UnexpectedError } from '../lib/errors/CustomErrors';
import { getGlobalErrorReporter } from '../lib/errors/errorReporter';
import { Logger } from '../lib/logging/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, errorInfo: ErrorInfo) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  isolate?: boolean; // Whether to isolate this boundary from parent boundaries
  resetKeys?: Array<string | number>; // Keys that trigger a reset when changed
  resetOnPropsChange?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string | null;
  retryCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  private logger: Logger;
  private resetTimeoutId: number | null = null;

  constructor(props: Props) {
    super(props);
    
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      retryCount: 0
    };

    this.logger = new Logger({ module: 'ErrorBoundary' });
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorId: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    
    // Report error to monitoring systems
    this.reportError(error, errorInfo);
    
    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  componentDidUpdate(prevProps: Props): void {
    const { resetKeys, resetOnPropsChange } = this.props;
    const { hasError } = this.state;

    // Reset error state if reset keys have changed
    if (hasError && prevProps.resetKeys !== resetKeys) {
      if (resetKeys && prevProps.resetKeys) {
        const hasResetKeyChanged = resetKeys.some((key, idx) => 
          prevProps.resetKeys![idx] !== key
        );
        if (hasResetKeyChanged) {
          this.resetErrorBoundary();
        }
      }
    }

    // Reset error state if any props have changed (when resetOnPropsChange is true)
    if (hasError && resetOnPropsChange && prevProps !== this.props) {
      this.resetErrorBoundary();
    }
  }

  componentWillUnmount(): void {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  private async reportError(error: Error, errorInfo: ErrorInfo): Promise<void> {
    try {
      const errorReporter = getGlobalErrorReporter();
      
      // Create enhanced error with React context
      const enhancedError = error instanceof BaseError 
        ? error 
        : new UnexpectedError(error, {
            context: {
              componentStack: errorInfo.componentStack,
              errorBoundary: true,
              retryCount: this.state.retryCount
            }
          });

      await errorReporter.reportCriticalSystemError(enhancedError, {
        additionalContext: {
          componentStack: errorInfo.componentStack,
          errorBoundaryId: this.state.errorId,
          retryCount: this.state.retryCount
        }
      });

      this.logger.error('React Error Boundary caught error', {
        error: error.message,
        errorStack: error.stack,
        componentStack: errorInfo.componentStack,
        errorId: this.state.errorId,
        retryCount: this.state.retryCount
      });

    } catch (reportingError) {
      // Fallback logging if error reporting fails
      console.error('Error reporting failed in ErrorBoundary:', reportingError);
      console.error('Original error:', error);
      console.error('Component stack:', errorInfo.componentStack);
    }
  }

  private resetErrorBoundary = (): void => {
    this.setState(prevState => ({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      retryCount: prevState.retryCount + 1
    }));
  };

  private handleRetry = (): void => {
    this.resetErrorBoundary();
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private scheduleAutoRetry = (): void => {
    // Auto-retry after 10 seconds for the first error, then disable auto-retry
    if (this.state.retryCount === 0) {
      this.resetTimeoutId = window.setTimeout(() => {
        this.handleRetry();
      }, 10000);
    }
  };

  render(): ReactNode {
    const { hasError, error, errorInfo, errorId, retryCount } = this.state;
    const { children, fallback, isolate } = this.props;

    if (hasError && error) {
      // If we have a custom fallback, use it
      if (fallback) {
        if (typeof fallback === 'function') {
          return fallback(error, errorInfo!);
        }
        return fallback;
      }

      // Default error UI
      return (
        <DefaultErrorFallback
          error={error}
          errorInfo={errorInfo!}
          errorId={errorId!}
          retryCount={retryCount}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
          isolate={isolate}
        />
      );
    }

    return children;
  }
}

// Default error fallback component
interface DefaultErrorFallbackProps {
  error: Error;
  errorInfo: ErrorInfo;
  errorId: string;
  retryCount: number;
  onRetry: () => void;
  onReload: () => void;
  isolate?: boolean;
}

const DefaultErrorFallback: React.FC<DefaultErrorFallbackProps> = ({
  error,
  errorInfo,
  errorId,
  retryCount,
  onRetry,
  onReload,
  isolate
}) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isOperationalError = error instanceof BaseError && error.isOperational;

  return (
    <div className="error-boundary">
      <div className="error-boundary-content">
        <div className="error-header">
          <h2>
            {isOperationalError ? '⚠️ Something went wrong' : '🚨 Unexpected Error'}
          </h2>
          <p className="error-message">
            {isOperationalError 
              ? error.message 
              : 'We encountered an unexpected error. Our team has been notified.'}
          </p>
        </div>

        <div className="error-actions">
          <button 
            onClick={onRetry}
            className="btn btn-primary"
            disabled={retryCount > 3}
          >
            {retryCount > 0 ? `Retry (${retryCount}/3)` : 'Try Again'}
          </button>
          
          {!isolate && (
            <button 
              onClick={onReload}
              className="btn btn-secondary"
            >
              Reload Page
            </button>
          )}
        </div>

        {isDevelopment && (
          <details className="error-details">
            <summary>Error Details (Development)</summary>
            <div className="error-info">
              <div>
                <strong>Error ID:</strong> {errorId}
              </div>
              <div>
                <strong>Error Type:</strong> {error.constructor.name}
              </div>
              <div>
                <strong>Message:</strong> {error.message}
              </div>
              {error.stack && (
                <div>
                  <strong>Stack Trace:</strong>
                  <pre className="error-stack">{error.stack}</pre>
                </div>
              )}
              {errorInfo.componentStack && (
                <div>
                  <strong>Component Stack:</strong>
                  <pre className="error-stack">{errorInfo.componentStack}</pre>
                </div>
              )}
            </div>
          </details>
        )}

        <div className="error-footer">
          <p>
            If this problem persists, please contact support with error ID: 
            <code>{errorId}</code>
          </p>
        </div>
      </div>

      <style jsx>{`
        .error-boundary {
          min-height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background-color: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          margin: 20px;
        }

        .error-boundary-content {
          max-width: 600px;
          text-align: center;
        }

        .error-header h2 {
          color: #dc2626;
          margin-bottom: 12px;
          font-size: 24px;
        }

        .error-message {
          color: #374151;
          margin-bottom: 24px;
          line-height: 1.5;
        }

        .error-actions {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-bottom: 24px;
        }

        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-primary {
          background-color: #2563eb;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background-color: #1d4ed8;
        }

        .btn-secondary {
          background-color: #6b7280;
          color: white;
        }

        .btn-secondary:hover {
          background-color: #4b5563;
        }

        .error-details {
          text-align: left;
          margin-bottom: 20px;
          background-color: #f9fafb;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 16px;
        }

        .error-details summary {
          cursor: pointer;
          font-weight: 500;
          margin-bottom: 12px;
        }

        .error-info > div {
          margin-bottom: 8px;
        }

        .error-stack {
          background-color: #1f2937;
          color: #f9fafb;
          padding: 12px;
          border-radius: 4px;
          font-size: 12px;
          overflow-x: auto;
          white-space: pre-wrap;
          margin-top: 4px;
        }

        .error-footer {
          font-size: 14px;
          color: #6b7280;
        }

        .error-footer code {
          background-color: #f3f4f6;
          padding: 2px 4px;
          border-radius: 3px;
          font-family: 'Monaco', 'Consolas', monospace;
        }
      `}</style>
    </div>
  );
};

// Higher-order component for easier usage
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const WithErrorBoundaryComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundaryComponent.displayName = 
    `withErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name})`;

  return WithErrorBoundaryComponent;
}

// Specialized error boundaries for different parts of the application

export const PageErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    resetOnPropsChange={true}
    fallback={(error, errorInfo) => (
      <div className="page-error">
        <h1>Page Error</h1>
        <p>This page encountered an error and couldn't load properly.</p>
        <button onClick={() => window.location.reload()}>
          Reload Page
        </button>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);

export const ComponentErrorBoundary: React.FC<{ 
  children: ReactNode;
  componentName?: string;
}> = ({ children, componentName = 'Component' }) => (
  <ErrorBoundary
    isolate={true}
    fallback={(error) => (
      <div className="component-error">
        <p>{componentName} failed to load</p>
        <small>{error.message}</small>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);

export const FormErrorBoundary: React.FC<{ 
  children: ReactNode;
  onError?: (error: Error) => void;
}> = ({ children, onError }) => (
  <ErrorBoundary
    isolate={true}
    onError={onError}
    fallback={() => (
      <div className="form-error">
        <p>Form encountered an error. Please refresh and try again.</p>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);

export const AsyncComponentErrorBoundary: React.FC<{ 
  children: ReactNode;
  fallback?: ReactNode;
}> = ({ children, fallback }) => (
  <ErrorBoundary
    isolate={true}
    fallback={fallback || (
      <div className="async-error">
        <p>Failed to load component</p>
        <button onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);