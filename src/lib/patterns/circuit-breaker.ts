// LIQUID ABT - Circuit Breaker Pattern Implementation
// Prevent cascade failures from external API dependencies

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of consecutive failures before opening
  recoveryTimeout: number;       // Milliseconds before attempting recovery
  monitoringWindow: number;      // Window for tracking failures (ms)
  successThreshold: number;      // Successes needed in half-open to close
  name: string;                  // Circuit breaker name for logging
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  openedAt?: number;
  lastStateChange: number;
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly circuitName: string,
    public readonly state: CircuitState
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private openedAt?: number;
  private lastStateChange = Date.now();
  
  // Metrics tracking
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  
  // Failure tracking within monitoring window
  private failureTimestamps: number[] = [];
  
  constructor(private config: CircuitBreakerConfig) {
    console.log(`🔌 Circuit Breaker "${config.name}" initialized`);
  }
  
  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;
    
    // Check if circuit should remain open
    if (this.shouldRejectCall()) {
      throw new CircuitBreakerError(
        `Circuit breaker "${this.config.name}" is OPEN - rejecting call`,
        this.config.name,
        this.state
      );
    }
    
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
      
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  /**
   * Check if the call should be rejected based on circuit state
   */
  private shouldRejectCall(): boolean {
    const now = Date.now();
    
    switch (this.state) {
      case 'CLOSED':
        return false; // Allow all calls
        
      case 'OPEN':
        // Check if recovery timeout has elapsed
        if (this.openedAt && (now - this.openedAt) >= this.config.recoveryTimeout) {
          this.transitionTo('HALF_OPEN');
          return false; // Allow one call to test recovery
        }
        return true; // Reject all calls
        
      case 'HALF_OPEN':
        return false; // Allow calls to test recovery
        
      default:
        return false;
    }
  }
  
  /**
   * Record a successful call
   */
  private recordSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    
    switch (this.state) {
      case 'CLOSED':
        // Reset failure count on success in closed state
        this.failureCount = 0;
        this.clearOldFailures();
        break;
        
      case 'HALF_OPEN':
        this.successCount++;
        // If we've had enough successes, close the circuit
        if (this.successCount >= this.config.successThreshold) {
          this.transitionTo('CLOSED');
        }
        break;
        
      case 'OPEN':
        // This shouldn't happen, but handle gracefully
        console.warn(`Unexpected success in OPEN state for circuit "${this.config.name}"`);
        break;
    }
  }
  
  /**
   * Record a failed call
   */
  private recordFailure(): void {
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.failureTimestamps.push(this.lastFailureTime);
    
    // Clean up old failure timestamps outside monitoring window
    this.clearOldFailures();
    
    switch (this.state) {
      case 'CLOSED':
        this.failureCount++;
        // Check if we should open the circuit
        if (this.failureTimestamps.length >= this.config.failureThreshold) {
          this.transitionTo('OPEN');
        }
        break;
        
      case 'HALF_OPEN':
        // Any failure in half-open state should reopen the circuit
        this.transitionTo('OPEN');
        break;
        
      case 'OPEN':
        // Already open, just increment counter
        this.failureCount++;
        break;
    }
  }
  
  /**
   * Clear failure timestamps outside the monitoring window
   */
  private clearOldFailures(): void {
    const now = Date.now();
    const cutoff = now - this.config.monitoringWindow;
    this.failureTimestamps = this.failureTimestamps.filter(timestamp => timestamp > cutoff);
  }
  
  /**
   * Transition to a new circuit state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    
    switch (newState) {
      case 'OPEN':
        this.openedAt = this.lastStateChange;
        this.successCount = 0;
        console.warn(`🔴 Circuit breaker "${this.config.name}" OPENED (${this.failureCount} failures)`);
        break;
        
      case 'HALF_OPEN':
        this.successCount = 0;
        this.failureCount = 0;
        console.info(`🟡 Circuit breaker "${this.config.name}" is HALF_OPEN (testing recovery)`);
        break;
        
      case 'CLOSED':
        this.failureCount = 0;
        this.successCount = 0;
        this.failureTimestamps = [];
        this.openedAt = undefined;
        console.info(`🟢 Circuit breaker "${this.config.name}" CLOSED (recovery successful)`);
        break;
    }
    
    // Emit state change event for monitoring
    this.emitStateChangeEvent(oldState, newState);
  }
  
  /**
   * Emit state change event for external monitoring
   */
  private emitStateChangeEvent(oldState: CircuitState, newState: CircuitState): void {
    // This could be integrated with your metrics collection system
    // For now, just log the event
    console.log(`⚡ Circuit "${this.config.name}": ${oldState} → ${newState}`);
    
    // You could emit this to a metrics system like:
    // metricsCollector.recordCircuitBreakerStateChange(this.config.name, oldState, newState);
  }
  
  /**
   * Get current circuit breaker metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      openedAt: this.openedAt,
      lastStateChange: this.lastStateChange
    };
  }
  
  /**
   * Force circuit to specific state (for testing/emergency situations)
   */
  forceState(state: CircuitState): void {
    console.warn(`⚠️ Circuit breaker "${this.config.name}" FORCED to ${state} state`);
    this.transitionTo(state);
  }
  
  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.failureTimestamps = [];
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.openedAt = undefined;
    this.transitionTo('CLOSED');
    console.info(`🔄 Circuit breaker "${this.config.name}" RESET`);
  }
  
  /**
   * Check if circuit is healthy
   */
  isHealthy(): boolean {
    return this.state === 'CLOSED';
  }
  
  /**
   * Get failure rate over the monitoring window
   */
  getFailureRate(): number {
    this.clearOldFailures();
    const totalRecentCalls = this.failureTimestamps.length + 
      Math.max(0, this.totalCalls - this.totalFailures); // Approximate recent successes
    
    if (totalRecentCalls === 0) return 0;
    return this.failureTimestamps.length / totalRecentCalls;
  }
}

/**
 * Circuit Breaker Factory for common configurations
 */
export class CircuitBreakerFactory {
  /**
   * Create circuit breaker for Exchange API calls
   */
  static createExchangeApiBreaker(exchangeName: string): CircuitBreaker {
    return new CircuitBreaker({
      name: `exchange_api_${exchangeName.toLowerCase()}`,
      failureThreshold: 5,        // Open after 5 consecutive failures
      recoveryTimeout: 30000,     // Try recovery after 30 seconds
      monitoringWindow: 300000,   // Track failures over 5 minutes
      successThreshold: 2         // Need 2 successes to close
    });
  }
  
  /**
   * Create circuit breaker for Database connections
   */
  static createDatabaseBreaker(): CircuitBreaker {
    return new CircuitBreaker({
      name: 'database',
      failureThreshold: 3,        // Open after 3 consecutive failures
      recoveryTimeout: 10000,     // Try recovery after 10 seconds
      monitoringWindow: 60000,    // Track failures over 1 minute
      successThreshold: 1         // Need 1 success to close
    });
  }
  
  /**
   * Create circuit breaker for external service calls
   */
  static createServiceBreaker(serviceName: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    return new CircuitBreaker({
      name: serviceName,
      failureThreshold: 5,
      recoveryTimeout: 30000,
      monitoringWindow: 300000,
      successThreshold: 2,
      ...config
    });
  }
}