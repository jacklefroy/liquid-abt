// LIQUID ABT - Common Jest Setup for All Test Projects
// Shared mocks and configurations for ZeroCap, Independent Reserve, BTC Markets

// Mock environment variables for consistent testing
process.env.NODE_ENV = 'test';
process.env.NEXTAUTH_SECRET = 'test-secret-key';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test_user:test_pass@localhost:5432/liquid_abt_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';

// Australian compliance test environment
process.env.AUSTRAC_ENTITY_ID = 'TEST_ENTITY_123456789';
process.env.AUSTRAC_REPORTING_ENTITY_NUMBER = 'TEST_REN_987654321';
process.env.ABN_LOOKUP_API_KEY = 'test-abn-api-key';
process.env.TWILIO_ACCOUNT_SID = 'test-twilio-sid';
process.env.TWILIO_AUTH_TOKEN = 'test-twilio-token';

// Exchange API credentials for testing (sandbox/mock)
process.env.ZEROCAP_API_KEY = 'test-zerocap-key';
process.env.ZEROCAP_API_SECRET = 'test-zerocap-secret';
process.env.INDEPENDENT_RESERVE_API_KEY = 'test-ir-key';
process.env.INDEPENDENT_RESERVE_API_SECRET = 'test-ir-secret';
process.env.BTC_MARKETS_API_KEY = 'test-btcmarkets-key';
process.env.BTC_MARKETS_API_SECRET = 'test-btcmarkets-secret';

// Mock Redis client
jest.mock('ioredis', () => {
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    exists: jest.fn(),
    flushall: jest.fn(),
    quit: jest.fn(),
    disconnect: jest.fn(),
  };
  return jest.fn(() => mockRedis);
});

// Exchange mocks (will be activated when the actual exchange files are implemented)
// These are prepared for our actual exchanges: ZeroCap, Independent Reserve, BTC Markets

// Global exchange mock factory for consistent testing
global.createExchangeMock = (exchangeName, basePrice = 65000) => ({
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
  createOrder: jest.fn().mockResolvedValue({
    orderId: `${exchangeName}_order_${Date.now()}`,
    status: 'filled',
    amount: 1000.00,
    bitcoinAmount: 1000 / basePrice,
    executedPrice: basePrice,
    fees: exchangeName === 'zerocap' ? 15.00 : exchangeName === 'independent_reserve' ? 12.00 : 10.00,
    timestamp: new Date()
  }),
  getOrderStatus: jest.fn().mockResolvedValue({
    orderId: `${exchangeName}_order_${Date.now()}`,
    status: 'filled',
    executedAt: new Date()
  }),
  getBalance: jest.fn().mockResolvedValue({
    currency: 'AUD',
    available: 50000.00,
    total: 50000.00
  }),
  withdrawBitcoin: jest.fn().mockResolvedValue({
    withdrawalId: `${exchangeName}_withdrawal_${Date.now()}`,
    status: 'pending',
    amount: 1000 / basePrice,
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    txHash: null,
    estimatedConfirmationTime: 30
  })
});

// Note: These exchange mocks will be uncommented when the actual exchange integration files are created
// For now, commenting them out to avoid Jest module resolution errors

// jest.mock('@/lib/integrations/exchanges/zerocap', () => ({
//   ZeroCapExchange: jest.fn().mockImplementation(() => global.createExchangeMock('zerocap', 65000))
// }));

// jest.mock('@/lib/integrations/exchanges/independentReserve', () => ({
//   IndependentReserveExchange: jest.fn().mockImplementation(() => global.createExchangeMock('independent_reserve', 64800))
// }));

// jest.mock('@/lib/integrations/exchanges/btcMarkets', () => ({
//   BTCMarketsExchange: jest.fn().mockImplementation(() => global.createExchangeMock('btc_markets', 64900))
// }));

// Mock Australian compliance services - these will be uncommented when implemented
// jest.mock('@/lib/compliance/abnLookup', () => ({
//   abnLookupService: {
//     validateABN: jest.fn().mockResolvedValue({
//       isValid: true,
//       abn: '12345678901',
//       entityName: 'TEST COMPANY PTY LTD',
//       entityType: 'PRV',
//       gstStatus: 'Current',
//       dgr: false
//     }),
//     getBusinessDetails: jest.fn().mockResolvedValue({
//       abn: '12345678901',
//       entityName: 'TEST COMPANY PTY LTD',
//       tradingNames: ['Test Trading Name'],
//       businessAddress: {
//         stateCode: 'NSW',
//         postcode: '2000'
//       },
//       industryCode: '6201',
//       industryDescription: 'Computer System Design and Related Services'
//     })
//   }
// }));

