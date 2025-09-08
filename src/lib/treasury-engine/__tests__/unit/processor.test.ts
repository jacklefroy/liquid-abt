// LIQUID ABT - Treasury Processor Unit Tests

import { TreasuryProcessor } from '../../processor'
import { tenantSchemaManager } from '@/lib/database/connection'
import { ExchangeProviderFactory } from '@/lib/integrations/exchanges/interface'
import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { mockKrakenResponses, createTestData, delay } from '@/../__tests__/utils/mocks'

// Mock dependencies
jest.mock('@/lib/database/connection')
jest.mock('@/lib/integrations/exchanges/interface')

const mockTenantSchemaManager = tenantSchemaManager as jest.Mocked<typeof tenantSchemaManager>
const mockExchangeProviderFactory = ExchangeProviderFactory as jest.Mocked<typeof ExchangeProviderFactory>

describe('TreasuryProcessor', () => {
  let processor: TreasuryProcessor
  let testTenantId: string
  let mockExchangeProvider: any

  beforeEach(() => {
    testTenantId = 'test-tenant-123'
    processor = new TreasuryProcessor(testTenantId)

    // Create mock exchange provider
    mockExchangeProvider = {
      type: 'kraken',
      getCurrentPrice: jest.fn(),
      createMarketOrder: jest.fn(),
      withdrawBitcoin: jest.fn()
    }

    mockExchangeProviderFactory.create.mockReturnValue(mockExchangeProvider)

    // Reset all mocks
    jest.clearAllMocks()
  })

  describe('processTransaction', () => {
    const mockTransaction = createTestData.transaction({
      id: 'test-transaction-123',
      amount: 1000,
      currency: 'AUD',
      status: 'succeeded'
    })

    it('should process percentage-based conversion correctly', async () => {
      // Setup: 10% conversion rule
      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 10,
        minimum_purchase: 50,
        maximum_purchase: 5000,
        is_auto_withdrawal: false
      })

      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule]) // getTreasuryRules
        .mockResolvedValueOnce([]) // getExchangeIntegration
        .mockResolvedValueOnce([{ id: 'purchase-123' }]) // storeBitcoinPurchase

      mockExchangeProvider.createMarketOrder.mockResolvedValue(mockKrakenResponses.createMarketOrder)

      // Execute
      const result = await processor.processTransaction(mockTransaction)

      // Assertions
      expect(result).toEqual({ bitcoinPurchaseId: 'purchase-123' })
      expect(mockExchangeProvider.createMarketOrder).toHaveBeenCalledWith({
        side: 'buy',
        symbol: 'XBTAUD',
        value: 100, // 10% of 1000 AUD
        currency: 'AUD'
      })
    })

    it('should respect minimum purchase amount', async () => {
      // Setup: Small transaction below minimum
      const smallTransaction = createTestData.transaction({
        amount: 100, // Only $100
      })

      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 10,
        minimum_purchase: 50, // $50 minimum
        maximum_purchase: 5000
      })

      mockTenantSchemaManager.queryTenantSchema.mockResolvedValueOnce([mockRule])

      // Execute
      const result = await processor.processTransaction(smallTransaction)

      // Should not convert because 10% of $100 = $10, which is below $50 minimum
      expect(result).toBeNull()
      expect(mockExchangeProvider.createMarketOrder).not.toHaveBeenCalled()
    })

    it('should cap at maximum purchase amount', async () => {
      // Setup: Large transaction above maximum
      const largeTransaction = createTestData.transaction({
        amount: 100000, // $100,000
      })

      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 10, // Would be $10,000
        minimum_purchase: 50,
        maximum_purchase: 5000 // Cap at $5,000
      })

      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule])
        .mockResolvedValueOnce([]) // exchange integration
        .mockResolvedValueOnce([{ id: 'purchase-123' }]) // store purchase

      mockExchangeProvider.createMarketOrder.mockResolvedValue(mockKrakenResponses.createMarketOrder)

      // Execute
      const result = await processor.processTransaction(largeTransaction)

      // Should cap at maximum
      expect(mockExchangeProvider.createMarketOrder).toHaveBeenCalledWith({
        side: 'buy',
        symbol: 'XBTAUD',
        value: 5000, // Capped at maximum
        currency: 'AUD'
      })
    })

    it('should handle threshold-based conversion', async () => {
      // Setup: Threshold rule
      const mockRule = createTestData.treasuryRule({
        rule_type: 'threshold',
        threshold_amount: 2000,
        buffer_amount: 500,
        minimum_purchase: 50
      })

      // Mock current balance: $1200 + $1000 (new) = $2200, exceeds $2000 threshold
      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule]) // getTreasuryRules
        .mockResolvedValueOnce([{ total_balance: 1200 }]) // getCurrentBalance
        .mockResolvedValueOnce([]) // exchange integration
        .mockResolvedValueOnce([{ id: 'purchase-123' }]) // store purchase

      mockExchangeProvider.createMarketOrder.mockResolvedValue(mockKrakenResponses.createMarketOrder)

      // Execute
      const result = await processor.processTransaction(mockTransaction)

      // Should convert: $2200 - $500 buffer = $1700
      expect(mockExchangeProvider.createMarketOrder).toHaveBeenCalledWith({
        side: 'buy',
        symbol: 'XBTAUD',
        value: 1700,
        currency: 'AUD'
      })
    })

    it('should not convert if below threshold', async () => {
      const mockRule = createTestData.treasuryRule({
        rule_type: 'threshold',
        threshold_amount: 5000, // High threshold
        buffer_amount: 500
      })

      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule])
        .mockResolvedValueOnce([{ total_balance: 1000 }]) // Only $2000 total, below $5000

      const result = await processor.processTransaction(mockTransaction)

      expect(result).toBeNull()
      expect(mockExchangeProvider.createMarketOrder).not.toHaveBeenCalled()
    })

    it('should skip DCA rules (handled by scheduler)', async () => {
      const mockRule = createTestData.treasuryRule({
        rule_type: 'fixed_dca'
      })

      mockTenantSchemaManager.queryTenantSchema.mockResolvedValueOnce([mockRule])

      const result = await processor.processTransaction(mockTransaction)

      expect(result).toBeNull()
      expect(mockExchangeProvider.createMarketOrder).not.toHaveBeenCalled()
    })

    it('should handle auto-withdrawal when enabled', async () => {
      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 10,
        is_auto_withdrawal: true,
        withdrawal_address: 'bc1qtest123...'
      })

      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'purchase-123' }])
        .mockResolvedValueOnce([]) // withdrawal storage

      mockExchangeProvider.createMarketOrder.mockResolvedValue({
        ...mockKrakenResponses.createMarketOrder,
        status: 'filled' // Ensure it's filled for withdrawal
      })

      mockExchangeProvider.withdrawBitcoin.mockResolvedValue(mockKrakenResponses.withdrawBitcoin)

      const result = await processor.processTransaction(mockTransaction)

      expect(mockExchangeProvider.withdrawBitcoin).toHaveBeenCalledWith({
        currency: 'BTC',
        amount: 0.001, // From mock response
        address: 'bc1qtest123...',
        description: 'LIQUID ABT auto-withdrawal for purchase purchase-123',
        validateAddress: true
      })
    })

    it('should handle exchange API failures gracefully', async () => {
      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 10
      })

      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule])
        .mockResolvedValueOnce([])

      // Mock exchange failure
      mockExchangeProvider.createMarketOrder.mockRejectedValue(new Error('Exchange API failure'))

      // Should store failure and rethrow
      mockTenantSchemaManager.queryTenantSchema.mockResolvedValueOnce([]) // storeFailedProcessing

      await expect(processor.processTransaction(mockTransaction)).rejects.toThrow('Exchange API failure')

      // Should log the failure
      expect(mockTenantSchemaManager.queryTenantSchema).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('INSERT INTO processing_failures'),
        expect.arrayContaining(['test-transaction-123', expect.any(String)])
      )
    })

    it('should handle no active treasury rules', async () => {
      mockTenantSchemaManager.queryTenantSchema.mockResolvedValueOnce([]) // No rules

      const result = await processor.processTransaction(mockTransaction)

      expect(result).toBeNull()
      expect(mockExchangeProvider.createMarketOrder).not.toHaveBeenCalled()
    })

    it('should handle inactive treasury rules', async () => {
      const inactiveRule = createTestData.treasuryRule({
        is_active: false
      })

      mockTenantSchemaManager.queryTenantSchema.mockResolvedValueOnce([inactiveRule])

      const result = await processor.processTransaction(mockTransaction)

      expect(result).toBeNull()
    })

    it('should calculate fees correctly for different tiers', async () => {
      // This would test fee calculation if implemented in treasury rules
      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 10,
        settings: JSON.stringify({ feeRate: 0.55 }) // Growth tier
      })

      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'purchase-123' }])

      const mockOrderWithFees = {
        ...mockKrakenResponses.createMarketOrder,
        fees: [{ amount: 5.5, currency: 'AUD', type: 'trading' }] // 0.55% of $1000
      }

      mockExchangeProvider.createMarketOrder.mockResolvedValue(mockOrderWithFees)

      const result = await processor.processTransaction(mockTransaction)

      expect(result).toEqual({ bitcoinPurchaseId: 'purchase-123' })

      // Verify fees are stored correctly
      expect(mockTenantSchemaManager.queryTenantSchema).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('INSERT INTO bitcoin_purchases'),
        expect.arrayContaining([
          expect.any(String), // transaction_id
          100, // amount_aud (10% of 1000)
          0.001, // bitcoin_amount
          95000, // price_per_btc
          expect.any(String), // exchange_order_id
          'kraken', // exchange_provider
          'filled', // status
          5.5, // fees_aud
          expect.any(String) // raw_exchange_data
        ])
      )
    })

    it('should handle withdrawal failures without failing the purchase', async () => {
      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 10,
        is_auto_withdrawal: true,
        withdrawal_address: 'bc1qtest123...'
      })

      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'purchase-123' }])

      mockExchangeProvider.createMarketOrder.mockResolvedValue({
        ...mockKrakenResponses.createMarketOrder,
        status: 'filled'
      })

      // Mock withdrawal failure
      mockExchangeProvider.withdrawBitcoin.mockRejectedValue(new Error('Withdrawal failed'))

      // Should not throw - purchase should succeed even if withdrawal fails
      const result = await processor.processTransaction(mockTransaction)

      expect(result).toEqual({ bitcoinPurchaseId: 'purchase-123' })

      // Verify withdrawal was attempted
      expect(mockExchangeProvider.withdrawBitcoin).toHaveBeenCalledWith({
        currency: 'BTC',
        amount: 0.001,
        address: 'bc1qtest123...',
        description: 'LIQUID ABT auto-withdrawal for purchase purchase-123',
        validateAddress: true
      })
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle database connection failures', async () => {
      mockTenantSchemaManager.queryTenantSchema.mockRejectedValue(new Error('Database connection failed'))

      const transaction = createTestData.transaction()

      // Database error in getTreasuryRules causes it to return null, which means no processing
      const result = await processor.processTransaction(transaction)
      
      expect(result).toBeNull()
      expect(mockExchangeProvider.createMarketOrder).not.toHaveBeenCalled()
    })

    it('should handle malformed treasury rules data', async () => {
      // Mock corrupted rule data
      mockTenantSchemaManager.queryTenantSchema.mockResolvedValueOnce([{
        rule_type: 'invalid_type',
        conversion_percentage: null
      }])

      const transaction = createTestData.transaction()
      const result = await processor.processTransaction(transaction)

      expect(result).toBeNull()
    })

    it('should handle very large numbers correctly', async () => {
      const largeTransaction = createTestData.transaction({
        amount: Number.MAX_SAFE_INTEGER - 1
      })

      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 0.001, // Very small percentage
        minimum_purchase: 1,
        maximum_purchase: 5000 // Cap at maximum
      })

      mockTenantSchemaManager.queryTenantSchema
        .mockResolvedValueOnce([mockRule])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'purchase-123' }])

      mockExchangeProvider.createMarketOrder.mockResolvedValue(mockKrakenResponses.createMarketOrder)

      const result = await processor.processTransaction(largeTransaction)

      expect(result).toEqual({ bitcoinPurchaseId: 'purchase-123' })
      
      // Should be capped at maximum purchase amount despite large calculation
      expect(mockExchangeProvider.createMarketOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          value: 5000 // Capped at maximum_purchase
        })
      )
    })

    it('should handle concurrent processing correctly', async () => {
      const mockRule = createTestData.treasuryRule({
        rule_type: 'percentage',
        conversion_percentage: 10,
        minimum_purchase: 50,
        maximum_purchase: 5000,
        is_active: true
      })

      // Setup mock responses - use mockResolvedValue for concurrent processing
      mockTenantSchemaManager.queryTenantSchema
        .mockImplementation((tenantId, query, params) => {
          if (query.includes('treasury_rules')) {
            return Promise.resolve([mockRule])
          } else if (query.includes('integrations')) {
            return Promise.resolve([])
          } else if (query.includes('INSERT INTO bitcoin_purchases')) {
            // Return different IDs for different calls
            const callCount = mockTenantSchemaManager.queryTenantSchema.mock.calls.filter(
              call => call[1].includes('INSERT INTO bitcoin_purchases')
            ).length
            return Promise.resolve([{ id: `purchase-${callCount}` }])
          }
          return Promise.resolve([])
        })

      mockExchangeProvider.createMarketOrder.mockResolvedValue(mockKrakenResponses.createMarketOrder)

      const transaction1 = createTestData.transaction({ id: 'tx1', amount: 1000 })
      const transaction2 = createTestData.transaction({ id: 'tx2', amount: 1000 })

      // Process concurrently
      const [result1, result2] = await Promise.all([
        processor.processTransaction(transaction1),
        processor.processTransaction(transaction2)
      ])

      // Both should be successful purchases with valid IDs
      expect(result1).toEqual({ bitcoinPurchaseId: expect.stringMatching(/purchase-\d+/) })
      expect(result2).toEqual({ bitcoinPurchaseId: expect.stringMatching(/purchase-\d+/) })
      expect(mockExchangeProvider.createMarketOrder).toHaveBeenCalledTimes(2)
    })
  })
})