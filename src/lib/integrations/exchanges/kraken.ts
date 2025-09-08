// LIQUID ABT - Kraken Exchange Integration

import crypto from 'crypto';
import { createEndpointRateLimit } from '../../middleware/rateLimiter';
import { CircuitBreaker, CircuitBreakerFactory } from '../../patterns/circuit-breaker';
import { metricsCollector, PerformanceTimer } from '../../monitoring/metrics';
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
} from './interface';

// Retry configuration
interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  retryOn: (error: any) => boolean;
}

// Kraken API rate limits (requests per minute based on Kraken's actual limits)
const KRAKEN_RATE_LIMITS = {
  PUBLIC: { maxRequests: 60, windowMs: 60 * 1000 }, // 60 requests per minute
  PRIVATE: { maxRequests: 30, windowMs: 60 * 1000 }, // 30 requests per minute  
  TRADING: { maxRequests: 15, windowMs: 60 * 1000 }, // 15 trading requests per minute
  WITHDRAWAL: { maxRequests: 5, windowMs: 60 * 1000 } // 5 withdrawal requests per minute
};

export class KrakenProvider implements ExchangeProvider {
  public readonly name = 'Kraken';
  public readonly type: ExchangeProviderType = 'kraken';
  
  private readonly apiKey: string;
  private readonly privateKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion = '0';
  private readonly sandbox: boolean;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    backoffMs: 1000,
    retryOn: (error: any) => {
      // Retry on network errors, rate limits, and 5xx server errors
      return error.code === 'ECONNRESET' ||
             error.code === 'ENOTFOUND' ||
             error.code === 'ETIMEDOUT' ||
             error.statusCode === 429 ||
             (error.statusCode >= 500 && error.statusCode < 600);
    }
  };

  // Rate limiters for different API endpoint types
  private readonly rateLimiters = {
    PUBLIC: createEndpointRateLimit(
      KRAKEN_RATE_LIMITS.PUBLIC.maxRequests, 
      KRAKEN_RATE_LIMITS.PUBLIC.windowMs,
      'Kraken public API rate limit exceeded'
    ),
    PRIVATE: createEndpointRateLimit(
      KRAKEN_RATE_LIMITS.PRIVATE.maxRequests,
      KRAKEN_RATE_LIMITS.PRIVATE.windowMs, 
      'Kraken private API rate limit exceeded'
    ),
    TRADING: createEndpointRateLimit(
      KRAKEN_RATE_LIMITS.TRADING.maxRequests,
      KRAKEN_RATE_LIMITS.TRADING.windowMs,
      'Kraken trading API rate limit exceeded'
    ),
    WITHDRAWAL: createEndpointRateLimit(
      KRAKEN_RATE_LIMITS.WITHDRAWAL.maxRequests,
      KRAKEN_RATE_LIMITS.WITHDRAWAL.windowMs,
      'Kraken withdrawal API rate limit exceeded'
    )
  };

  constructor(credentials: {
    apiKey?: string;
    privateKey?: string;
    environment?: 'sandbox' | 'production';
    sandbox?: boolean;
    timeout?: number;
  }) {
    this.apiKey = credentials.apiKey || process.env.KRAKEN_API_KEY!;
    this.privateKey = credentials.privateKey || process.env.KRAKEN_PRIVATE_KEY!;
    this.sandbox = credentials.sandbox || credentials.environment === 'sandbox' || false;
    
    // Set base URL based on environment (Kraken uses same URL for sandbox and prod)
    this.baseUrl = 'https://api.kraken.com';
    
    // Initialize circuit breaker for API protection
    this.circuitBreaker = CircuitBreakerFactory.createExchangeApiBreaker('kraken');

    if (!this.apiKey || !this.privateKey) {
      throw new Error('Kraken API key and private key are required');
    }

    // Log sandbox mode for debugging
    if (this.sandbox) {
      console.log('🧪 Kraken provider initialized in SANDBOX mode');
    }
  }

  /**
   * Get current Bitcoin price in AUD with retry logic and circuit breaker
   */
  async getCurrentPrice(currency = 'AUD'): Promise<MarketPrice> {
    const timer = new PerformanceTimer('kraken_get_current_price');
    
    return this.circuitBreaker.execute(async () => {
      return this.withRetry(async () => {
        try {
          const pair = `XBT${currency}`; // Kraken uses XBT for Bitcoin
        const response = await this.makePublicRequest('Ticker', { pair });
        
        const tickerData = response[pair];
        if (!tickerData) {
          throw new ExchangeError(`No price data found for ${pair}`, 'NO_PRICE_DATA');
        }

        // Validate price data
        const price = parseFloat(tickerData.c[0]);
        if (!price || price <= 0) {
          throw new ExchangeError(`Invalid price data: ${price}`, 'INVALID_PRICE_DATA');
        }

        return {
          symbol: 'BTC',
          price,
          currency,
          timestamp: new Date(),
          bid: parseFloat(tickerData.b[0]) || price,
          ask: parseFloat(tickerData.a[0]) || price,
          volume24h: parseFloat(tickerData.v[1]) || 0,
          change24h: parseFloat(tickerData.p[1]) || 0,
          changePercent24h: parseFloat(tickerData.p[1]) || 0
        };
        } catch (error) {
          const duration = timer.finish();
          metricsCollector.recordExchangeApiCall(
            'getCurrentPrice',
            duration,
            false,
            error instanceof Error && 'statusCode' in error ? (error as any).statusCode : undefined
          );
          
          if (error instanceof ExchangeError) {
            throw error;
          }
          // Let network errors bubble up for retry logic
          if (error instanceof Error && (
            (error as any).code === 'ECONNRESET' ||
            (error as any).code === 'ENOTFOUND' ||
            (error as any).code === 'ETIMEDOUT' ||
            (error as any).name === 'AbortError'
          )) {
            throw error;
          }
          throw new ExchangeError(
            `Failed to get current price: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'PRICE_FETCH_ERROR'
          );
        }
      }, 'PUBLIC');
    }).then(result => {
      const duration = timer.finish();
      metricsCollector.recordExchangeApiCall('getCurrentPrice', duration, true);
      return result;
    });
  }

  /**
   * Get order book for BTC/AUD pair
   */
  async getOrderBook(pair = 'XBTAUD'): Promise<OrderBook> {
    try {
      const response = await this.makePublicRequest('Depth', { pair, count: 100 });
      
      const orderBookData = response[pair];
      if (!orderBookData) {
        throw new ExchangeError(`No order book data found for ${pair}`);
      }

      return {
        symbol: pair,
        bids: orderBookData.bids.map((bid: string[]) => [parseFloat(bid[0]), parseFloat(bid[1])]),
        asks: orderBookData.asks.map((ask: string[]) => [parseFloat(ask[0]), parseFloat(ask[1])]),
        timestamp: new Date()
      };
    } catch (error) {
      throw new ExchangeError(
        `Failed to get order book: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'ORDER_BOOK_ERROR'
      );
    }
  }

  /**
   * Create market buy order to purchase Bitcoin with enhanced validation and retry
   */
  async createMarketOrder(order: MarketOrderRequest): Promise<OrderResult> {
    const timer = new PerformanceTimer('kraken_create_market_order');
    
    return this.circuitBreaker.execute(async () => {
      return this.withRetry(async () => {
      try {
        // Validate order parameters
        this.validateMarketOrder(order);
        
        const pair = `XBT${order.currency}`;
        
        const orderData: any = {
          pair,
          type: order.side,
          ordertype: 'market',
          validate: false
        };

        // Kraken market orders can specify volume (BTC amount) or value (AUD amount)
        if (order.amount) {
          if (order.amount <= 0) {
            throw new ExchangeError('Order amount must be positive', 'INVALID_AMOUNT');
          }
          orderData.volume = order.amount.toString();
        } else if (order.value) {
          if (order.value <= 0) {
            throw new ExchangeError('Order value must be positive', 'INVALID_VALUE');
          }
          // For market buy orders, use volume in quote currency
          orderData.volume = order.value.toString();
          orderData.oflags = 'viqc'; // Volume in quote currency
        } else {
          throw new ExchangeError('Either amount or value must be specified for market order', 'MISSING_ORDER_SIZE');
        }

        const response = await this.makePrivateRequest('AddOrder', orderData);
        
        if (!response.txid || response.txid.length === 0) {
          const errorMsg = response.descr?.order || 'Order was rejected by exchange';
          throw new OrderRejectedError(errorMsg, response.descr?.order);
        }

        const orderId = response.txid[0];
        
        // Get order details to return complete information
        const orderStatus = await this.getOrderStatus(orderId);
        
        return {
          orderId,
          status: orderStatus.status,
          side: order.side,
          symbol: 'BTC',
          amount: orderStatus.amount,
          filledAmount: orderStatus.filledAmount,
          remainingAmount: orderStatus.remainingAmount,
          averagePrice: orderStatus.averagePrice,
          totalValue: orderStatus.totalValue,
          fees: orderStatus.fees,
          timestamp: new Date(),
          rawData: response
        };
        } catch (error) {
          const duration = timer.finish();
          metricsCollector.recordExchangeApiCall(
            'createMarketOrder',
            duration,
            false,
            error instanceof Error && 'statusCode' in error ? (error as any).statusCode : undefined
          );
          
          if (error instanceof ExchangeError) {
            throw error;
          }
          throw new ExchangeError(
            `Failed to create market order: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'ORDER_CREATION_ERROR'
          );
        }
      }, 'TRADING');
    }).then(result => {
      const duration = timer.finish();
      metricsCollector.recordExchangeApiCall('createMarketOrder', duration, true);
      return result;
    });
  }

  /**
   * Create limit order (for advanced trading)
   */
  async createLimitOrder(order: LimitOrderRequest): Promise<OrderResult> {
    try {
      const pair = `XBT${order.currency}`;
      
      const orderData: any = {
        pair,
        type: order.side,
        ordertype: 'limit',
        price: order.price.toString(),
        volume: order.amount?.toString() || order.value?.toString(),
        validate: false
      };

      if (order.timeInForce) {
        orderData.timeinforce = order.timeInForce;
      }

      const response = await this.makePrivateRequest('AddOrder', orderData);
      
      if (!response.txid || response.txid.length === 0) {
        throw new OrderRejectedError('Limit order was rejected', response.descr?.order);
      }

      const orderId = response.txid[0];
      const orderStatus = await this.getOrderStatus(orderId);
      
      return {
        orderId,
        status: orderStatus.status,
        side: order.side,
        symbol: 'BTC',
        amount: orderStatus.amount,
        filledAmount: orderStatus.filledAmount,
        remainingAmount: orderStatus.remainingAmount,
        averagePrice: order.price,
        totalValue: orderStatus.totalValue,
        fees: orderStatus.fees,
        timestamp: new Date(),
        rawData: response
      };
    } catch (error) {
      if (error instanceof ExchangeError) {
        throw error;
      }
      throw new ExchangeError(
        `Failed to create limit order: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LIMIT_ORDER_ERROR'
      );
    }
  }

  /**
   * Get order status by ID
   */
  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    try {
      const response = await this.makePrivateRequest('QueryOrders', { txid: orderId });
      
      const orderData = response[orderId];
      if (!orderData) {
        throw new ExchangeError(`Order ${orderId} not found`);
      }

      const status = this.convertKrakenOrderStatus(orderData.status);
      const filledVolume = parseFloat(orderData.vol_exec || '0');
      const totalVolume = parseFloat(orderData.vol);
      
      return {
        orderId,
        status,
        side: orderData.descr.type as 'buy' | 'sell',
        symbol: 'BTC',
        amount: totalVolume,
        filledAmount: filledVolume,
        remainingAmount: totalVolume - filledVolume,
        averagePrice: parseFloat(orderData.price || orderData.descr.price || '0'),
        totalValue: parseFloat(orderData.cost || '0'),
        fees: orderData.fee ? [{
          amount: parseFloat(orderData.fee),
          currency: 'AUD', // Assume AUD trading
          type: 'trading' as const
        }] : [],
        timestamp: new Date(parseFloat(orderData.opentm) * 1000),
        isComplete: status === 'filled',
        isCancelled: status === 'cancelled',
        rawData: orderData
      };
    } catch (error) {
      throw new ExchangeError(
        `Failed to get order status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'ORDER_STATUS_ERROR'
      );
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<ExchangeBalance> {
    try {
      const response = await this.makePrivateRequest('Balance');
      
      const audBalance = parseFloat(response.ZAUD || '0');
      const btcBalance = parseFloat(response.XXBT || '0');
      
      return {
        currency: 'AUD',
        available: audBalance,
        total: audBalance,
        btc: {
          available: btcBalance,
          total: btcBalance
        }
      };
    } catch (error) {
      throw new ExchangeError(
        `Failed to get balance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BALANCE_ERROR'
      );
    }
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(since?: Date): Promise<ExchangeTransaction[]> {
    try {
      const params: any = {};
      if (since) {
        params.start = Math.floor(since.getTime() / 1000);
      }

      const response = await this.makePrivateRequest('TradesHistory', params);
      
      const transactions: ExchangeTransaction[] = [];
      
      for (const [txId, trade] of Object.entries(response.trades || {})) {
        const tradeData = trade as any;
        
        transactions.push({
          id: txId,
          type: 'trade',
          side: tradeData.type as 'buy' | 'sell',
          symbol: tradeData.pair,
          amount: parseFloat(tradeData.vol),
          currency: tradeData.type === 'buy' ? 'BTC' : 'AUD',
          price: parseFloat(tradeData.price),
          totalValue: parseFloat(tradeData.cost),
          fees: [{
            amount: parseFloat(tradeData.fee),
            currency: 'AUD',
            type: 'trading'
          }],
          status: 'completed',
          timestamp: new Date(parseFloat(tradeData.time) * 1000),
          orderId: tradeData.ordertxid,
          rawData: tradeData
        });
      }

      return transactions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      throw new ExchangeError(
        `Failed to get transaction history: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TRANSACTION_HISTORY_ERROR'
      );
    }
  }

  /**
   * Withdraw Bitcoin to external address with enhanced validation and retry
   */
  async withdrawBitcoin(request: WithdrawalRequest): Promise<WithdrawalResult> {
    const timer = new PerformanceTimer('kraken_withdraw_bitcoin');
    
    return this.circuitBreaker.execute(async () => {
      return this.withRetry(async () => {
      try {
        // Enhanced validation
        this.validateWithdrawalRequest(request);
        
        // Validate Bitcoin address format
        if (!this.isValidBitcoinAddress(request.address)) {
          throw new InvalidAddressError(request.address, 'BTC');
        }

        // Check minimum withdrawal amount
        const fees = await this.getWithdrawalFees();
        if (request.amount < fees.btc.minimum) {
          throw new ExchangeError(
            `Withdrawal amount ${request.amount} BTC is below minimum ${fees.btc.minimum} BTC`,
            'BELOW_MINIMUM_WITHDRAWAL'
          );
        }

        const withdrawData = {
          asset: 'XBT',
          key: request.address,
          amount: request.amount.toString()
        };

        // Add optional parameters
        if (request.description) {
          (withdrawData as any).description = request.description;
        }

        const response = await this.makePrivateRequest('Withdraw', withdrawData);
        
        if (!response.refid) {
          throw new ExchangeError('Withdrawal request failed - no reference ID returned', 'WITHDRAWAL_FAILED');
        }

        return {
          withdrawalId: response.refid,
          status: 'pending' as WithdrawalStatusType,
          currency: 'BTC',
          amount: request.amount,
          address: request.address,
          fees: [{
            amount: fees.btc.fixed,
            currency: 'BTC',
            type: 'withdrawal'
          }],
          estimatedConfirmationTime: 60, // ~1 hour for Bitcoin
          timestamp: new Date(),
          rawData: response
        };
        } catch (error) {
          const duration = timer.finish();
          metricsCollector.recordExchangeApiCall(
            'withdrawBitcoin',
            duration,
            false,
            error instanceof Error && 'statusCode' in error ? (error as any).statusCode : undefined
          );
          
          if (error instanceof ExchangeError) {
            throw error;
          }
          throw new ExchangeError(
            `Failed to withdraw Bitcoin: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'WITHDRAWAL_ERROR'
          );
        }
      }, 'WITHDRAWAL');
    }).then(result => {
      const duration = timer.finish();
      metricsCollector.recordExchangeApiCall('withdrawBitcoin', duration, true);
      return result;
    });
  }

  /**
   * Get withdrawal status
   */
  async getWithdrawalStatus(withdrawalId: string): Promise<WithdrawalStatus> {
    try {
      const response = await this.makePrivateRequest('WithdrawStatus', { refid: withdrawalId });
      
      const withdrawalData = response[withdrawalId];
      if (!withdrawalData) {
        throw new ExchangeError(`Withdrawal ${withdrawalId} not found`);
      }

      const status = this.convertKrakenWithdrawalStatus(withdrawalData.status);
      
      return {
        withdrawalId,
        status,
        currency: 'BTC',
        amount: parseFloat(withdrawalData.amount),
        address: withdrawalData.key,
        txId: withdrawalData.txid,
        fees: [{
          amount: parseFloat(withdrawalData.fee || '0'),
          currency: 'BTC',
          type: 'withdrawal'
        }],
        timestamp: new Date(parseFloat(withdrawalData.time) * 1000),
        isComplete: status === 'confirmed',
        rawData: withdrawalData
      };
    } catch (error) {
      throw new ExchangeError(
        `Failed to get withdrawal status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WITHDRAWAL_STATUS_ERROR'
      );
    }
  }

  /**
   * Get current trading fees
   */
  async getTradingFees(): Promise<TradingFees> {
    try {
      const response = await this.makePrivateRequest('TradeVolume', { pair: 'XBTAUD' });
      
      const feeData = response.fees?.XBTAUD;
      
      return {
        maker: parseFloat(feeData?.fee || '0.16'), // Default Kraken fees
        taker: parseFloat(feeData?.fee || '0.26'),
        currency: 'percentage',
        volumeDiscounts: response.fees_maker ? Object.entries(response.fees_maker).map(([volume, rate]) => ({
          volume30Day: parseFloat(volume),
          makerRate: parseFloat(rate as string),
          takerRate: parseFloat((response.fees as any)[volume] || rate as string)
        })) : undefined
      };
    } catch (error) {
      // Return default fees if API call fails
      return {
        maker: 0.16,
        taker: 0.26,
        currency: 'percentage'
      };
    }
  }

  /**
   * Get withdrawal fees
   */
  async getWithdrawalFees(): Promise<WithdrawalFees> {
    // Kraken withdrawal fees are fixed and can be hardcoded
    // These should be updated periodically or fetched from API if available
    return {
      btc: {
        fixed: 0.00015, // 0.00015 BTC withdrawal fee
        minimum: 0.001 // Minimum 0.001 BTC withdrawal
      }
    };
  }

  // Private helper methods

  private async makePublicRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    const url = `${this.baseUrl}/${this.apiVersion}/public/${endpoint}`;
    const queryParams = new URLSearchParams(params).toString();
    const fullUrl = queryParams ? `${url}?${queryParams}` : url;

    // Proper AbortController implementation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
      const response = await fetch(fullUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LIQUID-ABT/1.0 (Australian Bitcoin Treasury)'
        }
      });
      
      const data = await response.json();

      if (!response.ok || data.error?.length > 0) {
        const errorMsg = data.error?.[0] || response.statusText;
        throw new ExchangeError(
          `Kraken API error: ${errorMsg}`,
          this.getErrorCode(errorMsg),
          response.status,
          data
        );
      }

      return data.result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ExchangeError('Request timeout', 'TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async makePrivateRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    const nonce = (Date.now() * 1000).toString(); // Microsecond precision nonce
    const postData = new URLSearchParams({ ...params, nonce }).toString();
    
    const path = `/${this.apiVersion}/private/${endpoint}`;
    const signature = this.generateSignature(path, postData, nonce);

    // Proper AbortController implementation for private requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'API-Key': this.apiKey,
          'API-Sign': signature,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'LIQUID-ABT/1.0 (Australian Bitcoin Treasury)'
        },
        body: postData
      });

      const data = await response.json();

      if (!response.ok || data.error?.length > 0) {
        const errorMessage = data.error?.[0] || response.statusText;
        
        // Handle specific errors with proper parsing
        if (errorMessage.includes('Insufficient funds')) {
          const match = errorMessage.match(/Insufficient funds \(have: ([0-9.]+), need: ([0-9.]+)\)/);
          const available = match ? parseFloat(match[1]) : 0;
          const required = match ? parseFloat(match[2]) : 0;
          throw new InsufficientFundsError(available, required, 'BTC');
        }
        
        if (errorMessage.includes('Invalid arguments')) {
          throw new ExchangeError(
            `Invalid request parameters: ${errorMessage}`,
            'INVALID_ARGUMENTS',
            response.status,
            data
          );
        }
        
        throw new ExchangeError(
          `Kraken API error: ${errorMessage}`,
          this.getErrorCode(errorMessage),
          response.status,
          data
        );
      }

      return data.result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ExchangeError('Request timeout', 'TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private generateSignature(path: string, postData: string, nonce: string): string {
    const message = path + crypto.createHash('sha256').update(nonce + postData).digest();
    const secret = Buffer.from(this.privateKey, 'base64');
    return crypto.createHmac('sha512', secret).update(message).digest('base64');
  }

  private convertKrakenOrderStatus(krakenStatus: string): OrderStatusType {
    const statusMap: Record<string, OrderStatusType> = {
      'pending': 'pending',
      'open': 'open',
      'closed': 'filled',
      'canceled': 'cancelled',
      'expired': 'cancelled'
    };
    
    return statusMap[krakenStatus] || 'pending';
  }

  private convertKrakenWithdrawalStatus(krakenStatus: string): WithdrawalStatusType {
    const statusMap: Record<string, WithdrawalStatusType> = {
      'Initial': 'pending',
      'Pending': 'processing',
      'Settled': 'sent',
      'Success': 'confirmed',
      'Failure': 'failed',
      'Partial': 'processing'
    };
    
    return statusMap[krakenStatus] || 'pending';
  }

  private isValidBitcoinAddress(address: string): boolean {
    // Enhanced Bitcoin address validation
    // Legacy (1xxx): 26-35 characters, starts with 1
    // SegWit (3xxx): 26-35 characters, starts with 3  
    // Bech32 (bc1xxx): Variable length, starts with bc1
    
    if (!address || typeof address !== 'string') {
      return false;
    }
    
    const legacyRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const bech32Regex = /^bc1[02-9ac-hj-np-z]{7,87}$/;
    
    return legacyRegex.test(address) || bech32Regex.test(address);
  }

  // Validation helpers
  private validateMarketOrder(order: MarketOrderRequest): void {
    if (!order.side || !['buy', 'sell'].includes(order.side)) {
      throw new ExchangeError('Order side must be "buy" or "sell"', 'INVALID_SIDE');
    }
    
    if (!order.currency || typeof order.currency !== 'string') {
      throw new ExchangeError('Order currency is required', 'MISSING_CURRENCY');
    }
    
    if (!order.symbol || order.symbol !== 'BTC') {
      throw new ExchangeError('Only BTC trading is supported', 'UNSUPPORTED_SYMBOL');
    }
  }

  private validateWithdrawalRequest(request: WithdrawalRequest): void {
    if (!request.address || typeof request.address !== 'string') {
      throw new ExchangeError('Withdrawal address is required', 'MISSING_ADDRESS');
    }
    
    if (!request.amount || request.amount <= 0) {
      throw new ExchangeError('Withdrawal amount must be positive', 'INVALID_AMOUNT');
    }
    
    if (request.currency !== 'BTC') {
      throw new ExchangeError('Only BTC withdrawals are supported', 'UNSUPPORTED_CURRENCY');
    }
  }

  // Error code mapping
  private getErrorCode(errorMessage: string): string {
    if (errorMessage.includes('Rate limit exceeded')) return 'RATE_LIMIT_EXCEEDED';
    if (errorMessage.includes('Invalid nonce')) return 'INVALID_NONCE';
    if (errorMessage.includes('Invalid signature')) return 'INVALID_SIGNATURE';
    if (errorMessage.includes('Permission denied')) return 'PERMISSION_DENIED';
    if (errorMessage.includes('Unknown asset pair')) return 'UNKNOWN_PAIR';
    if (errorMessage.includes('Insufficient funds')) return 'INSUFFICIENT_FUNDS';
    if (errorMessage.includes('Invalid arguments')) return 'INVALID_ARGUMENTS';
    return 'API_ERROR';
  }

  // Retry mechanism with exponential backoff
  private async withRetry<T>(
    operation: () => Promise<T>,
    rateLimitType: 'PUBLIC' | 'PRIVATE' | 'TRADING' | 'WITHDRAWAL' = 'PRIVATE'
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Apply rate limiting before each attempt
        await this.applyRateLimit(rateLimitType);
        
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

  // Rate limiting implementation
  private async applyRateLimit(type: 'PUBLIC' | 'PRIVATE' | 'TRADING' | 'WITHDRAWAL'): Promise<void> {
    // Skip rate limiting in test environment
    if (process.env.NODE_ENV === 'test') {
      return Promise.resolve();
    }
    
    // Use proper rate limiter for production
    const rateLimiter = this.rateLimiters[type];
    
    // Create a mock NextRequest for the rate limiter
    // The key will be generated based on the endpoint type and provider
    const mockRequest = {
      ip: '127.0.0.1', // Local request for exchange API calls
      headers: new Headers(),
      nextUrl: new URL(`https://api.kraken.com/${type.toLowerCase()}`),
      method: 'POST'
    } as any;
    
    try {
      await rateLimiter(mockRequest);
    } catch (error) {
      // If rate limited, throw appropriate error
      throw new ExchangeError(
        `Rate limit exceeded for ${type} API`,
        'RATE_LIMIT_EXCEEDED'
      );
    }
  }
}