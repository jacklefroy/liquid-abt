import { zeroCapMock, ZeroCapMock } from '@/lib/sandbox/zerocap-mock';

// Define the common interface that both real and mock services must implement
export interface ExchangeService {
  executeBuyOrder(order: {
    amount: number;
    customerReference?: string;
    withdrawalAddress?: string;
  }): Promise<{
    success: boolean;
    orderId: string;
    bitcoinAmount: number;
    fiatAmount: number;
    exchangeRate: number;
    fees: number;
    timestamp: string;
    error?: string;
  }>;

  getMarketPrice(): Promise<{
    price: number;
    timestamp: string;
    source: string;
  }>;

  withdrawToWallet(withdrawal: {
    bitcoinAmount: number;
    destinationAddress: string;
    customerReference?: string;
  }): Promise<{
    success: boolean;
    withdrawalId: string;
    bitcoinAmount: number;
    fees: number;
    estimatedConfirmationTime: string;
    error?: string;
  }>;

  getTransactionStatus(orderId: string): Promise<{
    orderId: string;
    status: 'pending' | 'confirmed' | 'completed' | 'failed';
    bitcoinAmount?: number;
    confirmations?: number;
    txHash?: string;
    error?: string;
  }>;
}

// Real ZeroCap service wrapper (placeholder for future implementation)
class RealZeroCapService implements ExchangeService {
  async executeBuyOrder(order: {
    amount: number;
    customerReference?: string;
    withdrawalAddress?: string;
  }) {
    throw new Error('Real ZeroCap API not yet implemented. Please use mock mode by setting USE_MOCK_EXCHANGE=true');
  }

  async getMarketPrice() {
    throw new Error('Real ZeroCap API not yet implemented. Please use mock mode by setting USE_MOCK_EXCHANGE=true');
  }

  async withdrawToWallet(withdrawal: {
    bitcoinAmount: number;
    destinationAddress: string;
    customerReference?: string;
  }) {
    throw new Error('Real ZeroCap API not yet implemented. Please use mock mode by setting USE_MOCK_EXCHANGE=true');
  }

  async getTransactionStatus(orderId: string) {
    throw new Error('Real ZeroCap API not yet implemented. Please use mock mode by setting USE_MOCK_EXCHANGE=true');
  }
}

// Mock service wrapper that adapts ZeroCapMock to ExchangeService interface
class MockExchangeServiceWrapper implements ExchangeService {
  constructor(private mockService: ZeroCapMock) {}

  async executeBuyOrder(order: {
    amount: number;
    customerReference?: string;
    withdrawalAddress?: string;
  }) {
    return await this.mockService.executeBuyOrder(order);
  }

  async getMarketPrice() {
    const result = await this.mockService.getMarketPrice();
    return {
      price: result.price,
      timestamp: result.timestamp,
      source: result.source
    };
  }

  async withdrawToWallet(withdrawal: {
    bitcoinAmount: number;
    destinationAddress: string;
    customerReference?: string;
  }) {
    return await this.mockService.withdrawToWallet(withdrawal);
  }

  async getTransactionStatus(orderId: string) {
    return await this.mockService.getTransactionStatus(orderId);
  }
}

// Singleton instance
let exchangeServiceInstance: ExchangeService | null = null;

export function getExchangeService(): ExchangeService {
  if (exchangeServiceInstance) {
    return exchangeServiceInstance;
  }

  const useMock = process.env.USE_MOCK_EXCHANGE === 'true';
  
  if (useMock) {
    console.log('[Exchange Factory] Using mock exchange service');
    exchangeServiceInstance = new MockExchangeServiceWrapper(zeroCapMock);
  } else {
    console.log('[Exchange Factory] Using real ZeroCap API service');
    exchangeServiceInstance = new RealZeroCapService();
  }

  return exchangeServiceInstance;
}

// Reset the singleton (useful for testing)
export function resetExchangeService(): void {
  exchangeServiceInstance = null;
}

// Get service type information
export function getExchangeServiceInfo(): {
  isMock: boolean;
  serviceName: string;
  features: string[];
} {
  const useMock = process.env.USE_MOCK_EXCHANGE === 'true';
  
  return {
    isMock: useMock,
    serviceName: useMock ? 'ZeroCap Mock' : 'ZeroCap Live API',
    features: useMock 
      ? [
          'Simulated Bitcoin trading',
          '95% success rate',
          'Realistic network delays',
          'Price fluctuation (±2%)',
          'Transaction history logging',
          'Configurable parameters'
        ]
      : [
          'Live Bitcoin trading',
          'Real market prices',
          'Actual Bitcoin transactions',
          'Production-ready'
        ]
  };
}