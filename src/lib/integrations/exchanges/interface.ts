// LIQUID ABT - Bitcoin Exchange Provider Interface

export interface ExchangeProvider {
  name: string;
  type: ExchangeProviderType;
  
  // Market Data
  getCurrentPrice(currency?: string): Promise<MarketPrice>;
  getOrderBook(pair: string): Promise<OrderBook>;
  
  // Trading Operations
  createMarketOrder(order: MarketOrderRequest): Promise<OrderResult>;
  createLimitOrder(order: LimitOrderRequest): Promise<OrderResult>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
  
  // Account Operations
  getBalance(): Promise<ExchangeBalance>;
  getTransactionHistory(since?: Date): Promise<ExchangeTransaction[]>;
  
  // Withdrawal Operations (for self-custody)
  withdrawBitcoin(request: WithdrawalRequest): Promise<WithdrawalResult>;
  getWithdrawalStatus(withdrawalId: string): Promise<WithdrawalStatus>;
  
  // Fee Information
  getTradingFees(): Promise<TradingFees>;
  getWithdrawalFees(): Promise<WithdrawalFees>;
}

export type ExchangeProviderType = 'kraken' | 'zerocap' | 'swyftx' | 'coinbase' | 'mock';

export interface MarketPrice {
  symbol: string;
  price: number;
  currency: string;
  timestamp: Date;
  bid?: number;
  ask?: number;
  volume24h?: number;
  change24h?: number;
  changePercent24h?: number;
}

export interface OrderBook {
  symbol: string;
  bids: [number, number][]; // [price, quantity]
  asks: [number, number][]; // [price, quantity]
  timestamp: Date;
}

export interface MarketOrderRequest {
  side: 'buy' | 'sell';
  symbol: string;
  amount?: number; // Amount in base currency (BTC)
  value?: number; // Amount in quote currency (AUD)
  currency: string; // AUD, USD, etc.
}

export interface LimitOrderRequest extends MarketOrderRequest {
  price: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

export interface OrderResult {
  orderId: string;
  status: OrderStatusType;
  side: 'buy' | 'sell';
  symbol: string;
  amount: number;
  filledAmount?: number;
  remainingAmount?: number;
  averagePrice?: number;
  totalValue: number;
  fees?: OrderFee[];
  timestamp: Date;
  rawData?: any;
}

export interface OrderStatus extends OrderResult {
  isComplete: boolean;
  isCancelled: boolean;
  executionReports?: ExecutionReport[];
}

export interface ExecutionReport {
  timestamp: Date;
  price: number;
  amount: number;
  fee?: OrderFee;
}

export interface OrderFee {
  amount: number;
  currency: string;
  type: 'trading' | 'withdrawal' | 'deposit';
}

export type OrderStatusType = 'pending' | 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';

export interface ExchangeBalance {
  currency: string;
  available: number;
  total: number;
  reserved?: number;
  btc?: {
    available: number;
    total: number;
    reserved?: number;
  };
}

export interface ExchangeTransaction {
  id: string;
  type: 'trade' | 'deposit' | 'withdrawal' | 'fee';
  side?: 'buy' | 'sell';
  symbol?: string;
  amount: number;
  currency: string;
  price?: number;
  totalValue?: number;
  fees?: OrderFee[];
  status: 'completed' | 'pending' | 'failed';
  timestamp: Date;
  orderId?: string;
  rawData?: any;
}

export interface WithdrawalRequest {
  currency: 'BTC';
  amount: number;
  address: string;
  tag?: string; // For memo-required currencies
  description?: string;
  
  // Validation preferences
  validateAddress?: boolean;
  requireTwoFactor?: boolean;
}

export interface WithdrawalResult {
  withdrawalId: string;
  status: WithdrawalStatusType;
  currency: string;
  amount: number;
  address: string;
  txId?: string; // Blockchain transaction ID
  fees: OrderFee[];
  estimatedConfirmationTime?: number; // Minutes
  timestamp: Date;
  rawData?: any;
}

export interface WithdrawalStatus extends WithdrawalResult {
  confirmations?: number;
  requiredConfirmations?: number;
  isComplete: boolean;
  failureReason?: string;
}

export type WithdrawalStatusType = 'pending' | 'processing' | 'sent' | 'confirmed' | 'failed' | 'cancelled';

export interface TradingFees {
  maker: number; // Percentage (0.16 = 0.16%)
  taker: number; // Percentage (0.26 = 0.26%)
  currency: string;
  volumeDiscounts?: VolumeDiscount[];
}

export interface VolumeDiscount {
  volume30Day: number; // In AUD
  makerRate: number;
  takerRate: number;
}

export interface WithdrawalFees {
  btc: {
    fixed: number; // Fixed BTC amount
    minimum: number; // Minimum withdrawal
  };
  fiat?: {
    [currency: string]: {
      fixed?: number;
      percentage?: number;
      minimum?: number;
    };
  };
}

// Error types for better error handling
export class ExchangeError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
    public rawError?: any
  ) {
    super(message);
    this.name = 'ExchangeError';
  }
}

export class InsufficientFundsError extends ExchangeError {
  constructor(available: number, required: number, currency: string) {
    super(`Insufficient funds: ${available} ${currency} available, ${required} ${currency} required`);
    this.name = 'InsufficientFundsError';
  }
}

export class InvalidAddressError extends ExchangeError {
  constructor(address: string, currency: string) {
    super(`Invalid ${currency} address: ${address}`);
    this.name = 'InvalidAddressError';
  }
}

export class OrderRejectedError extends ExchangeError {
  constructor(reason: string, orderId?: string) {
    super(`Order rejected: ${reason}`);
    this.name = 'OrderRejectedError';
    this.code = orderId;
  }
}

// Import actual implementations
import { KrakenProvider } from './kraken';
import { MockExchangeProvider } from './mock/index';

// Factory for creating exchange providers
export class ExchangeProviderFactory {
  static create(type: ExchangeProviderType, credentials: any = {}): ExchangeProvider {
    // Check environment variable for mock exchange override
    const useMockExchange = process.env.USE_MOCK_EXCHANGE === 'true';
    
    if (useMockExchange && type !== 'mock') {
      console.log(`Using mock exchange instead of ${type} (USE_MOCK_EXCHANGE=true)`);
      // Pass mock configuration including base price from environment
      const mockConfig = {
        mockPrice: parseFloat(process.env.MOCK_BTC_PRICE || '50000'),
        ...credentials.mockConfig
      };
      return new MockExchangeProvider(mockConfig);
    }
    
    switch (type) {
      case 'kraken':
        return new KrakenProvider(credentials);
      case 'mock':
        const mockConfig = {
          mockPrice: parseFloat(process.env.MOCK_BTC_PRICE || '50000'),
          ...credentials
        };
        return new MockExchangeProvider(mockConfig);
      case 'zerocap':
        throw new Error('ZeroCap integration not yet implemented (coming with API v2)');
      case 'swyftx':
        throw new Error('Swyftx integration not yet implemented');
      case 'coinbase':
        throw new Error('Coinbase integration not yet implemented');
      default:
        throw new Error(`Unknown exchange provider type: ${type}`);
    }
  }
  
  /**
   * Create exchange provider with environment variable defaults
   */
  static createDefault(credentials: any = {}): ExchangeProvider {
    const defaultProvider = (process.env.BITCOIN_EXCHANGE_PROVIDER || 'kraken') as ExchangeProviderType;
    return this.create(defaultProvider, credentials);
  }
}