// jest.mock('@/lib/compliance/austracReporting', () => ({
//   austracReportingService: {
//     checkThresholdTransaction: jest.fn().mockResolvedValue({
//       requiresReporting: false,
//       thresholdAmount: 10000,
//       transactionAmount: 5000
//     }),
//     generateTTR: jest.fn().mockResolvedValue({
//       id: 'TTR_20250907_12345678',
//       reportType: 'TTR',
//       status: 'generated',
//       recordCount: 5,
//       filePath: '/tmp/ttr_20250907_12345678.xml',
//       generatedAt: new Date()
//     }),
//     generateSMR: jest.fn().mockResolvedValue({
//       id: 'SMR_20250907_87654321',
//       reportType: 'SMR',
//       status: 'generated',
//       recordCount: 1,
//       filePath: '/tmp/smr_20250907_87654321.xml',
//       generatedAt: new Date()
//     })
//   }
// }));

// Mock Twilio SMS service for Australian 2FA - commented until twilio is installed
// jest.mock('twilio', () => {
//   return jest.fn(() => ({
//     messages: {
//       create: jest.fn().mockResolvedValue({
//         sid: 'SM_test_message_123456',
//         status: 'sent',
//         to: '+61412345678',
//         from: '+61412000000',
//         body: 'Your LIQUID ABT verification code is: 123456',
//         dateCreated: new Date(),
//         dateSent: new Date()
//       })
//     },
//     lookups: {
//       phoneNumbers: jest.fn().mockImplementation((phoneNumber) => ({
//         fetch: jest.fn().mockResolvedValue({
//           phoneNumber: phoneNumber,
//           countryCode: 'AU',
//           nationalFormat: '0412 345 678',
//           valid: phoneNumber.startsWith('+614') || phoneNumber.startsWith('+613'),
//           carrier: {
//             name: 'Telstra',
//             type: 'mobile'
//           }
//         })
//       }))
//     }
//   }));
// });

// Mock Bitcoin address validation - commented until implemented
// jest.mock('@/lib/bitcoin/addressValidation', () => ({
//   bitcoinAddressValidator: {
//     validateAddress: jest.fn().mockImplementation((address) => {
//       // Mock validation for different Bitcoin address formats
//       const legacyPattern = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
//       const segwitPattern = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
//       const bech32Pattern = /^bc1[a-z0-9]{39,59}$/;
//       
//       const isValid = legacyPattern.test(address) || segwitPattern.test(address) || bech32Pattern.test(address);
//       
//       let addressType = 'unknown';
//       if (legacyPattern.test(address)) addressType = 'legacy';
//       else if (segwitPattern.test(address)) addressType = 'segwit';
//       else if (bech32Pattern.test(address)) addressType = 'bech32';
//       
//       return {
//         isValid,
//         addressType,
//         network: 'mainnet'
//       };
//     }),
//     
//     isWhitelisted: jest.fn().mockResolvedValue({
//       isWhitelisted: true,
//       approvedAt: new Date(),
//       approvedBy: 'system',
//       waitingPeriodEnds: new Date()
//     })
//   }
// }));

// Mock database connection for multi-tenant testing - commented until connection module exists
// jest.mock('@/lib/database/connection', () => ({
//   getTenantConnection: jest.fn().mockResolvedValue({
//     query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
//     release: jest.fn()
//   }),
//   testTenantIsolation: jest.fn().mockResolvedValue({
//     isolated: true,
//     tenantId: 'test-tenant-123',
//     schemaExists: true
//   })
// }));

// Console suppression for cleaner test output
const originalConsole = { ...console };
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: originalConsole.error // Keep errors visible
};

// Global test utilities
global.testUtils = {
  // Generate test tenant ID
  generateTenantId: () => `tenant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  
  // Generate test user
  generateTestUser: (role = 'USER') => ({
    id: `user_${Date.now()}`,
    email: `test${Date.now()}@example.com.au`,
    role,
    tenantId: global.testUtils.generateTenantId(),
    phoneNumber: '+61412345678',
    mfaEnabled: true,
    isActive: true,
    createdAt: new Date()
  }),
  
  // Generate test Bitcoin purchase
  generateTestPurchase: (amount = 1000) => ({
    id: `purchase_${Date.now()}`,
    amount,
    bitcoinAmount: amount / 65000, // Approximate BTC amount
    status: 'completed',
    exchange: 'zerocap',
    orderId: `order_${Date.now()}`,
    createdAt: new Date(),
    completedAt: new Date()
  }),
  
  // Australian business test data
  generateAustralianBusiness: () => ({
    abn: '12345678901',
    entityName: 'TEST PTY LTD',
    tradingName: 'Test Business',
    address: {
      street: '123 Test Street',
      suburb: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      country: 'AU'
    },
    industryCode: '6201',
    gstRegistered: true
  })
};

// Cleanup after tests
afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  global.console = originalConsole;
});