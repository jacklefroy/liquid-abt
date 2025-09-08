// LIQUID ABT - Mock Exchange Provider for Testing

import {
  ExchangeProvider,
  ExchangeProviderType,
  MarketPrice,
  OrderBook,
  MarketOrderRequest,
  LimitOrderRequest,
  OrderResult,
  OrderStatus,
  ExchangeBalance,
  ExchangeTransaction,
  WithdrawalRequest,
  WithdrawalResult,
  WithdrawalStatus,
  TradingFees,
  WithdrawalFees,
  OrderFee,
  ExchangeError,
  InsufficientFundsError,
  InvalidAddressError,
  OrderRejectedError,
  OrderStatusType,
  WithdrawalStatusType
} from '../interface';

// Retry configuration
interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  retryOn: (error: any) => boolean;
}

// Configuration for mock behavior
export interface MockExchangeConfig {
  // Failure simulation
  shouldFailGetPrice?: boolean;
  shouldFailCreateOrder?: boolean;
  shouldFailWithdraw?: boolean;
  shouldFailGetBalance?: boolean;
  
  // Latency simulation
  networkLatencyMs?: number;
  
  // Custom responses
  mockPrice?: number;
  mockBalance?: { aud: number; btc: number };
  mockOrderId?: string;
  mockWithdrawalId?: string;
  
  // Error simulation
  simulateInsufficientFunds?: boolean;
  simulateInvalidAddress?: boolean;
  simulateRateLimit?: boolean;
  simulateNetworkError?: boolean;
  
  // Order behavior
  orderFillRate?: number; // 0-1, how much of order gets filled
  orderExecutionDelay?: number; // ms delay before order status changes
}

export class MockExchangeProvider implements ExchangeProvider {
  public readonly name = 'Mock Exchange';
  public readonly type: ExchangeProviderType = 'mock';
  
