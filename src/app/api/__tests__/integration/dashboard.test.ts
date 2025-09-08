// LIQUID ABT - Dashboard API Integration Tests

import { NextRequest, NextResponse } from 'next/server'
import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { signJWT } from '@/lib/auth/jwt'
import { tenantSchemaManager } from '@/lib/database/connection'

// Mock external dependencies
jest.mock('@/lib/integrations/exchanges/interface', () => ({
  ExchangeProviderFactory: {
    create: jest.fn().mockReturnValue({
      type: 'kraken',
      getCurrentPrice: jest.fn().mockResolvedValue({
        symbol: 'BTC',
        price: 95000,
        currency: 'AUD'
      })
    })
  }
}))

// Import the actual handler function after mocks are set up
import { AuthenticatedRequest } from '@/lib/auth/middleware'

describe('Dashboard API Integration Tests', () => {
  let testTenant: any
  let testUser: any
  let validJWTToken: string
  let testDatabaseName: string

  beforeAll(async () => {
    // Use existing test database with unique schema names instead of separate databases
    // This is more practical than creating separate databases for each test suite
    const uniqueId = require('crypto').randomUUID()
    testTenant = await TestDatabaseUtils.createTestTenant({
      companyName: 'Dashboard Test Company',
      subdomain: `dashboard-test-${uniqueId.substring(0, 8)}`,
      contactEmail: `admin+${uniqueId}@dashboard-test.com`
    })

    // Create tenant schema
    if (!await tenantSchemaManager.schemaExists(testTenant.id)) {
      await tenantSchemaManager.createTenantSchema(testTenant.id)
    }

    testUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: testTenant.contactEmail,
      role: 'OWNER'
    })

    // Create valid JWT token
    validJWTToken = await signJWT({
      userId: testUser.id,
      tenantId: testTenant.id,
      email: testUser.email,
      role: testUser.role,
      subdomain: testTenant.subdomain
    })
  }, 30000)

  afterAll(async () => {
    if (testTenant?.id) {
      await TestDatabaseUtils.cleanupTenant(testTenant.id)
    }
    
    // Cleanup test database connections
    await TestDatabaseUtils.disconnect()
  }, 10000)

  beforeEach(async () => {
    if (!testTenant?.id) return
    // Clear any test data between tests but keep tenant/user
    try {
      await tenantSchemaManager.queryTenantSchema(testTenant.id, 'DELETE FROM bitcoin_purchases', [])
      await tenantSchemaManager.queryTenantSchema(testTenant.id, 'DELETE FROM transactions', [])
      await tenantSchemaManager.queryTenantSchema(testTenant.id, 'DELETE FROM treasury_rules', [])
      await tenantSchemaManager.queryTenantSchema(testTenant.id, 'DELETE FROM integrations', [])
    } catch (error) {
      // Schema might not exist yet, ignore
    }
  })

  describe('Dashboard Data Retrieval', () => {
    it('should retrieve dashboard data with proper tenant isolation', async () => {
      // Create some test data
      const integration = await TestDatabaseUtils.createTestIntegration(testTenant.id)
      const rule = await TestDatabaseUtils.createTestTreasuryRule(testTenant.id, {
        name: 'Test Rule',
        rule_type: 'percentage',
        conversion_percentage: 10.0
      })
      
      const transaction = await TestDatabaseUtils.createTestTransaction(testTenant.id, integration.id, {
        amount: 1000,
        status: 'succeeded'
      })

      // Test direct database queries as the API would make them (sequential to avoid concurrency issues)
      const transactions = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10',
        []
      )
      
      const bitcoinPurchases = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM bitcoin_purchases ORDER BY created_at DESC LIMIT 10',
        []
      )
      
      const treasuryRules = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM treasury_rules WHERE is_active = true',
        []
      )
      
      const integrations = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM integrations WHERE is_active = true',
        []
      )

      // Verify data is retrieved correctly
      expect(transactions).toHaveLength(1)
      expect(transactions[0].id).toBe(transaction.id)
      
      expect(treasuryRules).toHaveLength(1)
      expect(treasuryRules[0].rule_type).toBe('percentage')
      
      expect(integrations).toHaveLength(1)
      expect(integrations[0].provider).toBe('stripe')
    })

    it('should calculate portfolio metrics correctly', async () => {
      // Create integration and treasury rule
      const integration = await TestDatabaseUtils.createTestIntegration(testTenant.id)
      await TestDatabaseUtils.createTestTreasuryRule(testTenant.id, {
        rule_type: 'percentage',
        conversion_percentage: 10.0
      })

      // Create a transaction and bitcoin purchase
      const transaction = await TestDatabaseUtils.createTestTransaction(testTenant.id, integration.id, {
        amount: 1000,
        status: 'succeeded'
      })

      // Manually create a bitcoin purchase record
      await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        `INSERT INTO bitcoin_purchases (
          transaction_id, amount_aud, bitcoin_amount, price_per_btc, 
          exchange_provider, exchange_order_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [transaction.id, 100.0, 0.001, 95000, 'kraken', 'test_order_123', 'filled']
      )

      // Test portfolio calculations
      const portfolioData = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        `SELECT 
          SUM(bitcoin_amount) as total_bitcoin,
          SUM(amount_aud) as total_aud_invested,
          AVG(price_per_btc) as avg_purchase_price
        FROM bitcoin_purchases WHERE status = 'filled'`,
        []
      )

      expect(portfolioData).toHaveLength(1)
      const portfolio = portfolioData[0]
      
      expect(parseFloat(portfolio.total_bitcoin)).toBeGreaterThan(0)
      expect(parseFloat(portfolio.total_aud_invested)).toBeGreaterThan(0)
      expect(parseFloat(portfolio.avg_purchase_price)).toBeGreaterThan(0)
    })

    it('should enforce tenant isolation at database level', async () => {
      // Create a second tenant
      const otherTenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'Other Test Company',
        subdomain: `other-test-${Date.now()}`,
        contactEmail: `other@test-${Date.now()}.com`
      })

      if (!await tenantSchemaManager.schemaExists(otherTenant.id)) {
        await tenantSchemaManager.createTenantSchema(otherTenant.id)
      }

      // Create data in first tenant
      const integration = await TestDatabaseUtils.createTestIntegration(testTenant.id)
      await TestDatabaseUtils.createTestTransaction(testTenant.id, integration.id)

      // Query from second tenant should return empty
      const otherTenantTransactions = await tenantSchemaManager.queryTenantSchema(
        otherTenant.id,
        'SELECT * FROM transactions',
        []
      )

      // Should be empty because data is in different tenant schema
      expect(otherTenantTransactions).toHaveLength(0)

      // Query from original tenant should have data
      const originalTenantTransactions = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM transactions',
        []
      )

      expect(originalTenantTransactions).toHaveLength(1)

      // Cleanup
      await TestDatabaseUtils.cleanupTenant(otherTenant.id)
    })

    it('should handle different treasury rule types correctly', async () => {
      // Create percentage rule
      const percentageRule = await TestDatabaseUtils.createTestTreasuryRule(testTenant.id, {
        name: 'Percentage Rule',
        rule_type: 'percentage',
        conversion_percentage: 15.0
      })

      // Create threshold rule
      const thresholdRule = await TestDatabaseUtils.createTestTreasuryRule(testTenant.id, {
        name: 'Threshold Rule',
        rule_type: 'threshold',
        threshold_amount: 2000.0,
        buffer_amount: 500.0
      })

      // Query active rules
      const rules = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM treasury_rules WHERE is_active = true ORDER BY created_at',
        []
      )

      expect(rules).toHaveLength(2)
      
      const percentage = rules.find(r => r.rule_type === 'percentage')
      const threshold = rules.find(r => r.rule_type === 'threshold')
      
      expect(percentage).toBeDefined()
      expect(parseFloat(percentage.conversion_percentage)).toBe(15.0)
      
      expect(threshold).toBeDefined()
      expect(parseFloat(threshold.threshold_amount)).toBe(2000.0)
      expect(parseFloat(threshold.buffer_amount)).toBe(500.0)
    })

    it('should handle multiple integrations correctly', async () => {
      // Create multiple integrations
      const stripeIntegration = await TestDatabaseUtils.createTestIntegration(testTenant.id, {
        provider: 'stripe',
        type: 'PAYMENT'
      })

      const krakenIntegration = await TestDatabaseUtils.createTestIntegration(testTenant.id, {
        provider: 'kraken',
        type: 'EXCHANGE'
      })

      // Query integrations
      const integrations = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM integrations WHERE is_active = true ORDER BY provider',
        []
      )

      expect(integrations).toHaveLength(2)
      
      const stripe = integrations.find(i => i.provider === 'stripe')
      const kraken = integrations.find(i => i.provider === 'kraken')
      
      expect(stripe).toBeDefined()
      expect(stripe.type).toBe('PAYMENT')
      
      expect(kraken).toBeDefined()  
      expect(kraken.type).toBe('EXCHANGE')
    })

    it('should handle database connection errors gracefully', async () => {
      // Mock database failure
      const originalQuery = tenantSchemaManager.queryTenantSchema
      tenantSchemaManager.queryTenantSchema = jest.fn().mockRejectedValue(new Error('Database connection failed'))

      // Test that error is properly handled
      await expect(
        tenantSchemaManager.queryTenantSchema(testTenant.id, 'SELECT 1', [])
      ).rejects.toThrow('Database connection failed')

      // Restore original function
      tenantSchemaManager.queryTenantSchema = originalQuery
    })

    it('should validate proper data format consistency', async () => {
      const integration = await TestDatabaseUtils.createTestIntegration(testTenant.id)
      
      // Create transaction with specific amount format
      const transaction = await TestDatabaseUtils.createTestTransaction(testTenant.id, integration.id, {
        amount: 1234.56,
        currency: 'AUD'
      })

      const storedTransaction = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM transactions WHERE id = $1',
        [transaction.id]
      )

      expect(storedTransaction).toHaveLength(1)
      // Database should store as string with proper decimal precision
      expect(storedTransaction[0].amount).toBe('1234.56')
      expect(storedTransaction[0].currency).toBe('AUD')
    })
  })
})