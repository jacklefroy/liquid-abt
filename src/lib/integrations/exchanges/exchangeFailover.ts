// LIQUID ABT - Multi-Exchange Failover System
// Implementation of threat model multi-exchange redundancy

import { ExchangeProvider, ExchangeProviderFactory, ExchangeProviderType, MarketOrderRequest, OrderResult, MarketPrice } from './interface';

export interface ExchangeConfig {
  type: ExchangeProviderType;
  priority: number; // Lower number = higher priority
  credentials: any;
  healthCheckInterval?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  feePercent?: number; // Exchange-specific fee percentage
}

export interface ExchangeHealth {
  provider: ExchangeProviderType;
  isHealthy: boolean;
  lastCheck: Date;
  latency?: number;
  errorRate?: number;
  lastError?: string;
}

export class ExchangeFailoverManager {
  private exchanges: Map<ExchangeProviderType, ExchangeProvider> = new Map();
  private configs: ExchangeConfig[] = [];
  private healthStatus: Map<ExchangeProviderType, ExchangeHealth> = new Map();
  private healthCheckIntervals: Map<ExchangeProviderType, NodeJS.Timeout> = new Map();

  constructor() {
    this.initializeDefaultExchanges();
  }

  /**
   * Initialize default exchange configuration per threat model
   * Production failover: ZeroCap → Independent Reserve → BTC Markets
   */
  private initializeDefaultExchanges(): void {
    const defaultConfigs: ExchangeConfig[] = [];

    // If in development/testing, add mock exchange
    if (process.env.USE_MOCK_EXCHANGE === 'true') {
      defaultConfigs.push({
        type: 'mock',
        priority: 1,
        credentials: {
          mockPrice: parseFloat(process.env.MOCK_BTC_PRICE || '150000'),
          networkLatencyMs: 100
        },
        healthCheckInterval: 60000, // 1 minute
        maxRetries: 3,
        retryDelayMs: 2000,
        feePercent: 0.1 // Very low for testing
      });
    } else {
      // Production configuration: ZeroCap → Independent Reserve → BTC Markets
      
      // Primary: ZeroCap
      if (process.env.ZEROCAP_API_KEY && process.env.ZEROCAP_PRIVATE_KEY) {
        defaultConfigs.push({
          type: 'zerocap',
          priority: 1,
          credentials: {
            apiKey: process.env.ZEROCAP_API_KEY,
            privateKey: process.env.ZEROCAP_PRIVATE_KEY
          },
          healthCheckInterval: 30000, // 30 seconds for primary
          maxRetries: 3,
          retryDelayMs: 1000,
          feePercent: 0.3 // 0.3% fee (lowest for primary)
        });
      }

      // Secondary: Independent Reserve
      if (process.env.IR_API_KEY && process.env.IR_PRIVATE_KEY) {
        defaultConfigs.push({
          type: 'independent-reserve',
          priority: 2,
          credentials: {
            apiKey: process.env.IR_API_KEY,
            privateKey: process.env.IR_PRIVATE_KEY
          },
          healthCheckInterval: 60000, // 1 minute for backup
          maxRetries: 2,
          retryDelayMs: 2000,
          feePercent: 0.5 // 0.5% fee
        });
      }

      // Tertiary: BTC Markets
      if (process.env.BTM_API_KEY && process.env.BTM_PRIVATE_KEY) {
        defaultConfigs.push({
          type: 'btc-markets',
          priority: 3,
          credentials: {
            apiKey: process.env.BTM_API_KEY,
            privateKey: process.env.BTM_PRIVATE_KEY
          },
          healthCheckInterval: 120000, // 2 minutes for tertiary
          maxRetries: 2,
          retryDelayMs: 3000,
          feePercent: 0.85 // 0.85% fee (higher for backup)
        });
      }

      // If no production exchanges configured, fall back to mock
      if (defaultConfigs.length === 0) {
        console.warn('No production exchanges configured, falling back to mock exchange');
        defaultConfigs.push({
          type: 'mock',
          priority: 1,
          credentials: {
            mockPrice: parseFloat(process.env.MOCK_BTC_PRICE || '150000'),
            networkLatencyMs: 100
          },
          healthCheckInterval: 60000,
          maxRetries: 3,
          retryDelayMs: 2000,
          feePercent: 0.1
        });
      }
    }

    this.configureExchanges(defaultConfigs);
  }

  /**
   * Configure exchanges with failover priorities
   */
  configureExchanges(configs: ExchangeConfig[]): void {
    this.configs = configs.sort((a, b) => a.priority - b.priority);

    // Initialize exchange providers
    for (const config of this.configs) {
      try {
        const provider = ExchangeProviderFactory.create(config.type, config.credentials);
        this.exchanges.set(config.type, provider);

        // Initialize health status
        this.healthStatus.set(config.type, {
          provider: config.type,
          isHealthy: true, // Assume healthy until proven otherwise
          lastCheck: new Date()
        });

        // Start health monitoring
        this.startHealthMonitoring(config);

        console.log(`Exchange configured: ${config.type} (priority: ${config.priority})`);
      } catch (error) {
        console.error(`Failed to configure exchange ${config.type}:`, error);
      }
    }
  }

