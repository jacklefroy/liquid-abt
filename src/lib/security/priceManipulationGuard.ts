// LIQUID ABT - Price Manipulation Circuit Breakers
// Implementation of threat model price manipulation protection

import { securityAlertManager } from '../monitoring/securityAlertManager';

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: Date;
  source: string;
  volume24h?: number;
}

export interface CircuitBreakerConfig {
  maxPriceChangePercent: number; // Maximum allowed price change (default: 10%)
  timeWindowMs: number; // Time window for price change detection (default: 5 minutes)
  minDataSources: number; // Minimum price sources required (default: 2)
  maxSlippagePercent: number; // Maximum allowed slippage (default: 5%)
  suspensionDurationMs: number; // How long to suspend trading (default: 15 minutes)
}

export interface MarketCondition {
  symbol: string;
  currentPrice: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  volatilityLevel: 'low' | 'medium' | 'high' | 'extreme';
  isCircuitBreakerTriggered: boolean;
  suspendedUntil?: Date;
  lastUpdated: Date;
}

export class PriceManipulationGuard {
  private priceHistory: Map<string, PriceData[]> = new Map();
  private circuitBreakers: Map<string, Date> = new Map(); // symbol -> suspension end time
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      maxPriceChangePercent: 10, // 10% maximum change in 5 minutes
      timeWindowMs: 5 * 60 * 1000, // 5 minutes
      minDataSources: 2, // At least 2 price sources
      maxSlippagePercent: 5, // 5% maximum slippage
      suspensionDurationMs: 15 * 60 * 1000, // 15 minutes suspension
      ...config
    };
  }

  /**
   * Validate price data before allowing trades
   * Implements threat model circuit breaker requirements
   */
  async validatePriceForTrading(
    symbol: string,
    proposedPrice: number,
    orderAmount: number,
    priceData: PriceData[]
  ): Promise<{
    isValid: boolean;
    reason?: string;
    maxAllowedAmount?: number;
    recommendedDelay?: number;
  }> {
    // Check if circuit breaker is active
    const suspension = this.circuitBreakers.get(symbol);
    if (suspension && suspension > new Date()) {
      return {
        isValid: false,
        reason: `Trading suspended until ${suspension.toISOString()} due to price volatility`,
        recommendedDelay: suspension.getTime() - Date.now()
      };
    }

    // Validate minimum data sources
    if (priceData.length < this.config.minDataSources) {
      return {
        isValid: false,
        reason: `Insufficient price sources: ${priceData.length}, minimum required: ${this.config.minDataSources}`
      };
    }

    // Update price history
    this.updatePriceHistory(symbol, priceData);

    // Check for abnormal price movements
    const priceAnalysis = this.analyzePriceMovement(symbol, proposedPrice);
    if (priceAnalysis.isAbnormal) {
      // Trigger circuit breaker
      this.triggerCircuitBreaker(symbol);
      
      // Send security alert
      await securityAlertManager.createSecurityAlert({
        type: 'PRICE_MANIPULATION',
        severity: 'HIGH',
        title: 'Abnormal Price Movement Detected',
        description: `${symbol} price changed ${priceAnalysis.changePercent.toFixed(2)}% in ${this.config.timeWindowMs / 1000 / 60} minutes, exceeding ${this.config.maxPriceChangePercent}% limit`,
        metadata: {
          symbol,
          proposedPrice,
          changePercent: priceAnalysis.changePercent,
          timeWindow: this.config.timeWindowMs,
          priceData,
          circuitBreakerTriggered: true
        }
      });
      
      return {
        isValid: false,
        reason: `Abnormal price movement detected: ${priceAnalysis.changePercent.toFixed(2)}% in ${this.config.timeWindowMs / 1000 / 60} minutes`,
        recommendedDelay: this.config.suspensionDurationMs
      };
    }

    // Calculate price deviation between sources
    const priceDeviation = this.calculatePriceDeviation(priceData);
    if (priceDeviation.maxDeviation > this.config.maxSlippagePercent) {
      const reducedAmount = this.calculateMaxSafeAmount(orderAmount, priceDeviation.maxDeviation);
      
      return {
        isValid: priceDeviation.maxDeviation <= this.config.maxSlippagePercent * 2, // Allow up to 2x slippage with reduced amount
        reason: priceDeviation.maxDeviation > this.config.maxSlippagePercent * 2 
          ? `Price deviation too high: ${priceDeviation.maxDeviation.toFixed(2)}%`
          : `High price deviation, amount reduced for safety`,
        maxAllowedAmount: reducedAmount
      };
    }

    // Check for flash crash patterns
    const flashCrashRisk = this.detectFlashCrashPattern(symbol);
    if (flashCrashRisk.isDetected) {
      return {
        isValid: false,
        reason: `Flash crash pattern detected: ${flashCrashRisk.description}`,
        recommendedDelay: 60000 // 1 minute delay
      };
    }

    return { isValid: true };
  }

  /**
   * Get current market conditions for a symbol
   */
  getMarketConditions(symbol: string): MarketCondition | null {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length === 0) {
      return null;
    }

    const latest = history[history.length - 1];
    const dayAgo = history.find(p => 
      p.timestamp.getTime() <= Date.now() - 24 * 60 * 60 * 1000
    );

    let priceChange24h = 0;
    let priceChangePercent24h = 0;

    if (dayAgo) {
      priceChange24h = latest.price - dayAgo.price;
      priceChangePercent24h = (priceChange24h / dayAgo.price) * 100;
    }

    const volatilityLevel = this.calculateVolatilityLevel(symbol);
    const suspension = this.circuitBreakers.get(symbol);

    return {
      symbol,
      currentPrice: latest.price,
      priceChange24h,
      priceChangePercent24h,
      volatilityLevel,
      isCircuitBreakerTriggered: suspension ? suspension > new Date() : false,
      suspendedUntil: suspension && suspension > new Date() ? suspension : undefined,
      lastUpdated: latest.timestamp
    };
  }

  /**
   * Update price history with new data points
   */
  private updatePriceHistory(symbol: string, newPriceData: PriceData[]): void {
    let history = this.priceHistory.get(symbol) || [];
    
    // Add new price data
    history = [...history, ...newPriceData];
    
    // Keep only recent data (last 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    history = history.filter(p => p.timestamp.getTime() > cutoff);
    
    // Sort by timestamp
    history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    this.priceHistory.set(symbol, history);
  }

  /**
   * Analyze price movement for abnormal patterns
   */
  private analyzePriceMovement(
    symbol: string,
    currentPrice: number
  ): { isAbnormal: boolean; changePercent: number; reason?: string } {
    const history = this.priceHistory.get(symbol) || [];
    
    if (history.length === 0) {
      return { isAbnormal: false, changePercent: 0 };
    }

    // Find price from configured time window ago
    const windowStart = Date.now() - this.config.timeWindowMs;
    const historicalPrice = history
      .filter(p => p.timestamp.getTime() >= windowStart)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];

    if (!historicalPrice) {
      return { isAbnormal: false, changePercent: 0 };
    }

    const changePercent = Math.abs((currentPrice - historicalPrice.price) / historicalPrice.price) * 100;

    const isAbnormal = changePercent > this.config.maxPriceChangePercent;
    
    return {
      isAbnormal,
      changePercent,
      reason: isAbnormal 
        ? `Price change of ${changePercent.toFixed(2)}% exceeds limit of ${this.config.maxPriceChangePercent}%`
        : undefined
    };
  }

  /**
   * Calculate price deviation between multiple sources
   */
  private calculatePriceDeviation(priceData: PriceData[]): {
    meanPrice: number;
    maxDeviation: number;
    worstSource: string;
  } {
    if (priceData.length === 0) {
      return { meanPrice: 0, maxDeviation: 0, worstSource: '' };
    }

    const prices = priceData.map(p => p.price);
    const meanPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;

    let maxDeviation = 0;
    let worstSource = '';

    for (const data of priceData) {
      const deviation = Math.abs((data.price - meanPrice) / meanPrice) * 100;
      if (deviation > maxDeviation) {
        maxDeviation = deviation;
        worstSource = data.source;
      }
    }

    return { meanPrice, maxDeviation, worstSource };
  }

  /**
   * Calculate maximum safe amount based on price deviation
   */
  private calculateMaxSafeAmount(requestedAmount: number, deviation: number): number {
    // Reduce amount proportionally to deviation
    const reductionFactor = Math.max(0.1, 1 - (deviation / 100));
    return requestedAmount * reductionFactor;
  }

  /**
   * Detect flash crash patterns in price data
   */
  private detectFlashCrashPattern(symbol: string): {
    isDetected: boolean;
    description?: string;
  } {
    const history = this.priceHistory.get(symbol) || [];
    
    if (history.length < 3) {
      return { isDetected: false };
    }

    const recent = history.slice(-10); // Last 10 data points
    
    // Look for sudden drop followed by partial recovery pattern
    for (let i = 2; i < recent.length; i++) {
      const before = recent[i - 2].price;
      const crash = recent[i - 1].price;
      const after = recent[i].price;

      const dropPercent = ((before - crash) / before) * 100;
      const recoveryPercent = ((after - crash) / crash) * 100;

      // Flash crash pattern: >5% drop followed by >3% recovery in short time
      if (dropPercent > 5 && recoveryPercent > 3) {
        const timeSpan = recent[i].timestamp.getTime() - recent[i - 2].timestamp.getTime();
        if (timeSpan < 60000) { // Within 1 minute
          return {
            isDetected: true,
            description: `Flash crash: ${dropPercent.toFixed(1)}% drop with ${recoveryPercent.toFixed(1)}% recovery in ${timeSpan / 1000}s`
          };
        }
      }
    }

    return { isDetected: false };
  }

  /**
   * Calculate volatility level based on recent price movements
   */
  private calculateVolatilityLevel(symbol: string): 'low' | 'medium' | 'high' | 'extreme' {
    const history = this.priceHistory.get(symbol) || [];
    
    if (history.length < 10) {
      return 'low';
    }

    const recent = history.slice(-20); // Last 20 data points
    const prices = recent.map(p => p.price);
    
    // Calculate standard deviation
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Calculate coefficient of variation (relative volatility)
    const coefficientOfVariation = (standardDeviation / mean) * 100;

    if (coefficientOfVariation < 1) return 'low';
    if (coefficientOfVariation < 3) return 'medium';
    if (coefficientOfVariation < 7) return 'high';
    return 'extreme';
  }

  /**
   * Trigger circuit breaker for a symbol
   */
  private triggerCircuitBreaker(symbol: string): void {
    const suspensionEnd = new Date(Date.now() + this.config.suspensionDurationMs);
    this.circuitBreakers.set(symbol, suspensionEnd);

    console.warn('Circuit breaker triggered:', {
      symbol,
      suspendedUntil: suspensionEnd.toISOString(),
      reason: 'Abnormal price movement detected'
    });

    // TODO: Send alert to monitoring system
    // await alertingService.sendCircuitBreakerAlert(symbol, suspensionEnd);
  }

  /**
   * Manual circuit breaker reset (for admin use)
   */
  resetCircuitBreaker(symbol: string): void {
    this.circuitBreakers.delete(symbol);
    
    console.log('Circuit breaker manually reset:', { symbol });
  }

  /**
   * Get all active circuit breakers
   */
  getActiveCircuitBreakers(): Array<{ symbol: string; suspendedUntil: Date }> {
    const now = new Date();
    const active: Array<{ symbol: string; suspendedUntil: Date }> = [];

    this.circuitBreakers.forEach((suspensionEnd, symbol) => {
      if (suspensionEnd > now) {
        active.push({ symbol, suspendedUntil: suspensionEnd });
      }
    });

    return active;
  }
}