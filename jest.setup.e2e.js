// LIQUID ABT - Jest Setup for E2E Tests

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgresql://jacklefroy@localhost:5432/liquid_abt_test'
process.env.JWT_SECRET = 'test-jwt-secret-e2e'
process.env.ENCRYPTION_KEY = 'test-encryption-key-e2e'

// Import database cleanup utilities
const { TestDatabaseUtils } = require('./__tests__/utils/database')

// Global setup for E2E tests
beforeAll(async () => {
  // Clean up any existing test data
  await TestDatabaseUtils.cleanup()
})

// Cleanup after each test to ensure isolation
afterEach(async () => {
  await TestDatabaseUtils.cleanup()
})

// Global teardown
afterAll(async () => {
  await TestDatabaseUtils.cleanup()
  await TestDatabaseUtils.disconnect()
})

// Make cleanup function available globally for tests
global.cleanupTestData = async () => {
  await TestDatabaseUtils.cleanup()
}

// Mock external services for E2E tests with more realistic responses
jest.mock('stripe')
// Note: Exchange provider mocking is handled in the test files directly

// Increase timeout for E2E tests
jest.setTimeout(60000) // 1 minute for full E2E flows

module.exports = {
  cleanupTestData: TestDatabaseUtils.cleanup,
}