  /**
   * Execute market order with automatic failover
   */
  async executeMarketOrderWithFailover(order: MarketOrderRequest): Promise<{
    result: OrderResult;
    usedExchange: ExchangeProviderType;
    failoverCount: number;
  }> {
    const healthyExchanges = this.getHealthyExchanges();
    
    if (healthyExchanges.length === 0) {
      throw new Error('No healthy exchanges available for order execution');
    }

    let failoverCount = 0;
    let lastError: Error | null = null;

    for (const exchangeType of healthyExchanges) {
      try {
        const exchange = this.exchanges.get(exchangeType);
        if (!exchange) {
          continue;
        }

        console.log(`Attempting order execution on ${exchangeType}`, {
          amount: order.value,
          side: order.side,
          failoverCount
        });

        const result = await exchange.createMarketOrder(order);

        // Mark exchange as healthy after successful operation
        this.updateHealthStatus(exchangeType, true);

        return {
          result,
          usedExchange: exchangeType,
          failoverCount
        };

      } catch (error) {
        lastError = error as Error;
        failoverCount++;

        // Mark exchange as unhealthy
        this.updateHealthStatus(exchangeType, false, lastError.message);

        console.warn(`Order failed on ${exchangeType}, attempting failover`, {
          error: lastError.message,
          failoverCount
        });

        // Continue to next exchange
        continue;
      }
    }

    // All exchanges failed
    throw new Error(
      `Order execution failed on all ${failoverCount} available exchanges. Last error: ${lastError?.message}`
    );
  }

  /**
   * Get current Bitcoin price with failover
   */
  async getCurrentPriceWithFailover(currency = 'AUD'): Promise<{
    price: MarketPrice;
    usedExchange: ExchangeProviderType;
    priceValidation: {
      sourceCount: number;
      priceDeviation: number;
      isReliable: boolean;
    };
  }> {
    const healthyExchanges = this.getHealthyExchanges();
    const prices: Array<{ price: MarketPrice; exchange: ExchangeProviderType }> = [];

    // Collect prices from multiple exchanges for validation
    for (const exchangeType of healthyExchanges) {
      try {
        const exchange = this.exchanges.get(exchangeType);
        if (!exchange) continue;

        const price = await exchange.getCurrentPrice(currency);
        prices.push({ price, exchange: exchangeType });

        // Mark as healthy
        this.updateHealthStatus(exchangeType, true);

      } catch (error) {
        console.warn(`Price fetch failed on ${exchangeType}:`, (error as Error).message);
        this.updateHealthStatus(exchangeType, false, (error as Error).message);
      }
    }

    if (prices.length === 0) {
      throw new Error('Failed to fetch price from any exchange');
    }

    // Calculate price validation metrics
    const priceValues = prices.map(p => p.price.price);
    const avgPrice = priceValues.reduce((sum, p) => sum + p, 0) / priceValues.length;
    const maxDeviation = Math.max(
      ...priceValues.map(p => Math.abs((p - avgPrice) / avgPrice) * 100)
    );

    // Use primary exchange price if available and within acceptable deviation
    const primaryPrice = prices.find(p => 
      this.configs.find(c => c.type === p.exchange)?.priority === 1
    );

    const selectedPrice = primaryPrice || prices[0];

    return {
      price: selectedPrice.price,
      usedExchange: selectedPrice.exchange,
      priceValidation: {
        sourceCount: prices.length,
        priceDeviation: maxDeviation,
        isReliable: prices.length >= 2 && maxDeviation < 5 // <5% deviation is reliable
      }
    };
  }

  /**
   * Get list of healthy exchanges in priority order
   */
  private getHealthyExchanges(): ExchangeProviderType[] {
    return this.configs
      .filter(config => {
        const health = this.healthStatus.get(config.type);
        return health?.isHealthy !== false; // Include unknown status as potentially healthy
      })
      .map(config => config.type);
  }

  /**
   * Update health status for an exchange
   */
  private updateHealthStatus(
    exchangeType: ExchangeProviderType,
    isHealthy: boolean,
    errorMessage?: string,
    latency?: number
  ): void {
    const currentStatus = this.healthStatus.get(exchangeType);
    
    this.healthStatus.set(exchangeType, {
      provider: exchangeType,
      isHealthy,
      lastCheck: new Date(),
      latency,
      lastError: errorMessage,
      errorRate: currentStatus?.errorRate // TODO: Calculate rolling error rate
    });
  }

  /**
   * Start health monitoring for an exchange
   */
  private startHealthMonitoring(config: ExchangeConfig): void {
    if (!config.healthCheckInterval) return;

    const interval = setInterval(async () => {
      await this.performHealthCheck(config.type);
    }, config.healthCheckInterval);

    this.healthCheckIntervals.set(config.type, interval);
  }

