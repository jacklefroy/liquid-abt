// LIQUID ABT - Mock Exchange Test Scenarios

import { MockExchangeConfig } from './index';

/**
 * Pre-configured test scenarios for common testing needs
 */
export const MockScenarios = {
  /**
   * Default scenario - everything works normally
   */
  SUCCESS: {
    networkLatencyMs: 50,
    mockPrice: 50000,
    mockBalance: { aud: 100000, btc: 2.0 },
    orderFillRate: 1.0
  } as MockExchangeConfig,

  /**
   * High latency scenario for testing timeouts
   */
  HIGH_LATENCY: {
    networkLatencyMs: 2000,
    mockPrice: 50000,
    mockBalance: { aud: 100000, btc: 2.0 }
  } as MockExchangeConfig,

  /**
   * Price service failure
   */
  PRICE_SERVICE_DOWN: {
    shouldFailGetPrice: true,
    networkLatencyMs: 100,
    mockBalance: { aud: 100000, btc: 2.0 }
  } as MockExchangeConfig,

  /**
   * Trading service failure
   */
  TRADING_DOWN: {
    shouldFailCreateOrder: true,
    networkLatencyMs: 100,
    mockPrice: 50000,
    mockBalance: { aud: 100000, btc: 2.0 }
  } as MockExchangeConfig,

  /**
   * Withdrawal service failure
   */
  WITHDRAWAL_DOWN: {
    shouldFailWithdraw: true,
    networkLatencyMs: 100,
    mockPrice: 50000,
    mockBalance: { aud: 100000, btc: 2.0 }
  } as MockExchangeConfig,

  /**
   * Balance service failure
   */
  BALANCE_SERVICE_DOWN: {
    shouldFailGetBalance: true,
    networkLatencyMs: 100,
    mockPrice: 50000
  } as MockExchangeConfig,

  /**
   * Insufficient funds scenario
   */
  INSUFFICIENT_FUNDS_AUD: {
    simulateInsufficientFunds: true,
    mockBalance: { aud: 100, btc: 0.001 }, // Very low balance
    mockPrice: 50000,
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Insufficient Bitcoin for withdrawal
   */
  INSUFFICIENT_FUNDS_BTC: {
    mockBalance: { aud: 100000, btc: 0.0001 }, // Very low BTC
    mockPrice: 50000,
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Invalid Bitcoin address scenario
   */
  INVALID_ADDRESS: {
    simulateInvalidAddress: true,
    mockBalance: { aud: 100000, btc: 2.0 },
    mockPrice: 50000,
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Rate limiting scenario
   */
  RATE_LIMITED: {
    simulateRateLimit: true,
    mockBalance: { aud: 100000, btc: 2.0 },
    mockPrice: 50000,
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Network connectivity issues
   */
  NETWORK_ERROR: {
    simulateNetworkError: true,
    mockBalance: { aud: 100000, btc: 2.0 },
    mockPrice: 50000
  } as MockExchangeConfig,

  /**
   * Partial order fills
   */
  PARTIAL_FILLS: {
    orderFillRate: 0.5, // Only 50% of orders get filled
    mockBalance: { aud: 100000, btc: 2.0 },
    mockPrice: 50000,
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Slow order execution for limit orders
   */
  SLOW_EXECUTION: {
    orderExecutionDelay: 5000, // 5 second delay before orders execute
    mockBalance: { aud: 100000, btc: 2.0 },
    mockPrice: 50000,
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Volatile market conditions (high price changes)
   */
  VOLATILE_MARKET: {
    mockPrice: 50000,
    mockBalance: { aud: 100000, btc: 2.0 },
    networkLatencyMs: 50
    // Note: MockExchangeProvider adds random variation to prices
  } as MockExchangeConfig,

  /**
   * Bull market scenario (higher prices)
   */
  BULL_MARKET: {
    mockPrice: 75000, // Higher base price
    mockBalance: { aud: 100000, btc: 2.0 },
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Bear market scenario (lower prices)
   */
  BEAR_MARKET: {
    mockPrice: 30000, // Lower base price
    mockBalance: { aud: 100000, btc: 2.0 },
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Low balance scenario for testing edge cases
   */
  LOW_BALANCE: {
    mockBalance: { aud: 1000, btc: 0.01 },
    mockPrice: 50000,
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * High balance scenario for testing large orders
   */
  HIGH_BALANCE: {
    mockBalance: { aud: 1000000, btc: 20.0 },
    mockPrice: 50000,
    networkLatencyMs: 50
  } as MockExchangeConfig,

  /**
   * Emergency scenario - everything fails
   */
  COMPLETE_FAILURE: {
    shouldFailGetPrice: true,
    shouldFailCreateOrder: true,
    shouldFailWithdraw: true,
    shouldFailGetBalance: true,
    simulateNetworkError: true,
    networkLatencyMs: 100
  } as MockExchangeConfig,

  /**
   * Demo mode - perfect conditions for showcasing
   */
  DEMO_MODE: {
    networkLatencyMs: 10, // Very fast
    mockPrice: 50000,
    mockBalance: { aud: 500000, btc: 10.0 }, // Plenty of funds
    orderFillRate: 1.0, // Always fills completely
    orderExecutionDelay: 100 // Quick execution
  } as MockExchangeConfig,

  /**
   * Beta testing scenario - realistic but controlled
   */
  BETA_TESTING: {
    networkLatencyMs: 200, // Realistic latency
    mockPrice: 48500, // Close to real market price
    mockBalance: { aud: 50000, btc: 1.0 }, // Realistic SME balance
    orderFillRate: 0.95 // Occasionally partial fills
  } as MockExchangeConfig,

  /**
   * Stress testing - high frequency operations
   */
  STRESS_TEST: {
    networkLatencyMs: 5, // Very low latency
    mockPrice: 50000,
    mockBalance: { aud: 10000000, btc: 200.0 }, // Large balances
    orderFillRate: 1.0
  } as MockExchangeConfig
};

/**
 * Scenario factory for creating custom test scenarios
 */
export class ScenarioFactory {
  /**
   * Create a custom scenario by combining base scenarios
   */
  static combine(...scenarios: MockExchangeConfig[]): MockExchangeConfig {
    return scenarios.reduce((combined, scenario) => ({
      ...combined,
      ...scenario
    }), {});
  }

  /**
   * Create a scenario with specific failure types
   */
  static withFailures(failures: {
    price?: boolean;
    orders?: boolean;
    withdrawals?: boolean;
    balance?: boolean;
    network?: boolean;
    rateLimit?: boolean;
  }): MockExchangeConfig {
    return {
      shouldFailGetPrice: failures.price,
      shouldFailCreateOrder: failures.orders,
      shouldFailWithdraw: failures.withdrawals,
      shouldFailGetBalance: failures.balance,
      simulateNetworkError: failures.network,
      simulateRateLimit: failures.rateLimit,
      networkLatencyMs: 100,
      mockPrice: 50000,
      mockBalance: { aud: 100000, btc: 2.0 }
    };
  }

  /**
   * Create a scenario with specific balance conditions
   */
  static withBalance(aud: number, btc: number): MockExchangeConfig {
    return {
      mockBalance: { aud, btc },
      mockPrice: 50000,
      networkLatencyMs: 50
    };
  }

  /**
   * Create a scenario with specific market conditions
   */
  static withMarket(price: number, volatility: 'low' | 'medium' | 'high' = 'medium'): MockExchangeConfig {
    return {
      mockPrice: price,
      mockBalance: { aud: 100000, btc: 2.0 },
      networkLatencyMs: 50
      // Note: Volatility is handled by the MockExchangeProvider's random variation
    };
  }

  /**
   * Create a scenario for testing Australian SME use cases
   */
  static australianSME(
    revenue: 'low' | 'medium' | 'high',
    bitcoinExperience: 'beginner' | 'intermediate' | 'advanced'
  ): MockExchangeConfig {
    const balances = {
      low: { aud: 10000, btc: 0.1 },
      medium: { aud: 50000, btc: 0.5 },
      high: { aud: 200000, btc: 2.0 }
    };

    const latencies = {
      beginner: 500, // Slower for demo purposes
      intermediate: 200,
      advanced: 100
    };

    const fillRates = {
      beginner: 1.0, // Always successful for good UX
      intermediate: 0.98,
      advanced: 0.95 // More realistic
    };

    return {
      mockBalance: balances[revenue],
      networkLatencyMs: latencies[bitcoinExperience],
      orderFillRate: fillRates[bitcoinExperience],
      mockPrice: 50000
    };
  }
}

/**
 * Test suite scenarios - predefined sets for comprehensive testing
 */
export const TestSuites = {
  /**
   * Core functionality test suite
   */
  CORE_FUNCTIONALITY: [
    MockScenarios.SUCCESS,
    MockScenarios.PARTIAL_FILLS,
    MockScenarios.LOW_BALANCE,
    MockScenarios.HIGH_BALANCE
  ],

  /**
   * Error handling test suite
   */
  ERROR_HANDLING: [
    MockScenarios.PRICE_SERVICE_DOWN,
    MockScenarios.TRADING_DOWN,
    MockScenarios.WITHDRAWAL_DOWN,
    MockScenarios.BALANCE_SERVICE_DOWN,
    MockScenarios.INSUFFICIENT_FUNDS_AUD,
    MockScenarios.INSUFFICIENT_FUNDS_BTC,
    MockScenarios.INVALID_ADDRESS,
    MockScenarios.RATE_LIMITED,
    MockScenarios.NETWORK_ERROR
  ],

  /**
   * Performance test suite
   */
  PERFORMANCE: [
    MockScenarios.SUCCESS,
    MockScenarios.HIGH_LATENCY,
    MockScenarios.SLOW_EXECUTION,
    MockScenarios.STRESS_TEST
  ],

  /**
   * Market conditions test suite
   */
  MARKET_CONDITIONS: [
    MockScenarios.SUCCESS,
    MockScenarios.VOLATILE_MARKET,
    MockScenarios.BULL_MARKET,
    MockScenarios.BEAR_MARKET
  ],

  /**
   * Australian SME focused test suite
   */
  AUSTRALIAN_SME: [
    ScenarioFactory.australianSME('low', 'beginner'),
    ScenarioFactory.australianSME('medium', 'intermediate'),
    ScenarioFactory.australianSME('high', 'advanced')
  ]
};

export default MockScenarios;