  private config: MockExchangeConfig;
  private orders: Map<string, OrderStatus> = new Map();
  private withdrawals: Map<string, WithdrawalStatus> = new Map();
  private orderCounter = 1000;
  private withdrawalCounter = 5000;
  private balance = { aud: 50000, btc: 0.5 }; // Default balance
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    backoffMs: 1000,
    retryOn: (error: any) => {
      // Retry on network errors, rate limits, and temporary failures
      return error.code === 'ECONNRESET' ||
             error.code === 'ENOTFOUND' ||
             error.message?.includes('Temporary') ||
             error.message?.includes('network') ||
             (error instanceof ExchangeError && error.httpStatus >= 500);
    }
  };

  constructor(config: MockExchangeConfig = {}) {
    this.config = {
      networkLatencyMs: 100,
      mockPrice: 50000,
      orderFillRate: 1.0,
      orderExecutionDelay: 0,
      ...config
    };
    
    // Override balance if provided
    if (config.mockBalance) {
      this.balance = { ...config.mockBalance };
    }
  }

  /**
   * Simulate network latency
   */
  private async simulateLatency(): Promise<void> {
    if (this.config.networkLatencyMs && this.config.networkLatencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.networkLatencyMs));
    }
  }

  /**
   * Simulate various error conditions
   */
  private checkForSimulatedErrors(): void {
    if (this.config.simulateNetworkError) {
      const error = new Error('Network connection failed');
      (error as any).code = 'ECONNRESET';
      throw error;
    }
    
    if (this.config.simulateRateLimit) {
      throw new ExchangeError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429);
    }
  }

  /**
   * Retry mechanism with exponential backoff (similar to Kraken provider)
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Don't retry if it's not a retriable error
        if (!this.retryConfig.retryOn(error) || attempt === this.retryConfig.maxRetries) {
          throw error;
        }
        
        // Exponential backoff with jitter
        const backoffMs = this.retryConfig.backoffMs * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
    
    throw lastError;
  }

  /**
   * Get current Bitcoin price (mocked)
   */
  async getCurrentPrice(currency = 'AUD'): Promise<MarketPrice> {
    return this.withRetry(async () => {
      await this.simulateLatency();
      this.checkForSimulatedErrors();
      
      if (this.config.shouldFailGetPrice) {
        throw new ExchangeError('Mock: Price service unavailable', 'PRICE_FETCH_ERROR');
      }

    const basePrice = this.config.mockPrice || 50000;
    // Add some realistic variation
    const variation = (Math.random() - 0.5) * 1000; // ±$500 variation
    const price = basePrice + variation;
    
    return {
      symbol: 'BTC',
      price,
      currency,
      timestamp: new Date(),
      bid: price - 25,
      ask: price + 25,
      volume24h: Math.random() * 1000 + 100,
      change24h: (Math.random() - 0.5) * 2000,
      changePercent24h: (Math.random() - 0.5) * 4
    };
    });
  }

  /**
   * Get order book (mocked with realistic data)
   */
  async getOrderBook(pair = 'XBTAUD'): Promise<OrderBook> {
    await this.simulateLatency();
    this.checkForSimulatedErrors();

    const currentPrice = this.config.mockPrice || 50000;
    
    // Generate realistic bid/ask spreads
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    
    // Generate 10 bids below current price
    for (let i = 0; i < 10; i++) {
      const price = currentPrice - (i + 1) * 10;
      const volume = Math.random() * 2 + 0.1;
      bids.push([price, volume]);
    }
    
    // Generate 10 asks above current price
    for (let i = 0; i < 10; i++) {
      const price = currentPrice + (i + 1) * 10;
      const volume = Math.random() * 2 + 0.1;
      asks.push([price, volume]);
    }

    return {
      symbol: pair,
      bids,
      asks,
      timestamp: new Date()
    };
  }

  /**
   * Create market order (mocked)
   */
  async createMarketOrder(order: MarketOrderRequest): Promise<OrderResult> {
    return this.withRetry(async () => {
      await this.simulateLatency();
      this.checkForSimulatedErrors();
      
      if (this.config.shouldFailCreateOrder) {
        throw new OrderRejectedError('Mock: Order rejected by exchange', 'MOCK_REJECTION');
      }

    // Simulate insufficient funds
    if (this.config.simulateInsufficientFunds) {
      throw new InsufficientFundsError(1000, 5000, order.currency || 'AUD');
    }

    // Validate order
    if (!order.amount && !order.value) {
      throw new ExchangeError('Either amount or value must be specified', 'INVALID_ORDER');
    }

    if (order.side === 'buy' && order.value && this.balance.aud < order.value) {
      throw new InsufficientFundsError(this.balance.aud, order.value, 'AUD');
    }

    const orderId = this.config.mockOrderId || `MOCK_${this.orderCounter++}`;
    const currentPrice = this.config.mockPrice || 50000;
    const fillRate = this.config.orderFillRate || 1.0;
    
    let amount: number;
    let totalValue: number;
    
    if (order.amount) {
      amount = order.amount;
      totalValue = amount * currentPrice;
    } else {
      totalValue = order.value!;
      amount = totalValue / currentPrice;
    }

    const filledAmount = amount * fillRate;
    const remainingAmount = amount - filledAmount;
    const fees = totalValue * 0.002; // 0.2% fee

    // Update mock balance
    if (order.side === 'buy' && fillRate === 1.0) {
      this.balance.aud -= totalValue + fees;
      this.balance.btc += filledAmount;
    }

    const status: OrderStatusType = fillRate === 1.0 ? 'filled' : fillRate > 0 ? 'partially_filled' : 'open';
    
    const orderResult: OrderResult = {
      orderId,
      status,
      side: order.side,
      symbol: 'BTC',
      amount,
      filledAmount,
      remainingAmount,
      averagePrice: currentPrice,
      totalValue,
      fees: [{
        amount: fees,
        currency: order.currency || 'AUD',
        type: 'trading'
      }],
      timestamp: new Date(),
      rawData: { mockOrder: true }
    };

    // Store order status
    const orderStatus: OrderStatus = {
      ...orderResult,
      isComplete: status === 'filled',
      isCancelled: false,
      executionReports: [{
        timestamp: new Date(),
        price: currentPrice,
        amount: filledAmount,
        fee: orderResult.fees?.[0]
      }]
    };

    this.orders.set(orderId, orderStatus);

    return orderResult;
    });
  }

  /**
   * Create limit order (mocked)
   */
  async createLimitOrder(order: LimitOrderRequest): Promise<OrderResult> {
    await this.simulateLatency();
    this.checkForSimulatedErrors();

    const orderId = this.config.mockOrderId || `MOCK_LIMIT_${this.orderCounter++}`;
    const amount = order.amount || (order.value! / order.price);
    const totalValue = amount * order.price;

    const orderResult: OrderResult = {
      orderId,
      status: 'open', // Limit orders start as open
      side: order.side,
      symbol: 'BTC',
      amount,
      filledAmount: 0,
      remainingAmount: amount,
      averagePrice: order.price,
      totalValue,
      fees: [],
      timestamp: new Date(),
      rawData: { mockLimitOrder: true, price: order.price }
    };

    // Store order status
    const orderStatus: OrderStatus = {
      ...orderResult,
      isComplete: false,
      isCancelled: false,
      executionReports: []
    };

    this.orders.set(orderId, orderStatus);

    return orderResult;
  }

  /**
   * Get order status (mocked)
   */
  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    await this.simulateLatency();
    this.checkForSimulatedErrors();

    const order = this.orders.get(orderId);
    if (!order) {
      throw new ExchangeError(`Order ${orderId} not found`, 'ORDER_NOT_FOUND');
    }

    // Simulate order execution delay
    if (this.config.orderExecutionDelay && 
        order.status === 'open' && 
        Date.now() - order.timestamp.getTime() > this.config.orderExecutionDelay) {
      
      // Fill the order
      order.status = 'filled';
      order.filledAmount = order.amount;
      order.remainingAmount = 0;
      order.isComplete = true;
      
      // Update balance if it's a buy order
      if (order.side === 'buy') {
        this.balance.aud -= order.totalValue;
        this.balance.btc += order.filledAmount;
      }
    }

    return { ...order }; // Return a copy
  }

  /**
   * Get account balance (mocked)
   */
  async getBalance(): Promise<ExchangeBalance> {
    await this.simulateLatency();
    this.checkForSimulatedErrors();
    
    if (this.config.shouldFailGetBalance) {
      throw new ExchangeError('Mock: Balance service unavailable', 'BALANCE_ERROR');
    }

    return {
      currency: 'AUD',
      available: this.balance.aud,
      total: this.balance.aud,
      btc: {
        available: this.balance.btc,
        total: this.balance.btc
      }
    };
  }

  /**
   * Get transaction history (mocked)
   */
  async getTransactionHistory(since?: Date): Promise<ExchangeTransaction[]> {
    await this.simulateLatency();
    this.checkForSimulatedErrors();

    const transactions: ExchangeTransaction[] = [];
    const cutoffTime = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    // Generate some mock transactions
    for (let i = 0; i < 5; i++) {
      const txTime = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
      if (txTime < cutoffTime) continue;

      const isBuy = Math.random() > 0.5;
      const amount = Math.random() * 0.1 + 0.01;
      const price = 45000 + Math.random() * 10000;

      transactions.push({
        id: `MOCK_TX_${i + 1}`,
        type: 'trade',
        side: isBuy ? 'buy' : 'sell',
        symbol: 'XBTAUD',
        amount,
        currency: isBuy ? 'BTC' : 'AUD',
        price,
        totalValue: amount * price,
        fees: [{
          amount: amount * price * 0.002,
          currency: 'AUD',
          type: 'trading'
        }],
        status: 'completed',
        timestamp: txTime,
        orderId: `MOCK_${1000 + i}`,
        rawData: { mockTransaction: true }
      });
    }

    return transactions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Withdraw Bitcoin (mocked)
   */
  async withdrawBitcoin(request: WithdrawalRequest): Promise<WithdrawalResult> {
    await this.simulateLatency();
    this.checkForSimulatedErrors();
    
    if (this.config.shouldFailWithdraw) {
      throw new ExchangeError('Mock: Withdrawal service unavailable', 'WITHDRAWAL_ERROR');
    }

    // Simulate invalid address
    if (this.config.simulateInvalidAddress) {
      throw new InvalidAddressError(request.address, 'BTC');
    }

    // Check sufficient balance
    if (this.balance.btc < request.amount) {
      throw new InsufficientFundsError(this.balance.btc, request.amount, 'BTC');
    }

    // Validate address format (basic check)
    if (!this.isValidBitcoinAddress(request.address)) {
      throw new InvalidAddressError(request.address, 'BTC');
    }

    const withdrawalId = this.config.mockWithdrawalId || `MOCK_WD_${this.withdrawalCounter++}`;
    const fees = await this.getWithdrawalFees();

    // Update balance
    this.balance.btc -= request.amount;

    const withdrawalResult: WithdrawalResult = {
      withdrawalId,
      status: 'pending',
      currency: 'BTC',
      amount: request.amount,
      address: request.address,
      fees: [{
        amount: fees.btc.fixed,
        currency: 'BTC',
        type: 'withdrawal'
      }],
      estimatedConfirmationTime: 60,
      timestamp: new Date(),
      rawData: { mockWithdrawal: true }
    };

    // Store withdrawal status
    const withdrawalStatus: WithdrawalStatus = {
      ...withdrawalResult,
      isComplete: false,
      txId: `mock_tx_${Date.now()}`
    };

    this.withdrawals.set(withdrawalId, withdrawalStatus);

    return withdrawalResult;
  }

  /**
   * Get withdrawal status (mocked)
   */
  async getWithdrawalStatus(withdrawalId: string): Promise<WithdrawalStatus> {
    await this.simulateLatency();
    this.checkForSimulatedErrors();

    const withdrawal = this.withdrawals.get(withdrawalId);
    if (!withdrawal) {
      throw new ExchangeError(`Withdrawal ${withdrawalId} not found`, 'WITHDRAWAL_NOT_FOUND');
    }

    // Simulate withdrawal progression over time
    const ageMs = Date.now() - withdrawal.timestamp.getTime();
    if (ageMs > 300000 && withdrawal.status === 'pending') { // 5 minutes
      withdrawal.status = 'processing';
    }
    if (ageMs > 900000 && withdrawal.status === 'processing') { // 15 minutes
      withdrawal.status = 'sent';
      withdrawal.confirmations = 0;
      withdrawal.requiredConfirmations = 6;
    }
    if (ageMs > 1800000 && withdrawal.status === 'sent') { // 30 minutes
      withdrawal.status = 'confirmed';
      withdrawal.confirmations = 6;
      withdrawal.isComplete = true;
    }

    return { ...withdrawal }; // Return a copy
  }

  /**
   * Get trading fees (mocked)
   */
  async getTradingFees(): Promise<TradingFees> {
    await this.simulateLatency();

    return {
      maker: 0.15, // 0.15%
      taker: 0.25, // 0.25%
      currency: 'percentage',
      volumeDiscounts: [
        { volume30Day: 50000, makerRate: 0.10, takerRate: 0.20 },
        { volume30Day: 100000, makerRate: 0.05, takerRate: 0.15 },
        { volume30Day: 500000, makerRate: 0.02, takerRate: 0.10 }
      ]
    };
  }

  /**
   * Get withdrawal fees (mocked)
   */
  async getWithdrawalFees(): Promise<WithdrawalFees> {
    return {
      btc: {
        fixed: 0.0002, // 0.0002 BTC withdrawal fee
        minimum: 0.001 // Minimum 0.001 BTC withdrawal
      }
    };
  }

  /**
   * Basic Bitcoin address validation
   */
  private isValidBitcoinAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    
    // Basic validation for common Bitcoin address formats
    const legacyRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const bech32Regex = /^bc1[02-9ac-hj-np-z]{7,87}$/;
    
    return legacyRegex.test(address) || bech32Regex.test(address);
  }

  /**
   * Update mock configuration
   */
  updateConfig(newConfig: Partial<MockExchangeConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Reset mock state (useful for testing)
   */
  reset(): void {
    this.orders.clear();
    this.withdrawals.clear();
    this.orderCounter = 1000;
    this.withdrawalCounter = 5000;
    this.balance = { aud: 50000, btc: 0.5 };
  }

  /**
   * Get current mock state (useful for testing)
   */
  getMockState() {
    return {
      orders: Array.from(this.orders.entries()),
      withdrawals: Array.from(this.withdrawals.entries()),
      balance: { ...this.balance },
      config: { ...this.config }
    };
  }

  /**
   * Set mock balance (useful for testing scenarios)
   */
  setBalance(aud: number, btc: number): void {
    this.balance = { aud, btc };
  }

  /**
   * Simulate order fill (useful for testing limit orders)
   */
  fillOrder(orderId: string, fillAmount?: number): void {
    const order = this.orders.get(orderId);
    if (!order) return;

    const amountToFill = fillAmount || order.remainingAmount;
    order.filledAmount += amountToFill;
    order.remainingAmount -= amountToFill;
    
    if (order.remainingAmount <= 0) {
      order.status = 'filled';
      order.isComplete = true;
    } else {
      order.status = 'partially_filled';
    }

    // Update balance
    if (order.side === 'buy') {
      const cost = amountToFill * order.averagePrice;
      this.balance.aud -= cost;
      this.balance.btc += amountToFill;
    }
  }
}