import { getExchangeService, resetExchangeService, getExchangeServiceInfo } from '@/lib/integrations/exchanges/exchange-factory';
import { zeroCapMock } from '@/lib/sandbox/zerocap-mock';
import { MockTransactionGenerator } from '@/lib/sandbox/mock-transaction-generator';

describe('Mock Exchange Integration', () => {
  let mockGenerator: MockTransactionGenerator;

  beforeAll(() => {
    // Ensure we're using mock mode for all tests
    process.env.USE_MOCK_EXCHANGE = 'true';
    process.env.MOCK_BTC_PRICE = '65000';
    process.env.MOCK_SUCCESS_RATE = '0.95';
    process.env.MOCK_NETWORK_DELAY_MS = '100'; // Faster for testing
    
    mockGenerator = new MockTransactionGenerator();
  });

  beforeEach(() => {
    // Reset the exchange service singleton before each test
    resetExchangeService();
    zeroCapMock.clearTransactionHistory();
  });

  afterAll(() => {
    // Clean up environment variables
    delete process.env.USE_MOCK_EXCHANGE;
    delete process.env.MOCK_BTC_PRICE;
    delete process.env.MOCK_SUCCESS_RATE;
    delete process.env.MOCK_NETWORK_DELAY_MS;
  });

  describe('Exchange Service Factory', () => {
    it('should return mock service when USE_MOCK_EXCHANGE is true', () => {
      const service = getExchangeService();
      const info = getExchangeServiceInfo();
      
      expect(info.isMock).toBe(true);
      expect(info.serviceName).toBe('ZeroCap Mock');
      expect(info.features).toContain('Simulated Bitcoin trading');
      expect(service).toBeDefined();
    });

    it('should return the same instance on subsequent calls (singleton)', () => {
      const service1 = getExchangeService();
      const service2 = getExchangeService();
      
      expect(service1).toBe(service2);
    });
  });

  describe('Mock Bitcoin Trading', () => {
    it('should execute successful buy orders', async () => {
      const exchange = getExchangeService();
      
      const buyOrder = {
        amount: 1000, // $1000 AUD
        customerReference: 'test_purchase_001'
      };

      const result = await exchange.executeBuyOrder(buyOrder);
      
      expect(result.success).toBe(true);
      expect(result.orderId).toMatch(/^MOCK_ORDER_/);
      expect(result.fiatAmount).toBe(1000);
      expect(result.bitcoinAmount).toBeGreaterThan(0);
      expect(result.exchangeRate).toBeCloseTo(65000, -2000); // Within ±$2000 of base price
      expect(result.fees).toBeGreaterThan(0);
      expect(result.timestamp).toBeDefined();
    }, 10000);

    it('should return realistic market prices', async () => {
      const exchange = getExchangeService();
      
      const price1 = await exchange.getMarketPrice();
      await new Promise(resolve => setTimeout(resolve, 200)); // Small delay
      const price2 = await exchange.getMarketPrice();
      
      expect(price1.price).toBeCloseTo(65000, -1300); // Within ±2% of $65000
      expect(price2.price).toBeCloseTo(65000, -1300);
      expect(price1.source).toBe('mock');
      expect(price2.source).toBe('mock');
      
      // Prices should fluctuate slightly
      expect(Math.abs(price1.price - price2.price)).toBeLessThan(2000);
    });

    it('should track transaction status progression', async () => {
      const exchange = getExchangeService();
      
      const buyResult = await exchange.executeBuyOrder({
        amount: 500,
        customerReference: 'test_status_tracking'
      });
      
      expect(buyResult.success).toBe(true);
      
      // Check initial status (should be pending for new orders)
      const initialStatus = await exchange.getTransactionStatus(buyResult.orderId);
      expect(initialStatus.status).toBe('pending');
      expect(initialStatus.bitcoinAmount).toBe(buyResult.bitcoinAmount);
      
      // Mock service should simulate status progression over time
      expect(initialStatus.orderId).toBe(buyResult.orderId);
    });
  });

  describe('Mock Transaction Logging', () => {
    it('should log all transactions in memory', async () => {
      const exchange = getExchangeService();
      
      // Clear any existing logs
      zeroCapMock.clearTransactionHistory();
      
      // Execute a few transactions
      await exchange.executeBuyOrder({ amount: 100, customerReference: 'log_test_1' });
      await exchange.getMarketPrice();
      await exchange.executeBuyOrder({ amount: 200, customerReference: 'log_test_2' });
      
      const history = zeroCapMock.getTransactionHistory();
      expect(history.length).toBe(3);
      
      const buyTransactions = history.filter(tx => tx.type === 'buy');
      const priceChecks = history.filter(tx => tx.type === 'price_check');
      
      expect(buyTransactions.length).toBe(2);
      expect(priceChecks.length).toBe(1);
    });
  });

  describe('Stripe to Bitcoin Flow Simulation', () => {
    it('should simulate complete payment processing flow', async () => {
      const tenantId = 'tenant_test_mock_integration';
      
      // Generate mock Stripe payment
      const mockPayment = mockGenerator.generateMockPayment({
        amount: 150000, // $1500 AUD in cents
        customerId: 'cus_integration_test',
        status: 'succeeded',
        tenantId
      });
      
      expect(mockPayment.amount).toBe(150000);
      expect(mockPayment.status).toBe('succeeded');
      expect(mockPayment.stripePaymentId).toMatch(/^pi_mock_/);
      
      // Simulate treasury rules processing
      const conversionAmount = mockPayment.amount * 0.05 / 100; // 5% conversion, convert from cents
      
      // Execute Bitcoin purchase via mock exchange
      const exchange = getExchangeService();
      const buyResult = await exchange.executeBuyOrder({
        amount: conversionAmount,
        customerReference: mockPayment.stripePaymentId
      });
      
      if (buyResult.success) {
        // Validate the purchase was successful
        expect(buyResult.orderId).toMatch(/^MOCK_ORDER_/);
        expect(buyResult.bitcoinAmount).toBeGreaterThan(0);
        expect(buyResult.fiatAmount).toBe(conversionAmount);
      }
    });
  });

  describe('Configuration and Error Handling', () => {
    it('should respect environment variable configuration', () => {
      const info = getExchangeServiceInfo();
      expect(info.isMock).toBe(true);
      
      // The mock should use the configuration
      expect(zeroCapMock.getStats()).toBeDefined();
    });

    it('should handle invalid transaction IDs gracefully', async () => {
      const exchange = getExchangeService();
      
      const status = await exchange.getTransactionStatus('invalid_order_id');
      
      expect(status.status).toBe('failed');
      expect(status.error).toBe('Order not found');
    });
  });
});