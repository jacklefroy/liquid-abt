// LIQUID ABT - Tenant Isolation Integration Tests

import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { signJWT } from '@/lib/auth/jwt'
import { tenantSchemaManager, getMasterPrisma } from '@/lib/database/connection'

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

describe('Tenant Isolation Integration Tests', () => {
  let tenant1: any
  let tenant2: any
  let user1: any
  let user2: any

  beforeAll(async () => {
    // Create two separate tenants for isolation testing with unique data
    const uniqueId1 = require('crypto').randomUUID()
    const uniqueId2 = require('crypto').randomUUID()
    
    tenant1 = await TestDatabaseUtils.createTestTenant({
      companyName: 'Tenant 1 Company',
      subdomain: `tenant1-${uniqueId1.substring(0, 8)}`,
      contactEmail: `admin+${uniqueId1}@tenant1.com`
    })

    tenant2 = await TestDatabaseUtils.createTestTenant({
      companyName: 'Tenant 2 Company',
      subdomain: `tenant2-${uniqueId2.substring(0, 8)}`,
      contactEmail: `admin+${uniqueId2}@tenant2.com`
    })

    // Create schemas for both tenants
    if (!await tenantSchemaManager.schemaExists(tenant1.id)) {
      await tenantSchemaManager.createTenantSchema(tenant1.id)
    }
    if (!await tenantSchemaManager.schemaExists(tenant2.id)) {
      await tenantSchemaManager.createTenantSchema(tenant2.id)
    }

    // Create users for each tenant
    user1 = await TestDatabaseUtils.createTestUser(tenant1.id, {
      email: tenant1.contactEmail,
      role: 'OWNER'
    })

    user2 = await TestDatabaseUtils.createTestUser(tenant2.id, {
      email: tenant2.contactEmail,
      role: 'OWNER'
    })
  }, 30000)

  afterAll(async () => {
    if (tenant1?.id) await TestDatabaseUtils.cleanupTenant(tenant1.id)
    if (tenant2?.id) await TestDatabaseUtils.cleanupTenant(tenant2.id)
    
    await TestDatabaseUtils.disconnect()
  }, 10000)

  beforeEach(async () => {
    // Manual cleanup of test data for isolation
    try {
      if (tenant1?.id) {
        await tenantSchemaManager.queryTenantSchema(tenant1.id, 'DELETE FROM bitcoin_purchases', [])
        await tenantSchemaManager.queryTenantSchema(tenant1.id, 'DELETE FROM transactions', [])
        await tenantSchemaManager.queryTenantSchema(tenant1.id, 'DELETE FROM treasury_rules', [])
        await tenantSchemaManager.queryTenantSchema(tenant1.id, 'DELETE FROM integrations', [])
      }
      if (tenant2?.id) {
        await tenantSchemaManager.queryTenantSchema(tenant2.id, 'DELETE FROM bitcoin_purchases', [])
        await tenantSchemaManager.queryTenantSchema(tenant2.id, 'DELETE FROM transactions', [])
        await tenantSchemaManager.queryTenantSchema(tenant2.id, 'DELETE FROM treasury_rules', [])
        await tenantSchemaManager.queryTenantSchema(tenant2.id, 'DELETE FROM integrations', [])
      }
    } catch (cleanupError) {
      // Ignore cleanup errors - tables might not exist yet
    }
  })

  describe('Cross-tenant data access prevention', () => {
    it('should prevent cross-tenant data leakage in database queries', async () => {
      // Create data in tenant 1
      const integration1 = await TestDatabaseUtils.createTestIntegration(tenant1.id, {
        provider: 'stripe',
        type: 'PAYMENT'
      })

      const transaction1 = await TestDatabaseUtils.createTestTransaction(tenant1.id, integration1.id, {
        amount: 1000,
        description: 'Tenant 1 Secret Transaction',
        status: 'succeeded'
      })

      // Create data in tenant 2
      const integration2 = await TestDatabaseUtils.createTestIntegration(tenant2.id, {
        provider: 'stripe',
        type: 'PAYMENT'
      })

      const transaction2 = await TestDatabaseUtils.createTestTransaction(tenant2.id, integration2.id, {
        amount: 2000,
        description: 'Tenant 2 Secret Transaction',
        status: 'succeeded'
      })

      // Query tenant 1 data - should only see tenant 1's data
      const tenant1Transactions = await tenantSchemaManager.queryTenantSchema(
        tenant1.id,
        'SELECT * FROM transactions',
        []
      )

      expect(tenant1Transactions).toHaveLength(1)
      expect(tenant1Transactions[0].id).toBe(transaction1.id)
      expect(tenant1Transactions[0].description).toBe('Tenant 1 Secret Transaction')

      // Query tenant 2 data - should only see tenant 2's data
      const tenant2Transactions = await tenantSchemaManager.queryTenantSchema(
        tenant2.id,
        'SELECT * FROM transactions',
        []
      )

      expect(tenant2Transactions).toHaveLength(1)
      expect(tenant2Transactions[0].id).toBe(transaction2.id)
      expect(tenant2Transactions[0].description).toBe('Tenant 2 Secret Transaction')

      // Verify tenant 1 cannot see tenant 2's data and vice versa
      expect(tenant1Transactions[0].id).not.toBe(tenant2Transactions[0].id)
    })

    it('should maintain schema isolation for treasury rules', async () => {
      // Create different treasury rules in each tenant
      const rule1 = await TestDatabaseUtils.createTestTreasuryRule(tenant1.id, {
        name: 'Tenant 1 Secret Rule',
        rule_type: 'percentage',
        conversion_percentage: 5.0
      })

      const rule2 = await TestDatabaseUtils.createTestTreasuryRule(tenant2.id, {
        name: 'Tenant 2 Secret Rule',
        rule_type: 'threshold',
        threshold_amount: 10000.0
      })

      // Query rules from each tenant
      const tenant1Rules = await tenantSchemaManager.queryTenantSchema(
        tenant1.id,
        'SELECT * FROM treasury_rules',
        []
      )

      const tenant2Rules = await tenantSchemaManager.queryTenantSchema(
        tenant2.id,
        'SELECT * FROM treasury_rules',
        []
      )

      // Verify isolation
      expect(tenant1Rules).toHaveLength(1)
      expect(tenant1Rules[0].name).toBe('Tenant 1 Secret Rule')
      expect(tenant1Rules[0].rule_type).toBe('percentage')

      expect(tenant2Rules).toHaveLength(1)
      expect(tenant2Rules[0].name).toBe('Tenant 2 Secret Rule')
      expect(tenant2Rules[0].rule_type).toBe('threshold')
    })

    it('should prevent data leakage through bitcoin purchases', async () => {
      // Create integrations and transactions for both tenants
      const integration1 = await TestDatabaseUtils.createTestIntegration(tenant1.id)
      const integration2 = await TestDatabaseUtils.createTestIntegration(tenant2.id)

      const transaction1 = await TestDatabaseUtils.createTestTransaction(tenant1.id, integration1.id)
      const transaction2 = await TestDatabaseUtils.createTestTransaction(tenant2.id, integration2.id)

      // Create bitcoin purchases for each tenant
      await tenantSchemaManager.queryTenantSchema(
        tenant1.id,
        `INSERT INTO bitcoin_purchases (
          transaction_id, amount_aud, bitcoin_amount, price_per_btc, 
          exchange_provider, exchange_order_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [transaction1.id, 100.0, 0.001, 95000, 'kraken', 'order_tenant1', 'filled']
      )

      await tenantSchemaManager.queryTenantSchema(
        tenant2.id,
        `INSERT INTO bitcoin_purchases (
          transaction_id, amount_aud, bitcoin_amount, price_per_btc, 
          exchange_provider, exchange_order_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [transaction2.id, 200.0, 0.002, 96000, 'kraken', 'order_tenant2', 'filled']
      )

      // Verify each tenant only sees their own purchases
      const tenant1Purchases = await tenantSchemaManager.queryTenantSchema(
        tenant1.id,
        'SELECT * FROM bitcoin_purchases',
        []
      )

      const tenant2Purchases = await tenantSchemaManager.queryTenantSchema(
        tenant2.id,
        'SELECT * FROM bitcoin_purchases',
        []
      )

      expect(tenant1Purchases).toHaveLength(1)
      expect(tenant1Purchases[0].exchange_order_id).toBe('order_tenant1')
      expect(tenant1Purchases[0].amount_aud).toBe('100.00')

      expect(tenant2Purchases).toHaveLength(1)
      expect(tenant2Purchases[0].exchange_order_id).toBe('order_tenant2')
      expect(tenant2Purchases[0].amount_aud).toBe('200.00')
    })

    it('should handle concurrent operations with proper isolation', async () => {
      // Create integrations for both tenants
      const integration1 = await TestDatabaseUtils.createTestIntegration(tenant1.id)
      const integration2 = await TestDatabaseUtils.createTestIntegration(tenant2.id)

      // Perform concurrent database operations
      const operations = await Promise.all([
        TestDatabaseUtils.createTestTransaction(tenant1.id, integration1.id, {
          amount: 1000,
          description: 'Concurrent Transaction 1'
        }),
        TestDatabaseUtils.createTestTransaction(tenant2.id, integration2.id, {
          amount: 2000, 
          description: 'Concurrent Transaction 2'
        }),
        TestDatabaseUtils.createTestTreasuryRule(tenant1.id, {
          name: 'Concurrent Rule 1',
          rule_type: 'percentage'
        }),
        TestDatabaseUtils.createTestTreasuryRule(tenant2.id, {
          name: 'Concurrent Rule 2',
          rule_type: 'threshold'
        })
      ])

      // Verify each tenant got the correct data
      const [tx1, tx2, rule1, rule2] = operations

      expect(tx1.description).toBe('Concurrent Transaction 1')
      expect(tx2.description).toBe('Concurrent Transaction 2')
      expect(rule1.name).toBe('Concurrent Rule 1')
      expect(rule2.name).toBe('Concurrent Rule 2')

      // Verify isolation by checking what each tenant can see
      const tenant1Data = await tenantSchemaManager.queryTenantSchema(
        tenant1.id,
        'SELECT * FROM transactions',
        []
      )

      const tenant2Data = await tenantSchemaManager.queryTenantSchema(
        tenant2.id,
        'SELECT * FROM transactions',
        []
      )

      expect(tenant1Data).toHaveLength(1)
      expect(tenant1Data[0].description).toBe('Concurrent Transaction 1')

      expect(tenant2Data).toHaveLength(1)
      expect(tenant2Data[0].description).toBe('Concurrent Transaction 2')
    })

    it('should validate JWT tokens are tenant-specific', async () => {
      // Create valid JWT tokens for each tenant
      const jwt1 = await signJWT({
        userId: user1.id,
        tenantId: tenant1.id,
        email: user1.email,
        role: user1.role,
        subdomain: tenant1.subdomain
      })

      const jwt2 = await signJWT({
        userId: user2.id,
        tenantId: tenant2.id,
        email: user2.email,
        role: user2.role,
        subdomain: tenant2.subdomain
      })

      // Verify tokens contain correct tenant information
      const { verifyJWT } = require('@/lib/auth/jwt')
      
      const payload1 = await verifyJWT(jwt1)
      const payload2 = await verifyJWT(jwt2)

      expect(payload1.tenantId).toBe(tenant1.id)
      expect(payload1.subdomain).toBe(tenant1.subdomain)

      expect(payload2.tenantId).toBe(tenant2.id)
      expect(payload2.subdomain).toBe(tenant2.subdomain)

      // Ensure they're different
      expect(payload1.tenantId).not.toBe(payload2.tenantId)
    })

    it('should prevent schema name collision attacks', async () => {
      // Try to create conflicting data using similar naming patterns
      const integration1 = await TestDatabaseUtils.createTestIntegration(tenant1.id, {
        provider: 'test-provider-conflict'
      })

      const integration2 = await TestDatabaseUtils.createTestIntegration(tenant2.id, {
        provider: 'test-provider-conflict'  // Same provider name
      })

      // Both should exist but be completely isolated
      const tenant1Integrations = await tenantSchemaManager.queryTenantSchema(
        tenant1.id,
        'SELECT * FROM integrations WHERE provider = $1',
        ['test-provider-conflict']
      )

      const tenant2Integrations = await tenantSchemaManager.queryTenantSchema(
        tenant2.id,
        'SELECT * FROM integrations WHERE provider = $1',
        ['test-provider-conflict']
      )

      expect(tenant1Integrations).toHaveLength(1)
      expect(tenant2Integrations).toHaveLength(1)
      
      // They should have different IDs despite same provider name
      expect(tenant1Integrations[0].id).not.toBe(tenant2Integrations[0].id)
    })
  })
})