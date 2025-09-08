import { zeroCapMock, MockTradeParams, MockTradeResponse } from '@/lib/sandbox/zerocap-mock';

export interface ZeroCapTradeParams {
  amount: number;
  currency: 'AUD' | 'USD';
  type: 'buy' | 'sell';
  customerReference?: string;
  customerAddress?: string; // Bitcoin address for purchases
}

export interface ZeroCapTradeResponse {
  success: boolean;
  transactionId: string;
  bitcoinAmount: number;
  timestamp: string;
  rate: number;
  fees: number;
  error?: string;
  networkLatency?: number;
}

export interface ZeroCapBalance {
  success: boolean;
  balance: number;
  currency: string;
  error?: string;
}

export interface ZeroCapTransactionStatus {
  success: boolean;
  status: 'pending' | 'completed' | 'failed' | 'unknown';
  details?: any;
  error?: string;
}

export class ZeroCapService {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor() {
    this.apiUrl = process.env.ZEROCAP_API_URL || 'https://api.zerocap.com/v1';
    this.apiKey = process.env.ZEROCAP_API_KEY || '';
    this.apiSecret = process.env.ZEROCAP_API_SECRET || '';
  }

  private async makeRequest(endpoint: string, method: 'GET' | 'POST' = 'GET', data?: any): Promise<any> {
    // If mock mode is enabled, don't make real API calls
    if (process.env.ZEROCAP_USE_MOCK === 'true') {
      throw new Error('Real API call attempted while in mock mode');
    }

    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'Authorization': `Bearer ${this.apiSecret}`,
        },
        body: data ? JSON.stringify(data) : undefined,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ZeroCap API error:', error);
      throw error;
    }
  }

  async executeTrade(params: ZeroCapTradeParams): Promise<ZeroCapTradeResponse> {
    // Use mock service if enabled
    if (process.env.ZEROCAP_USE_MOCK === 'true') {
      console.log('[ZeroCap] Using mock service for trade execution');
      const mockParams: MockTradeParams = {
        amount: params.amount,
        currency: params.currency,
        type: params.type,
        customerReference: params.customerReference
      };
      
      const mockResponse = await zeroCapMock.executeTrade(mockParams);
      
      // Convert mock response to ZeroCap format
      return {
        success: mockResponse.success,
        transactionId: mockResponse.transactionId,
        bitcoinAmount: mockResponse.bitcoinAmount,
        timestamp: mockResponse.timestamp,
        rate: mockResponse.rate,
        fees: mockResponse.fees,
        error: mockResponse.error,
        networkLatency: mockResponse.networkLatency
      };
    }

    // Real ZeroCap API implementation
    try {
      const response = await this.makeRequest('/trade', 'POST', {
        amount: params.amount,
        currency: params.currency,
        type: params.type,
        customer_reference: params.customerReference,
        customer_address: params.customerAddress
      });

      return {
        success: true,
        transactionId: response.transaction_id,
        bitcoinAmount: response.bitcoin_amount,
        timestamp: response.timestamp,
        rate: response.rate,
        fees: response.fees
      };
    } catch (error) {
      return {
        success: false,
        transactionId: '',
        bitcoinAmount: 0,
        timestamp: new Date().toISOString(),
        rate: 0,
        fees: 0,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getBalance(): Promise<ZeroCapBalance> {
    // Use mock service if enabled
    if (process.env.ZEROCAP_USE_MOCK === 'true') {
      console.log('[ZeroCap] Using mock service for balance check');
      return await zeroCapMock.getBalance();
    }

    // Real ZeroCap API implementation
    try {
      const response = await this.makeRequest('/balance');
      return {
        success: true,
        balance: response.balance,
        currency: response.currency
      };
    } catch (error) {
      return {
        success: false,
        balance: 0,
        currency: 'AUD',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getTransactionStatus(transactionId: string): Promise<ZeroCapTransactionStatus> {
    // Use mock service if enabled
    if (process.env.ZEROCAP_USE_MOCK === 'true') {
      console.log('[ZeroCap] Using mock service for transaction status');
      return await zeroCapMock.getTransactionStatus(transactionId);
    }

    // Real ZeroCap API implementation
    try {
      const response = await this.makeRequest(`/transaction/${transactionId}`);
      return {
        success: true,
        status: response.status,
        details: response
      };
    } catch (error) {
      return {
        success: false,
        status: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getCurrentRate(currency: 'AUD' | 'USD' = 'AUD'): Promise<{
    success: boolean;
    rate: number;
    currency: string;
    timestamp: string;
    error?: string;
  }> {
    // Use mock service if enabled (simplified rate fetching)
    if (process.env.ZEROCAP_USE_MOCK === 'true') {
      console.log('[ZeroCap] Using mock service for rate check');
      // Mock rates with slight variation
      const baseRate = currency === 'AUD' ? 45000 : 30000;
      const variation = (Math.random() - 0.5) * 2000;
      const rate = Math.round(baseRate + variation);

      return {
        success: true,
        rate,
        currency,
        timestamp: new Date().toISOString()
      };
    }

    // Real ZeroCap API implementation
    try {
      const response = await this.makeRequest(`/rate?currency=${currency}`);
      return {
        success: true,
        rate: response.rate,
        currency: response.currency,
        timestamp: response.timestamp
      };
    } catch (error) {
      return {
        success: false,
        rate: 0,
        currency,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  // Health check method
  async healthCheck(): Promise<{ success: boolean; service: string; mode: string; error?: string }> {
    const mode = process.env.ZEROCAP_USE_MOCK === 'true' ? 'mock' : 'production';
    
    try {
      if (process.env.ZEROCAP_USE_MOCK === 'true') {
        // Test mock service
        const stats = zeroCapMock.getStats();
        return {
          success: true,
          service: 'ZeroCap',
          mode,
          ...stats
        };
      } else {
        // Test real API
        const response = await this.makeRequest('/health');
        return {
          success: response.status === 'ok',
          service: 'ZeroCap',
          mode
        };
      }
    } catch (error) {
      return {
        success: false,
        service: 'ZeroCap',
        mode,
        error: error instanceof Error ? error.message : 'Health check failed'
      };
    }
  }
}

// Singleton instance
export const zeroCapService = new ZeroCapService();