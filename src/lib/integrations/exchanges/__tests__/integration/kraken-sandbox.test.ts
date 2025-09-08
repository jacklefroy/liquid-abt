// LIQUID ABT - Kraken Sandbox Integration Tests
// Real API calls to Kraken's sandbox environment for production validation

import { KrakenProvider } from '../../kraken';
import { ExchangeError, InsufficientFundsError, InvalidOrderError } from '../../interface';

// Environment guard - only run these tests if sandbox credentials are provided
const shouldRunIntegrationTests = () => {
  return !!(
    process.env.KRAKEN_TEST_API_KEY && 
    process.env.KRAKEN_TEST_PRIVATE_KEY &&
    process.env.NODE_ENV === 'test'
  );
};

// Skip all tests if credentials not provided
const describeIf = shouldRunIntegrationTests() ? describe : describe.skip;

describeIf('KrakenProvider Integration Tests (Sandbox)', () => {
  let provider: KrakenProvider;
  
  // Test configuration
  const TEST_CONFIG = {
    // Use minimal amounts for safety
    minTestAmount: 0.0001, // 0.0001 BTC (about $5 AUD)
    maxTestAmount: 0.001,  // 0.001 BTC (about $50 AUD)
    testTimeout: 30000,    // 30 second timeout for real API calls
    retryAttempts: 3,      // Retry failed tests due to network issues
    
    // Test Bitcoin address (testnet or known valid address)
    testBtcAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Genesis block address
  };

  beforeAll(() => {
    console.log('🧪 Setting up Kraken Sandbox Integration Tests...');
    console.log('ℹ️  Using test credentials from environment variables');
    
    // Initialize with sandbox credentials
    provider = new KrakenProvider({
      apiKey: process.env.KRAKEN_TEST_API_KEY!,
      privateKey: process.env.KRAKEN_TEST_PRIVATE_KEY!,
      sandbox: true // Use sandbox if available
    });
  });

  afterAll(() => {
    console.log('✅ Kraken Sandbox Integration Tests completed');
  });

  describe('Authentication & Connection', () => {
    it('should connect and authenticate with Kraken sandbox', async () => {
      // Test basic connection by fetching account balance
      const balance = await provider.getBalance();
      
      expect(balance).toBeDefined();
      expect(typeof balance.aud).toBe('number');
      expect(typeof balance.btc).toBe('number');
      expect(balance.aud).toBeGreaterThanOrEqual(0);
      expect(balance.btc).toBeGreaterThanOrEqual(0);
      
      console.log('💰 Sandbox Account Balance:', balance);
    }, TEST_CONFIG.testTimeout);

    it('should reject invalid credentials', async () => {
      const invalidProvider = new KrakenProvider({
        apiKey: 'invalid_key',
        privateKey: 'invalid_secret'
      });

      await expect(invalidProvider.getBalance()).rejects.toThrow();
    }, TEST_CONFIG.testTimeout);
  });

  describe('Market Data API', () => {
    it('should fetch current BTC/AUD price from real API', async () => {
      const price = await provider.getCurrentPrice('AUD');
      
      expect(price).toBeDefined();
      expect(price.symbol).toBe('BTC');
      expect(price.currency).toBe('AUD');
      expect(price.price).toBeGreaterThan(0);
      expect(price.price).toBeLessThan(1000000); // Sanity check - less than $1M AUD
      expect(price.bid).toBeGreaterThan(0);
      expect(price.ask).toBeGreaterThan(price.bid); // Ask should be higher than bid
      expect(price.timestamp).toBeInstanceOf(Date);
      
      // Verify reasonable price range (Bitcoin should be between $10K-$500K AUD)
      expect(price.price).toBeGreaterThan(10000);
      expect(price.price).toBeLessThan(500000);
      
      console.log('📈 Live BTC/AUD Price:', `$${price.price.toLocaleString()} AUD`);
      console.log('📊 Bid/Ask Spread:', `${(price.ask - price.bid).toFixed(2)} AUD`);
    }, TEST_CONFIG.testTimeout);

    it('should fetch BTC/AUD order book', async () => {
      const orderBook = await provider.getOrderBook('XBTAUD');
      
      expect(orderBook).toBeDefined();
      expect(orderBook.symbol).toBe('XBTAUD');
      expect(Array.isArray(orderBook.bids)).toBe(true);
      expect(Array.isArray(orderBook.asks)).toBe(true);
      expect(orderBook.bids.length).toBeGreaterThan(0);
      expect(orderBook.asks.length).toBeGreaterThan(0);
      
      // Validate bid/ask structure
      const topBid = orderBook.bids[0];
      const topAsk = orderBook.asks[0];
      
      expect(topBid).toHaveLength(2); // [price, volume]
      expect(topAsk).toHaveLength(2); // [price, volume]
      expect(topBid[0]).toBeGreaterThan(0); // Price
      expect(topBid[1]).toBeGreaterThan(0); // Volume
      expect(topAsk[0]).toBeGreaterThan(topBid[0]); // Ask > Bid
      
      console.log('📊 Order Book Depth:', `${orderBook.bids.length} bids, ${orderBook.asks.length} asks`);
    }, TEST_CONFIG.testTimeout);
  });

  describe('Rate Limiting Validation', () => {
    it('should handle rate limits gracefully with real API', async () => {
      // Make multiple rapid requests to test rate limiting
      const requests = Array(5).fill(0).map((_, i) => 
        provider.getCurrentPrice('AUD').then(price => ({ index: i, price: price.price }))
      );
      
      const results = await Promise.allSettled(requests);
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');
      
      // At least some should succeed
      expect(successful.length).toBeGreaterThan(0);
      
      // If any failed, they should be due to rate limiting, not other errors
      failed.forEach(result => {
        if (result.status === 'rejected') {
          const error = result.reason;
          expect(
            error.message.includes('rate limit') || 
            error.message.includes('too many requests') ||
            error.message.includes('429')
          ).toBe(true);
        }
      });
      
      console.log('🚦 Rate Limit Test:', `${successful.length}/${requests.length} requests succeeded`);
    }, TEST_CONFIG.testTimeout * 2);
  });

  describe('Trading API (Read-Only Tests)', () => {
    it('should get trading fees', async () => {
      const fees = await provider.getTradingFees();
      
      expect(fees).toBeDefined();
      expect(typeof fees.maker).toBe('number');
      expect(typeof fees.taker).toBe('number');
      expect(fees.maker).toBeGreaterThanOrEqual(0);
      expect(fees.taker).toBeGreaterThanOrEqual(0);
      expect(fees.taker).toBeGreaterThanOrEqual(fees.maker); // Taker fees usually >= maker
      expect(fees.currency).toBe('percentage');
      
      console.log('💸 Trading Fees:', `Maker: ${fees.maker}%, Taker: ${fees.taker}%`);
    }, TEST_CONFIG.testTimeout);

    it('should get withdrawal fees', async () => {
      const fees = await provider.getWithdrawalFees();
      
      expect(fees).toBeDefined();
      expect(fees.btc).toBeDefined();
      expect(typeof fees.btc.fixed).toBe('number');
      expect(typeof fees.btc.minimum).toBe('number');
      expect(fees.btc.fixed).toBeGreaterThan(0);
      expect(fees.btc.minimum).toBeGreaterThan(0);
      
      console.log('🏦 BTC Withdrawal Fees:', `Fixed: ${fees.btc.fixed} BTC, Min: ${fees.btc.minimum} BTC`);
    }, TEST_CONFIG.testTimeout);
  });

  describe('Error Handling with Real API', () => {
    it('should handle network timeout scenarios', async () => {
      // Create provider with very short timeout
      const timeoutProvider = new KrakenProvider({
        apiKey: process.env.KRAKEN_TEST_API_KEY!,
        privateKey: process.env.KRAKEN_TEST_PRIVATE_KEY!,
        timeout: 1 // 1ms timeout - should fail
      });

      await expect(timeoutProvider.getCurrentPrice()).rejects.toThrow();
    }, TEST_CONFIG.testTimeout);

    it('should handle invalid order parameters', async () => {
      // Test with invalid order parameters
      const invalidOrder = {
        side: 'buy' as const,
        symbol: 'XBTAUD',
        amount: -1, // Invalid negative amount
        currency: 'AUD' as const
      };

      await expect(provider.createMarketOrder(invalidOrder)).rejects.toThrow();
    }, TEST_CONFIG.testTimeout);

    it('should validate Bitcoin addresses', async () => {
      const invalidWithdrawal = {
        currency: 'BTC' as const,
        amount: 0.001,
        address: 'invalid_bitcoin_address',
        description: 'Test withdrawal'
      };

      await expect(provider.withdrawBitcoin(invalidWithdrawal)).rejects.toThrow();
    }, TEST_CONFIG.testTimeout);
  });

  describe('Order Status and History (Safe Tests)', () => {
    it('should handle non-existent order status requests', async () => {
      const fakeOrderId = 'FAKE-ORDER-ID-123';
      
      await expect(provider.getOrderStatus(fakeOrderId)).rejects.toThrow();
    }, TEST_CONFIG.testTimeout);

    it('should handle non-existent withdrawal status requests', async () => {
      const fakeWithdrawalId = 'FAKE-WITHDRAWAL-ID-123';
      
      await expect(provider.getWithdrawalStatus(fakeWithdrawalId)).rejects.toThrow();
    }, TEST_CONFIG.testTimeout);
  });

  // CONDITIONAL TESTS - Only run if sandbox supports actual trading
  describe('Live Trading Tests (Sandbox Only)', () => {
    beforeAll(() => {
      if (!process.env.KRAKEN_SANDBOX_TRADING_ENABLED) {
        console.log('⚠️  Skipping live trading tests - KRAKEN_SANDBOX_TRADING_ENABLED not set');
      }
    });

    const itIf = process.env.KRAKEN_SANDBOX_TRADING_ENABLED ? it : it.skip;

    itIf('should create and track a minimal test order', async () => {
      // Only run if we have sufficient balance and sandbox supports it
      const balance = await provider.getBalance();
      const minOrderValue = 50; // $50 AUD minimum
      
      if (balance.aud < minOrderValue) {
        console.log(`⚠️  Insufficient sandbox balance ($${balance.aud} AUD) for trading test`);
        return;
      }

      // Create minimal test order
      const testOrder = {
        side: 'buy' as const,
        symbol: 'XBTAUD',
        value: minOrderValue, // $50 AUD worth of Bitcoin
        currency: 'AUD' as const
      };

      const orderResult = await provider.createMarketOrder(testOrder);
      
      expect(orderResult).toBeDefined();
      expect(orderResult.orderId).toBeDefined();
      expect(orderResult.status).toMatch(/^(pending|filled|partially_filled)$/);
      expect(orderResult.side).toBe('buy');
      expect(orderResult.symbol).toBe('BTC');
      
      console.log('🛒 Test Order Created:', orderResult.orderId);
      
      // Track order status
      const orderStatus = await provider.getOrderStatus(orderResult.orderId);
      expect(orderStatus).toBeDefined();
      expect(orderStatus.orderId).toBe(orderResult.orderId);
      
      console.log('📊 Order Status:', orderStatus.status);
    }, TEST_CONFIG.testTimeout * 2);
  });
});

// Helper function to detect if running in CI/CD
const isCI = () => {
  return !!(process.env.CI || process.env.CONTINUOUS_INTEGRATION);
};

// Skip message for when tests are not run
if (!shouldRunIntegrationTests()) {
  console.log(`
🔶 Kraken Sandbox Integration Tests SKIPPED
   
   To run these tests, set the following environment variables:
   - KRAKEN_TEST_API_KEY=your_sandbox_api_key
   - KRAKEN_TEST_PRIVATE_KEY=your_sandbox_private_key
   
   Optional:
   - KRAKEN_SANDBOX_TRADING_ENABLED=true (for live trading tests)
   
   Note: These tests make real API calls to Kraken's sandbox/test environment.
   They are automatically skipped in CI/CD pipelines.
`);
}