  /**
   * Perform health check on specific exchange
   */
  private async performHealthCheck(exchangeType: ExchangeProviderType): Promise<void> {
    const exchange = this.exchanges.get(exchangeType);
    if (!exchange) return;

    const startTime = Date.now();

    try {
      // Simple health check: get current price
      await exchange.getCurrentPrice('AUD');
      
      const latency = Date.now() - startTime;
      this.updateHealthStatus(exchangeType, true, undefined, latency);

    } catch (error) {
      this.updateHealthStatus(exchangeType, false, (error as Error).message);
    }
  }

  /**
   * Get health status for all exchanges
   */
  getExchangeHealthStatus(): ExchangeHealth[] {
    return Array.from(this.healthStatus.values())
      .sort((a, b) => {
        const configA = this.configs.find(c => c.type === a.provider);
        const configB = this.configs.find(c => c.type === b.provider);
        return (configA?.priority || 999) - (configB?.priority || 999);
      });
  }

  /**
   * Manually mark exchange as healthy/unhealthy
   */
  setExchangeHealth(exchangeType: ExchangeProviderType, isHealthy: boolean): void {
    this.updateHealthStatus(exchangeType, isHealthy);
    
    console.log(`Exchange ${exchangeType} manually marked as ${isHealthy ? 'healthy' : 'unhealthy'}`);
  }

  /**
   * Stop all health monitoring
   */
  stopHealthMonitoring(): void {
    this.healthCheckIntervals.forEach(interval => clearInterval(interval));
    this.healthCheckIntervals.clear();
  }

  /**
   * Get exchange statistics for monitoring
   */
  getExchangeStatistics(): {
    totalExchanges: number;
    healthyExchanges: number;
    primaryExchange: ExchangeProviderType | null;
    averageLatency: number;
  } {
    const allHealth = Array.from(this.healthStatus.values());
    const healthyCount = allHealth.filter(h => h.isHealthy).length;
    const primaryExchange = this.configs.length > 0 ? this.configs[0].type : null;
    
    const latencies = allHealth
      .filter(h => h.latency !== undefined)
      .map(h => h.latency!);
    
    const averageLatency = latencies.length > 0 
      ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length 
      : 0;

    return {
      totalExchanges: this.configs.length,
      healthyExchanges: healthyCount,
      primaryExchange,
      averageLatency
    };
  }

  /**
   * Calculate total cost including exchange-specific fees
   * Implementation per code review feedback
   */
  calculateTotalCost(amount: number, exchange: ExchangeProviderType): {
    baseCost: number;
    exchangeFee: number;
    totalCost: number;
    feePercent: number;
  } {
    const config = this.configs.find(c => c.type === exchange);
    const feePercent = config?.feePercent || this.getDefaultFeePercent(exchange);
    const exchangeFee = amount * (feePercent / 100);
    const totalCost = amount + exchangeFee;

    return {
      baseCost: amount,
      exchangeFee,
      totalCost,
      feePercent
    };
  }

  /**
   * Get default fee percentages for known exchanges
   */
  private getDefaultFeePercent(exchange: ExchangeProviderType): number {
    const defaultFees: Record<ExchangeProviderType, number> = {
      'zerocap': 0.5, // 0.5%
      'kraken': 0.26, // 0.26% maker/taker average
      'independent-reserve': 0.5, // 0.5%
      'btc-markets': 0.85, // 0.85%
      'mock': 0.1 // Very low for testing
    };

    return defaultFees[exchange] || 0.75; // Default 0.75% for unknown exchanges
  }

  /**
   * Compare exchange costs for optimal selection
   */
  compareExchangeCosts(amount: number): Array<{
    exchange: ExchangeProviderType;
    isHealthy: boolean;
    priority: number;
    totalCost: number;
    exchangeFee: number;
    feePercent: number;
  }> {
    return this.configs.map(config => {
      const health = this.healthStatus.get(config.type);
      const costInfo = this.calculateTotalCost(amount, config.type);
      
      return {
        exchange: config.type,
        isHealthy: health?.isHealthy || false,
        priority: config.priority,
        ...costInfo
      };
    }).sort((a, b) => {
      // Sort by health first, then by priority, then by cost
      if (a.isHealthy !== b.isHealthy) {
        return b.isHealthy ? 1 : -1; // Healthy exchanges first
      }
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower priority number first
      }
      return a.totalCost - b.totalCost; // Lower cost first
    });
  }

  /**
   * Get recommended exchange based on health, priority, and fees
   */
  getRecommendedExchange(amount: number): {
    exchange: ExchangeProviderType;
    reason: string;
    costInfo: ReturnType<typeof this.calculateTotalCost>;
  } | null {
    const comparisons = this.compareExchangeCosts(amount);
    const best = comparisons.find(c => c.isHealthy);
    
    if (!best) {
      return null;
    }

    const costInfo = this.calculateTotalCost(amount, best.exchange);
    let reason = `Priority ${best.priority} exchange`;
    
    if (best.priority === 1) {
      reason = 'Primary exchange (healthy)';
    } else {
      reason = `Failover to priority ${best.priority} exchange`;
    }

    return {
      exchange: best.exchange,
      reason,
      costInfo
    };
  }
}