// LIQUID ABT - Jest Setup for Integration Tests

// Set test environment variables (use environment or defaults)
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test_user:test_pass@localhost:5432/liquid_abt_test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-integration'
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-integration'
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_fake_key_for_testing'
process.env.STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID || 'ca_test_fake_client_id_for_testing'
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_fake_webhook_secret'

// Correct exchange API keys (not Kraken)
process.env.ZEROCAP_API_KEY = process.env.ZEROCAP_API_KEY || 'test_zerocap_api_key'
process.env.ZEROCAP_API_SECRET = process.env.ZEROCAP_API_SECRET || 'test_zerocap_api_secret'
process.env.INDEPENDENT_RESERVE_API_KEY = process.env.INDEPENDENT_RESERVE_API_KEY || 'test_ir_api_key'
process.env.INDEPENDENT_RESERVE_API_SECRET = process.env.INDEPENDENT_RESERVE_API_SECRET || 'test_ir_api_secret'
process.env.BTC_MARKETS_API_KEY = process.env.BTC_MARKETS_API_KEY || 'test_btcmarkets_api_key'
process.env.BTC_MARKETS_API_SECRET = process.env.BTC_MARKETS_API_SECRET || 'test_btcmarkets_api_secret'

// Mock external services for integration tests
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn(),
    },
    oauth: {
      token: jest.fn(),
      deauthorize: jest.fn(),
    },
    accounts: {
      retrieve: jest.fn(),
    },
    charges: {
      list: jest.fn(),
    },
    refunds: {
      create: jest.fn(),
    },
  }))
})

// Exchange integration mocks for our actual exchanges (ZeroCap, Independent Reserve, BTC Markets)
// Note: These will be activated when the actual exchange integration files are implemented

// Global exchange factory for integration tests
global.createIntegrationExchangeMock = (exchangeName, basePrice = 65000) => ({
  isHealthy: jest.fn().mockResolvedValue(true),
  getCurrentPrice: jest.fn().mockResolvedValue({
    price: basePrice,
    currency: 'AUD',
    timestamp: new Date(),
    source: exchangeName,
    bid: basePrice - 50,
    ask: basePrice + 50,
    spread: 0.0015
  }),
  getBalance: jest.fn().mockResolvedValue({
    currency: 'AUD',
    available: 50000,
    total: 50000,
  }),
  createOrder: jest.fn().mockResolvedValue({
    orderId: `${exchangeName}_integration_${Date.now()}`,
    status: 'filled',
    amount: 1000.00,
    bitcoinAmount: 1000 / basePrice,
    executedPrice: basePrice,
    fees: exchangeName === 'zerocap' ? 15.00 : exchangeName === 'independent_reserve' ? 12.00 : 10.00,
    timestamp: new Date(),
  }),
  getOrderStatus: jest.fn().mockResolvedValue({
    orderId: `${exchangeName}_integration_${Date.now()}`,
    status: 'filled',
    executedAt: new Date(),
  }),
  withdrawBitcoin: jest.fn().mockResolvedValue({
    withdrawalId: `${exchangeName}_withdrawal_integration_${Date.now()}`,
    status: 'pending',
    amount: 1000 / basePrice,
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    txHash: null,
    estimatedConfirmationTime: exchangeName === 'zerocap' ? 30 : exchangeName === 'independent_reserve' ? 20 : 15,
  }),
});

// Commented out until exchange integration files are implemented
// jest.mock('@/lib/integrations/exchanges/zerocap', () => ({
//   ZeroCapExchange: jest.fn().mockImplementation(() => global.createIntegrationExchangeMock('zerocap', 65000))
// }));

// jest.mock('@/lib/integrations/exchanges/independentReserve', () => ({
//   IndependentReserveExchange: jest.fn().mockImplementation(() => global.createIntegrationExchangeMock('independent_reserve', 64800))
// }));

// jest.mock('@/lib/integrations/exchanges/btcMarkets', () => ({
//   BTCMarketsExchange: jest.fn().mockImplementation(() => global.createIntegrationExchangeMock('btc_markets', 64900))
// }));

// Suppress console logs in integration tests unless debugging
if (process.env.DEBUG !== 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}

// Increase timeout for integration tests
jest.setTimeout(30000)

// Cleanup after each test suite
afterAll(async () => {
  try {
    // Import cleanup utilities
    const { TestDatabaseUtils } = await import('./__tests__/utils/database')
    
    // Clean up test data created during this test run
    await TestDatabaseUtils.cleanup()
    
    // Don't disconnect here as other tests might still need the connection
    // Disconnection happens in global teardown
    
  } catch (error) {
    console.warn('Integration test cleanup warning:', error.message)
  }
})