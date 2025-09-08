// LIQUID ABT - Test Mocks and Utilities

import { jest } from '@jest/globals'

/**
 * Mock Stripe webhook event
 */
export const mockStripeWebhookEvent = (eventType = 'payment_intent.succeeded', overrides = {}) => ({
  id: `evt_test_${Date.now()}`,
  object: 'event',
  type: eventType,
  data: {
    object: {
      id: `pi_test_${Date.now()}`,
      object: 'payment_intent',
      amount: 10000, // $100.00 in cents
      currency: 'aud',
      status: 'succeeded',
      metadata: {},
      ...overrides.data
    }
  },
  created: Math.floor(Date.now() / 1000),
  ...overrides
})

/**
 * Mock Kraken API responses
 */
export const mockKrakenResponses = {
  getCurrentPrice: {
    symbol: 'BTC',
    price: 95000,
    currency: 'AUD',
    timestamp: new Date(),
    bid: 94950,
    ask: 95050,
    volume24h: 1234.5,
    change24h: 2.5,
    changePercent24h: 2.5
  },
  
  getBalance: {
    currency: 'AUD',
    available: 10000,
    total: 10000,
    btc: {
      available: 0.1,
      total: 0.1
    }
  },
  
  createMarketOrder: {
    orderId: `test_order_${Date.now()}`,
    status: 'filled' as const,
    side: 'buy' as const,
    symbol: 'BTC',
    amount: 0.001,
    filledAmount: 0.001,
    averagePrice: 95000,
    totalValue: 95,
    fees: [{ amount: 1.5, currency: 'AUD', type: 'trading' as const }],
    timestamp: new Date()
  },
  
  withdrawBitcoin: {
    withdrawalId: `test_withdrawal_${Date.now()}`,
    status: 'pending' as const,
    currency: 'BTC',
    amount: 0.001,
    address: 'bc1qtest123...',
    fees: [{ amount: 0.0001, currency: 'BTC', type: 'withdrawal' as const }],
    estimatedConfirmationTime: 60,
    timestamp: new Date()
  }
}

/**
 * Mock JWT token for testing
 */
export const mockJWTToken = (payload = {}) => {
  const defaultPayload = {
    userId: 'test-user-123',
    tenantId: 'test-tenant-123',
    email: 'test@example.com',
    role: 'USER',
    subdomain: 'testco',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  }
  
  return {
    payload: { ...defaultPayload, ...payload },
    token: `mock.jwt.token.${Date.now()}`
  }
}

/**
 * Mock Express request/response for API testing
 */
export const mockRequest = (overrides = {}) => ({
  headers: {},
  body: {},
  query: {},
  params: {},
  method: 'GET',
  url: '/test',
  ...overrides
})

export const mockResponse = () => {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  res.send = jest.fn().mockReturnValue(res)
  res.end = jest.fn().mockReturnValue(res)
  res.cookie = jest.fn().mockReturnValue(res)
  res.redirect = jest.fn().mockReturnValue(res)
  return res
}

/**
 * Mock Next.js API request/response
 */
export const mockNextRequest = (overrides = {}) => ({
  headers: new Map(),
  nextUrl: new URL('http://localhost:3000/test'),
  cookies: new Map(),
  json: jest.fn().mockResolvedValue({}),
  text: jest.fn().mockResolvedValue(''),
  formData: jest.fn().mockResolvedValue(new FormData()),
  ...overrides
})

export const mockNextResponse = {
  json: jest.fn(),
  redirect: jest.fn(),
  rewrite: jest.fn(),
  next: jest.fn()
}

/**
 * Mock authenticated request with user context
 */
export const mockAuthenticatedRequest = (userOverrides = {}, requestOverrides = {}) => {
  const mockUser = {
    userId: 'test-user-123',
    tenantId: 'test-tenant-123',
    email: 'test@example.com',
    role: 'USER',
    subdomain: 'testco',
    ...userOverrides
  }

  return {
    ...mockNextRequest(requestOverrides),
    user: mockUser
  }
}

/**
 * Helper to create test data consistently
 */
export const createTestData = {
  tenant: (overrides = {}) => ({
    id: `test-tenant-${Date.now()}`,
    companyName: 'Test Company Ltd',
    subdomain: `test${Date.now()}`,
    subscriptionTier: 'GROWTH',
    isActive: true,
    contactEmail: 'test@example.com',
    ...overrides
  }),

  user: (tenantId: string, overrides = {}) => ({
    id: `test-user-${Date.now()}`,
    tenantId,
    email: `test-${Date.now()}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    role: 'USER',
    isActive: true,
    ...overrides
  }),

  transaction: (overrides = {}) => ({
    id: `test-transaction-${Date.now()}`,
    amount: 1000,
    currency: 'AUD',
    status: 'succeeded',
    provider: 'stripe',
    should_convert: true,
    ...overrides
  }),

  treasuryRule: (overrides = {}) => ({
    name: 'Test Rule',
    is_active: true,
    rule_type: 'percentage',
    conversion_percentage: 10,
    minimum_purchase: 50,
    maximum_purchase: 5000,
    exchange_provider: 'kraken',
    ...overrides
  })
}

/**
 * Test assertion helpers
 */
export const expectValidUUID = (value: string) => {
  expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
}

export const expectValidEmail = (value: string) => {
  expect(value).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
}

export const expectValidBitcoinAddress = (value: string) => {
  expect(value).toMatch(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/)
}

/**
 * Time helpers for testing
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const mockDate = (dateString: string) => {
  const mockedDate = new Date(dateString)
  jest.spyOn(global, 'Date').mockImplementation(() => mockedDate)
  return mockedDate
}

export const restoreDate = () => {
  ;(global.Date as any).mockRestore()
}