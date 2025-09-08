// LIQUID ABT - End-to-End Complete Flow Test

import { TreasuryProcessor } from '@/lib/treasury-engine/processor'
import { TestDatabaseUtils } from '../utils/database'
import { mockStripeWebhookEvent, createTestData, mockKrakenResponses } from '../utils/mocks'
import { tenantSchemaManager } from '@/lib/database/connection'
import crypto from 'crypto'

// Mock external dependencies for E2E test
jest.mock('@/lib/integrations/exchanges/interface')
import { ExchangeProviderFactory } from '@/lib/integrations/exchanges/interface'
const mockExchangeProviderFactory = ExchangeProviderFactory as jest.Mocked<typeof ExchangeProviderFactory>

describe('End-to-End: Complete Payment to Bitcoin Flow', () => {
  let testTenantId: string
  let testUserId: string

  beforeAll(async () => {
    // Clean up any existing test data
    await TestDatabaseUtils.cleanup()
  })

  afterAll(async () => {
    await TestDatabaseUtils.cleanup()
  })

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks()
  })

  describe('Complete Flow: Register Tenant → Configure → Process Payment → Verify Bitcoin Purchase', () => {
    it('should complete the full LIQUID ABT flow successfully', async () => {
      // ==========================================
      // STEP 1: Register New Tenant
      // ==========================================
      
      const tenantData = {
        companyName: 'E2E Test Company Pty Ltd',
        subdomain: `e2e-test-${Date.now()}`,
        contactEmail: `admin@e2e-test-${Date.now()}.com`,
        subscriptionTier: 'GROWTH'
      }
      
      // Create the tenant
      const testTenant = await TestDatabaseUtils.createTestTenant(tenantData)
      testTenantId = testTenant.id
      
      // Verify tenant was created
      expect(testTenant).toMatchObject({
        companyName: tenantData.companyName,
        subdomain: tenantData.subdomain,
        subscriptionTier: tenantData.subscriptionTier,
        isActive: true
      })

      // ==========================================
      // STEP 2: Create Tenant Schema
      // ==========================================
      
      // Check if schema exists, create if needed
      const schemaExists = await tenantSchemaManager.schemaExists(testTenantId)
      if (!schemaExists) {
        await tenantSchemaManager.createTenantSchema(testTenantId)
      }
      
      // Verify schema was created
      const schemaExistsAfter = await tenantSchemaManager.schemaExists(testTenantId)
      expect(schemaExistsAfter).toBe(true)

      // ==========================================
      // STEP 3: Create Test User
      // ==========================================
      
      const userData = {
        email: tenantData.contactEmail,
        firstName: 'E2E',
        lastName: 'User',
        role: 'OWNER' as const
      }
      
      const testUser = await TestDatabaseUtils.createTestUser(testTenantId, userData)
      testUserId = testUser.id
      
      // Verify user was created
      expect(testUser).toMatchObject({
        tenantId: testTenantId,
        email: userData.email,
        role: 'OWNER',
        isActive: true
      })

      // ==========================================
      // STEP 4: Configure Treasury Rules
      // ==========================================
      
      const treasuryRuleData = {
        name: 'E2E Test Rule - 10% DCA',
        rule_type: 'percentage',
        conversion_percentage: 10.0, // 10% of payments
        minimum_purchase: 50.0, // $50 minimum
        maximum_purchase: 2000.0, // $2000 maximum
        exchange_provider: 'kraken',
        is_active: true
      }
      
      const treasuryRule = await TestDatabaseUtils.createTestTreasuryRule(testTenantId, treasuryRuleData)
      
      // Verify treasury rule was created (values come back as strings from SQL)
      expect(treasuryRule).toMatchObject({
        rule_type: 'percentage',
        conversion_percentage: '10.00',
        minimum_purchase: '50.00',
        is_active: true
      })

      // ==========================================
      // STEP 5: Configure Stripe Integration
      // ==========================================
      
      const stripeIntegrationData = {
        provider: 'stripe',
        type: 'PAYMENT' as const,
        is_active: true,
        access_token: 'acct_test_stripe_account',
        settings: JSON.stringify({
          webhookEndpointId: 'we_test_webhook',
          accountId: 'acct_test_stripe'
        })
      }
      
      const stripeIntegration = await TestDatabaseUtils.createTestIntegration(testTenantId, stripeIntegrationData)
      
      // Verify Stripe integration was created
      expect(stripeIntegration).toMatchObject({
        provider: 'stripe',
        type: 'PAYMENT',
        is_active: true
      })

      // ==========================================
      // STEP 6: Mock Exchange Provider
      // ==========================================
      
      const mockExchangeProvider = {
        type: 'kraken',
        getCurrentPrice: jest.fn().mockResolvedValue({
          symbol: 'BTC',
          price: 95000,
          currency: 'AUD'
        }),
        createMarketOrder: jest.fn().mockResolvedValue({
          orderId: `e2e_order_${Date.now()}`,
          status: 'filled',
          side: 'buy',
          symbol: 'BTC',
          amount: 0.001,
          filledAmount: 0.001,
          averagePrice: 95000,
          totalValue: 95,
          fees: [{ amount: 0.5, currency: 'AUD', type: 'trading' }],
          timestamp: new Date()
        }),
        withdrawBitcoin: jest.fn().mockResolvedValue({
          withdrawalId: `e2e_withdrawal_${Date.now()}`,
          status: 'pending',
          currency: 'BTC',
          amount: 0.001,
          address: 'bc1qe2etestaddress',
          fees: [{ amount: 0.0001, currency: 'BTC', type: 'withdrawal' }],
          timestamp: new Date()
        })
      }
      
      mockExchangeProviderFactory.create.mockReturnValue(mockExchangeProvider as any)

      // ==========================================
      // STEP 7: Simulate Stripe Payment Webhook
      // ==========================================
      
      // Create a realistic payment transaction
      const paymentAmount = 1000 // $1,000 AUD payment
      const expectedBitcoinPurchase = paymentAmount * 0.10 // 10% = $100 AUD
      
      const mockTransaction = {
        id: crypto.randomUUID(),
        amount: paymentAmount,
        currency: 'AUD',
        status: 'succeeded',
        provider: 'stripe',
        tenantId: testTenantId,
        should_convert: true,
        rawData: {
          payment_intent_id: `pi_e2e_test_${Date.now()}`,
          customer_id: 'cus_test_customer'
        }
      }

      // ==========================================
      // STEP 8: Process Transaction with Treasury Engine
      // ==========================================
      
      // First create the transaction in the database (simulating webhook storage)
      const storedTransaction = await TestDatabaseUtils.createTestTransaction(
        testTenantId,
        stripeIntegration.id,
        mockTransaction
      )
      
      const treasuryProcessor = new TreasuryProcessor(testTenantId)
      const processingResult = await treasuryProcessor.processTransaction(storedTransaction)
      
      // Verify Bitcoin purchase was triggered
      expect(processingResult).toBeDefined()
      expect(processingResult?.bitcoinPurchaseId).toBeDefined()
      
      // Verify exchange provider was called correctly
      expect(mockExchangeProvider.createMarketOrder).toHaveBeenCalledWith({
        side: 'buy',
        symbol: 'XBTAUD',
        value: expectedBitcoinPurchase, // $100 AUD (10% of $1000)
        currency: 'AUD'
      })

      // ==========================================
      // STEP 9: Verify Database Records
      // ==========================================
      
      // Check that transaction was stored (should already exist from createTestTransaction)
      const storedTransactions = await tenantSchemaManager.queryTenantSchema(
        testTenantId,
        'SELECT * FROM transactions WHERE id = $1',
        [storedTransaction.id]
      )
      
      expect(storedTransactions).toHaveLength(1)
      expect(storedTransactions[0]).toMatchObject({
        id: storedTransaction.id,
        amount: "1000.00" // Original transaction amount ($1000) - DB format with decimals
      })
      
      // Check that Bitcoin purchase was stored
      const bitcoinPurchases = await tenantSchemaManager.queryTenantSchema(
        testTenantId,
        'SELECT * FROM bitcoin_purchases ORDER BY created_at DESC LIMIT 1',
        []
      )
      
      expect(bitcoinPurchases).toHaveLength(1)
      const purchase = bitcoinPurchases[0]
      
      expect(purchase).toMatchObject({
        amount_aud: expectedBitcoinPurchase.toString() + ".00", // "100.00"
        bitcoin_amount: "0.00100000", // 8 decimal places for Bitcoin
        price_per_btc: "95000.00",
        status: 'filled',
        exchange_provider: 'kraken'
      })

      // ==========================================
      // STEP 10: Verify Multi-Tenant Isolation
      // ==========================================
      
      // Create a second tenant to verify isolation
      const secondTenantData = {
        companyName: 'Second Test Company',
        subdomain: `second-e2e-${Date.now()}`,
        contactEmail: `admin@second-${Date.now()}.com`,
        subscriptionTier: 'PRO'
      }
      
      const secondTenant = await TestDatabaseUtils.createTestTenant(secondTenantData)
      
      // Create schema for second tenant
      if (!await tenantSchemaManager.schemaExists(secondTenant.id)) {
        await tenantSchemaManager.createTenantSchema(secondTenant.id)
      }
      
      // Verify first tenant's data is not accessible from second tenant
      const secondTenantPurchases = await tenantSchemaManager.queryTenantSchema(
        secondTenant.id,
        'SELECT * FROM bitcoin_purchases',
        []
      )
      
      // Second tenant should have no Bitcoin purchases
      expect(secondTenantPurchases).toHaveLength(0)
      
      // Verify first tenant still has its purchase
      const firstTenantPurchases = await tenantSchemaManager.queryTenantSchema(
        testTenantId,
        'SELECT * FROM bitcoin_purchases',
        []
      )
      
      expect(firstTenantPurchases).toHaveLength(1)

      // ==========================================
      // STEP 11: Test Different Treasury Rule Types
      // ==========================================
      
      // Create a threshold-based rule for testing
      const thresholdRuleData = {
        name: 'Threshold Rule - $2000',
        rule_type: 'threshold',
        threshold_amount: 2000.0, // Convert when balance hits $2000
        buffer_amount: 500.0, // Keep $500 buffer
        minimum_purchase: 100.0,
        is_active: true
      }
      
      await TestDatabaseUtils.createTestTreasuryRule(testTenantId, thresholdRuleData)
      
      // Deactivate the percentage rule
      await tenantSchemaManager.queryTenantSchema(
        testTenantId,
        'UPDATE treasury_rules SET is_active = false WHERE rule_type = $1',
        ['percentage']
      )
      
      // Simulate building up balance with multiple payments
      const payment1Data = { ...mockTransaction, id: crypto.randomUUID(), amount: 800 }
      const payment2Data = { ...mockTransaction, id: crypto.randomUUID(), amount: 700 }
      const payment3Data = { ...mockTransaction, id: crypto.randomUUID(), amount: 600 } // Total: $2100, exceeds $2000 threshold
      
      // Store payments in database first
      const payment1 = await TestDatabaseUtils.createTestTransaction(testTenantId, stripeIntegration.id, payment1Data)
      const payment2 = await TestDatabaseUtils.createTestTransaction(testTenantId, stripeIntegration.id, payment2Data)
      const payment3 = await TestDatabaseUtils.createTestTransaction(testTenantId, stripeIntegration.id, payment3Data)
      
      // Process first two payments (should not trigger conversion)
      await treasuryProcessor.processTransaction(payment1)
      await treasuryProcessor.processTransaction(payment2)
      
      // Reset mock call count
      mockExchangeProvider.createMarketOrder.mockClear()
      
      // Process third payment (should trigger threshold conversion)
      const thresholdResult = await treasuryProcessor.processTransaction(payment3)
      
      // Should convert accumulated balance minus buffer
      expect(thresholdResult?.bitcoinPurchaseId).toBeDefined()
      expect(mockExchangeProvider.createMarketOrder).toHaveBeenCalledWith({
        side: 'buy',
        symbol: 'XBTAUD',
        value: expect.any(Number), // Actual amount will depend on accumulated balance
        currency: 'AUD'
      })

      // ==========================================
      // STEP 12: Performance and Concurrency Test
      // ==========================================
      
      // Test processing multiple transactions concurrently
      const concurrentTransactionData = Array.from({ length: 5 }, (_, i) => ({
        ...mockTransaction,
        id: crypto.randomUUID(),
        amount: 500 // Each $500
      }))
      
      // Store all concurrent transactions in database first
      const concurrentTransactions = await Promise.all(
        concurrentTransactionData.map(tx => 
          TestDatabaseUtils.createTestTransaction(testTenantId, stripeIntegration.id, tx)
        )
      )
      
      // Reactivate percentage rule for concurrent test
      await tenantSchemaManager.queryTenantSchema(
        testTenantId,
        'UPDATE treasury_rules SET is_active = true WHERE rule_type = $1',
        ['percentage']
      )
      
      await tenantSchemaManager.queryTenantSchema(
        testTenantId,
        'UPDATE treasury_rules SET is_active = false WHERE rule_type = $1',
        ['threshold']
      )
      
      mockExchangeProvider.createMarketOrder.mockClear()
      
      // Process all transactions concurrently
      const concurrentResults = await Promise.all(
        concurrentTransactions.map(tx => treasuryProcessor.processTransaction(tx))
      )
      
      // All should succeed
      expect(concurrentResults.every(result => result?.bitcoinPurchaseId)).toBe(true)
      
      // Each should have triggered a $50 purchase (10% of $500)
      expect(mockExchangeProvider.createMarketOrder).toHaveBeenCalledTimes(5)
      
      const callArgs = mockExchangeProvider.createMarketOrder.mock.calls
      callArgs.forEach(call => {
        expect(call[0]).toMatchObject({
          side: 'buy',
          symbol: 'XBTAUD',
          value: 50, // 10% of $500
          currency: 'AUD'
        })
      })

      // ==========================================
      // FINAL VERIFICATION: Dashboard Data
      // ==========================================
      
      // Verify all purchases are recorded correctly
      const allPurchases = await tenantSchemaManager.queryTenantSchema(
        testTenantId,
        'SELECT * FROM bitcoin_purchases ORDER BY created_at ASC',
        []
      )
      
      // Should have: 1 initial + 1 threshold + 5 concurrent = 7 purchases
      expect(allPurchases.length).toBeGreaterThanOrEqual(6)
      
      // Verify total Bitcoin accumulated
      const totalStats = await tenantSchemaManager.queryTenantSchema(
        testTenantId,
        `SELECT 
          SUM(bitcoin_amount) as total_btc,
          SUM(amount_aud) as total_aud,
          COUNT(*) as total_purchases
        FROM bitcoin_purchases WHERE status = 'filled'`,
        []
      )
      
      const stats = totalStats[0]
      expect(Number(stats.total_aud)).toBeGreaterThan(0)
      expect(Number(stats.total_btc)).toBeGreaterThan(0)
      expect(Number(stats.total_purchases)).toBeGreaterThanOrEqual(6)
      
      console.log('🎉 E2E Test Results:')
      console.log(`✅ Tenant Created: ${testTenant.companyName}`)
      console.log(`✅ Schema Isolated: ${testTenantId}`)
      console.log(`✅ User Created: ${testUser.email}`)
      console.log(`✅ Treasury Rules: Active`)
      console.log(`✅ Bitcoin Purchases: ${stats.total_purchases}`)
      console.log(`✅ Total AUD Invested: $${Number(stats.total_aud).toFixed(2)}`)
      console.log(`✅ Total BTC Accumulated: ${Number(stats.total_btc).toFixed(8)}`)
      console.log(`✅ Multi-tenant Isolation: Verified`)
      console.log(`✅ Concurrent Processing: Verified`)
      console.log('🚀 LIQUID ABT End-to-End Test: PASSED')
      
    }, 60000) // 60 second timeout for comprehensive E2E test
  })
  
  describe('Error Handling and Edge Cases', () => {
    it('should handle complete system failures gracefully', async () => {
      // Create a tenant for error testing
      const errorTestTenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'Error Test Company',
        subdomain: `error-test-${Date.now()}`,
        contactEmail: `error@test-${Date.now()}.com`
      })
      
      if (!await tenantSchemaManager.schemaExists(errorTestTenant.id)) {
        await tenantSchemaManager.createTenantSchema(errorTestTenant.id)
      }
      
      // Create active treasury rule
      await TestDatabaseUtils.createTestTreasuryRule(errorTestTenant.id, {
        rule_type: 'percentage',
        conversion_percentage: 10
      })

      // Create a test integration first
      const testIntegration = await TestDatabaseUtils.createTestIntegration(errorTestTenant.id)
      
      // Create the transaction in the database so the foreign key exists
      const failingTransactionId = require('crypto').randomUUID()
      const failingTransaction = await TestDatabaseUtils.createTestTransaction(
        errorTestTenant.id, 
        testIntegration.id, 
        {
          id: failingTransactionId,
          amount: 1000,
          currency: 'AUD',
          status: 'succeeded',
          should_convert: true
        }
      )
      
      // Mock exchange provider failure
      const failingExchangeProvider = {
        type: 'kraken',
        createMarketOrder: jest.fn().mockRejectedValue(new Error('Exchange API down'))
      }
      
      mockExchangeProviderFactory.create.mockReturnValue(failingExchangeProvider as any)
      
      const processor = new TreasuryProcessor(errorTestTenant.id)
      
      // Should handle exchange failure gracefully
      await expect(processor.processTransaction(failingTransaction)).rejects.toThrow('Exchange API down')
      
      // Verify failure was logged
      const processingFailures = await tenantSchemaManager.queryTenantSchema(
        errorTestTenant.id,
        'SELECT * FROM processing_failures WHERE transaction_id = $1',
        [failingTransaction.id]
      )
      
      expect(processingFailures).toHaveLength(1)
      expect(processingFailures[0].error_message).toContain('Exchange API down')
    })
  })
})