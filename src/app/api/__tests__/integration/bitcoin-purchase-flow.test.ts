// LIQUID ABT - Complete Bitcoin Purchase Flow Integration Tests

import { TestDatabaseUtils } from '@/../__tests__/utils/database';
import { TreasuryProcessor } from '@/lib/treasury-engine/processor';
import { MockExchangeProvider } from '@/lib/integrations/exchanges/mock/index';
import MockScenarios, { ScenarioFactory } from '@/lib/integrations/exchanges/mock/scenarios';
import { tenantSchemaManager } from '@/lib/database/connection';
import { ExchangeProviderFactory } from '@/lib/integrations/exchanges/interface';
import crypto from 'crypto';

describe('Bitcoin Purchase Flow Integration Tests', () => {
  let testTenant: any;
  let testUser: any;
  let treasuryProcessor: TreasuryProcessor;
  let mockExchange: MockExchangeProvider;
  
  // Test data IDs for tracking
  let processedTransactionIds: string[] = [];
  let bitcoinPurchaseIds: string[] = [];

  beforeAll(async () => {
    // Create test tenant
    const uniqueId = crypto.randomUUID();
    testTenant = await TestDatabaseUtils.createTestTenant({
      companyName: 'Bitcoin Flow Test Company',
      subdomain: `btc-flow-${uniqueId.substring(0, 8)}`,
      contactEmail: `btcflow+${uniqueId}@test.com`
    });
    
    // Create tenant schema
    if (!await tenantSchemaManager.schemaExists(testTenant.id)) {
      await tenantSchemaManager.createTenantSchema(testTenant.id);
    }
    
    testUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: testTenant.contactEmail,
      role: 'OWNER'
    });
    
    // Initialize treasury processor
    treasuryProcessor = new TreasuryProcessor(testTenant.id);
    
    // Initialize mock exchange
    mockExchange = new MockExchangeProvider(MockScenarios.SUCCESS);
    
  }, 30000);

  afterAll(async () => {
    if (testTenant?.id) {
      await TestDatabaseUtils.cleanupTenant(testTenant.id);
    }
    await TestDatabaseUtils.disconnect();
    
    // Restore mocks
    jest.restoreAllMocks();
  }, 10000);

  // Test environment factory for isolation
  const createTestEnvironment = () => {
    // Create fresh mock exchange instance for each test
    const freshMockExchange = new MockExchangeProvider(MockScenarios.SUCCESS);
    
    // Create fresh treasury processor
    const freshTreasuryProcessor = new TreasuryProcessor(testTenant.id);
    
    return {
      mockExchange: freshMockExchange,
      treasuryProcessor: freshTreasuryProcessor
    };
  };

  beforeEach(async () => {
    if (!testTenant?.id) return;
    
    // Restore all mocks to prevent contamination
    jest.restoreAllMocks();
    
    // Create fresh test environment
    const testEnv = createTestEnvironment();
    mockExchange = testEnv.mockExchange;
    treasuryProcessor = testEnv.treasuryProcessor;
    
    // Mock the ExchangeProviderFactory with fresh instance
    jest.spyOn(ExchangeProviderFactory, 'create').mockReturnValue(mockExchange);
    
    // Clear tracking arrays
    processedTransactionIds = [];
    bitcoinPurchaseIds = [];
    
    // Clean up test data for isolation (order matters due to foreign keys)
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      'DELETE FROM bitcoin_withdrawals WHERE 1=1',
      []
    );
    
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      'DELETE FROM bitcoin_purchases WHERE 1=1',
      []
    );
    
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      'DELETE FROM processing_failures WHERE 1=1',
      []
    );
    
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      'DELETE FROM transactions WHERE 1=1',
      []
    );
    
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      'DELETE FROM treasury_rules WHERE 1=1',
      []
    );
    
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      'DELETE FROM integrations WHERE 1=1',
      []
    );
  });

  afterEach(async () => {
    if (!testTenant?.id) return;
    
    // Force restore all mocks after each test
    jest.restoreAllMocks();
    
    // Additional cleanup: ensure no hanging promises or timers
    jest.clearAllTimers();
    
    // Optional: Drop and recreate tenant schema for maximum isolation
    // (Commented out for performance, but can be enabled for debugging)
    // await tenantSchemaManager.dropTenantSchema(testTenant.id);
    // await tenantSchemaManager.createTenantSchema(testTenant.id);
  });

  describe('Complete Success Flow', () => {
    it('should execute complete payment → rules → purchase → withdrawal flow', async () => {
      // Ensure fresh environment with SUCCESS scenario
      mockExchange.updateConfig(MockScenarios.SUCCESS);
      
      // Setup: Create active treasury rules with withdrawal address
      const treasuryRules = await createTestTreasuryRules({
        conversionPercentage: 10, // Convert 10% of payments to Bitcoin
        isActive: true,
        withdrawalAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' // Self-custody
      });

      // Step 1: Simulate payment received (e.g., from Stripe webhook)
      const paymentTransaction = await createTestTransaction({
        amount: 10000, // $100 AUD
        currency: 'AUD',
        paymentProcessor: 'stripe',
        status: 'succeeded', // TreasuryProcessor expects 'succeeded'
        shouldConvert: true, // Mark for conversion
        metadata: { orderId: 'order_123' }
      });

      // Step 2: Process transaction through treasury engine
      const result = await treasuryProcessor.processTransaction(paymentTransaction);
      
      expect(result).toBeDefined();
      expect(result?.bitcoinPurchaseId).toBeDefined();
      
      if (result?.bitcoinPurchaseId) {
        bitcoinPurchaseIds.push(result.bitcoinPurchaseId);
      }

      // Step 3: Verify Bitcoin purchase was created
      const bitcoinPurchases = await getBitcoinPurchases();
      expect(bitcoinPurchases).toHaveLength(1);
      
      const purchase = bitcoinPurchases[0];
      expect(purchase.transaction_id).toBe(paymentTransaction.id);
      expect(parseFloat(purchase.amount_aud)).toBe(1000); // 10% of $100
      expect(purchase.status).toBe('filled');
      expect(purchase.exchange_provider).toBe('kraken'); // Mock uses kraken type
      expect(purchase.exchange_order_id).toMatch(/^MOCK_\d+$/);

      // Step 4: Verify mock exchange state updated
      const mockState = mockExchange.getMockState();
      expect(mockState.balance.aud).toBeLessThan(100000); // Started with 100k, bought Bitcoin
      expect(mockState.balance.btc).toBeLessThanOrEqual(2.0); // Started with 2.0 BTC, may be withdrawn
      expect(mockState.orders).toHaveLength(1);
      expect(mockState.withdrawals.length).toBeGreaterThanOrEqual(1); // Should have withdrawal

      // Step 5: Verify withdrawal was initiated
      const [orderId, orderStatus] = mockState.orders[0];
      expect(orderStatus.status).toBe('filled');
      
      const [withdrawalId, withdrawalStatus] = mockState.withdrawals[0];
      expect(withdrawalStatus.address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
      expect(withdrawalStatus.status).toBe('pending');
      
      // Step 6: Verify no processing errors
      const processingFailures = await getProcessingFailures();
      expect(processingFailures).toHaveLength(0);
    }, 15000);

    it('should handle percentage-based treasury rules correctly', async () => {
      // Ensure fresh environment with SUCCESS scenario
      mockExchange.updateConfig(MockScenarios.SUCCESS);
      
      await createTestTreasuryRules({
        conversionPercentage: 25, // Convert 25% to Bitcoin
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 20000, // $200 AUD
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      const result = await treasuryProcessor.processTransaction(transaction);
      expect(result?.bitcoinPurchaseId).toBeDefined();

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(1);
      expect(parseFloat(purchases[0].amount_aud)).toBe(5000); // 25% of $200
    });

    it('should handle threshold-based treasury rules', async () => {
      // Ensure we're using SUCCESS scenario
      mockExchange.updateConfig(MockScenarios.SUCCESS);
      
      await createTestTreasuryRules({
        ruleType: 'threshold',
        thresholdAmount: 5000, // Convert when balance reaches $5000
        bufferAmount: 0, // No buffer for simpler testing
        isActive: true
      });

      // Small transaction - should not trigger conversion
      const smallTransaction = await createTestTransaction({
        amount: 3000, // $30 AUD
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      let result = await treasuryProcessor.processTransaction(smallTransaction);
      expect(result).toBeNull();

      let purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(0);

      // Large transaction - should trigger conversion
      const largeTransaction = await createTestTransaction({
        amount: 8000, // $80 AUD
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      result = await treasuryProcessor.processTransaction(largeTransaction);
      expect(result?.bitcoinPurchaseId).toBeDefined();

      purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(1);
      expect(parseFloat(purchases[0].amount_aud)).toBe(8000); // Full amount over threshold
    });
  });

  describe('Failure Scenarios', () => {
    it('should handle exchange service failure gracefully', async () => {
      // Configure mock to fail Bitcoin purchases
      mockExchange.updateConfig(MockScenarios.TRADING_DOWN);

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      // Should throw error and not create Bitcoin purchase
      await expect(treasuryProcessor.processTransaction(transaction)).rejects.toThrow();

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(0);

      // Should log the failure
      const processingFailures = await getProcessingFailures();
      expect(processingFailures).toHaveLength(1);
      expect(processingFailures[0].error_message).toContain('Order rejected');
    });

    it('should handle insufficient funds error', async () => {
      mockExchange.updateConfig(MockScenarios.INSUFFICIENT_FUNDS_AUD);

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 100000, // Large amount that exceeds mock balance
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      await expect(treasuryProcessor.processTransaction(transaction)).rejects.toThrow();

      const processingFailures = await getProcessingFailures();
      const errorFailures = processingFailures.filter(failure => !failure.is_resolved);
      expect(errorFailures).toHaveLength(1);
      expect(errorFailures[0].error_message).toContain('Insufficient funds');
    });

    it('should handle price service failure', async () => {
      mockExchange.updateConfig(MockScenarios.PRICE_SERVICE_DOWN);

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      await expect(treasuryProcessor.processTransaction(transaction)).rejects.toThrow();

      const processingFailures = await getProcessingFailures();
      const errorFailures = processingFailures.filter(failure => !failure.is_resolved);
      expect(errorFailures).toHaveLength(1);
    });

    it('should handle withdrawal service failure separately from purchase', async () => {
      // Configure to fail withdrawals but allow purchases
      mockExchange.updateConfig({ 
        ...MockScenarios.SUCCESS,
        shouldFailWithdraw: true 
      });

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true,
        withdrawalAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      // Should succeed overall (purchase works, withdrawal fails but doesn't throw)
      const result = await treasuryProcessor.processTransaction(transaction);
      expect(result?.bitcoinPurchaseId).toBeDefined();

      // Bitcoin purchase should be created
      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(1);
      expect(purchases[0].status).toBe('filled');

      // No withdrawal should have been created
      const mockState = mockExchange.getMockState();
      expect(mockState.withdrawals).toHaveLength(0);
    });

    it('should handle network connectivity issues', async () => {
      mockExchange.updateConfig(MockScenarios.NETWORK_ERROR);

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      await expect(treasuryProcessor.processTransaction(transaction)).rejects.toThrow();

      const processingFailures = await getProcessingFailures();
      const errorFailures = processingFailures.filter(failure => !failure.is_resolved);
      expect(errorFailures).toHaveLength(1);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed operations with exponential backoff', async () => {
      // Configure mock to simulate network error on first few attempts
      let attemptCount = 0;
      const originalCheckForSimulatedErrors = (mockExchange as any).checkForSimulatedErrors.bind(mockExchange);
      
      // Spy on the method to track retry attempts  
      const checkErrorsSpy = jest.spyOn(mockExchange as any, 'checkForSimulatedErrors').mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          // Throw a retryable network error on first attempt
          const error = new Error('Temporary network error');
          (error as any).code = 'ECONNRESET';
          throw error;
        }
        // Succeed on subsequent attempts
        return originalCheckForSimulatedErrors();
      });

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      // Should succeed after retry
      const result = await treasuryProcessor.processTransaction(transaction);
      expect(result?.bitcoinPurchaseId).toBeDefined();

      // Should have been called at least twice (first failure, then success)
      expect(checkErrorsSpy).toHaveBeenCalledTimes(2);

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(1);
      expect(purchases[0].status).toBe('filled');
      
      // Cleanup
      checkErrorsSpy.mockRestore();
    });

    it('should eventually give up after max retries', async () => {
      // Ensure we start with SUCCESS scenario 
      mockExchange.updateConfig(MockScenarios.SUCCESS);
      
      // Configure mock to always fail
      mockExchange.createMarketOrder = jest.fn().mockRejectedValue(
        new Error('Persistent network error')
      );

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      await expect(treasuryProcessor.processTransaction(transaction)).rejects.toThrow(
        'Persistent network error'
      );

      // Should have retried multiple times
      expect(mockExchange.createMarketOrder).toHaveBeenCalledTimes(4); // 1 + 3 retries

      const processingFailures = await getProcessingFailures();
      const errorFailures = processingFailures.filter(failure => !failure.is_resolved);
      expect(errorFailures).toHaveLength(1);
    });
  });

  describe('Idempotency', () => {
    it('should not create duplicate purchases for same transaction', async () => {
      // Ensure we're using SUCCESS scenario for idempotency tests
      mockExchange.updateConfig(MockScenarios.SUCCESS);
      
      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      // Process same transaction twice
      const result1 = await treasuryProcessor.processTransaction(transaction);
      const result2 = await treasuryProcessor.processTransaction(transaction);

      expect(result1?.bitcoinPurchaseId).toBeDefined();
      expect(result2?.bitcoinPurchaseId).toBeDefined();
      
      // Should be the same purchase ID (idempotent)
      expect(result1?.bitcoinPurchaseId).toBe(result2?.bitcoinPurchaseId);

      // Should only have one purchase record
      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(1);

      // Mock exchange should only have one order
      const mockState = mockExchange.getMockState();
      expect(mockState.orders).toHaveLength(1);
    });

    it('should handle concurrent processing of same transaction', async () => {
      // Ensure we're using SUCCESS scenario for concurrency tests
      mockExchange.updateConfig(MockScenarios.SUCCESS);
      
      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      // Process same transaction concurrently
      const [result1, result2] = await Promise.all([
        treasuryProcessor.processTransaction(transaction),
        treasuryProcessor.processTransaction(transaction)
      ]);

      expect(result1?.bitcoinPurchaseId).toBeDefined();
      expect(result2?.bitcoinPurchaseId).toBeDefined();

      // Should be the same purchase (one should have been idempotent)
      expect(result1?.bitcoinPurchaseId).toBe(result2?.bitcoinPurchaseId);

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(1);
    });

    it('should create separate purchases for different transactions', async () => {
      // Ensure we're using SUCCESS scenario 
      mockExchange.updateConfig(MockScenarios.SUCCESS);
      
      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction1 = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true,
        metadata: { orderId: 'order_1' }
      });

      const transaction2 = await createTestTransaction({
        amount: 15000,
        currency: 'AUD', 
        status: 'succeeded',
        shouldConvert: true,
        metadata: { orderId: 'order_2' }
      });

      const result1 = await treasuryProcessor.processTransaction(transaction1);
      const result2 = await treasuryProcessor.processTransaction(transaction2);

      expect(result1?.bitcoinPurchaseId).toBeDefined();
      expect(result2?.bitcoinPurchaseId).toBeDefined();
      expect(result1?.bitcoinPurchaseId).not.toBe(result2?.bitcoinPurchaseId);

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(2);
      
      // Should have different amounts
      const amounts = purchases.map(p => parseFloat(p.amount_aud)).sort();
      expect(amounts).toEqual([1000, 1500]); // 10% of each
    });
  });

  describe('Partial Fills and Complex Scenarios', () => {
    it('should handle partial order fills correctly', async () => {
      mockExchange.updateConfig(MockScenarios.PARTIAL_FILLS);

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      const result = await treasuryProcessor.processTransaction(transaction);
      expect(result?.bitcoinPurchaseId).toBeDefined();

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(1);
      expect(purchases[0].status).toBe('partially_filled');
      
      // Should record the actual filled amount
      expect(parseFloat(purchases[0].bitcoin_amount)).toBeCloseTo(
        parseFloat(purchases[0].amount_aud) / 50000 * 0.5, // 50% fill rate
        6
      );
    });

    it('should handle high latency scenarios', async () => {
      mockExchange.updateConfig(MockScenarios.HIGH_LATENCY);

      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: true
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      const startTime = Date.now();
      const result = await treasuryProcessor.processTransaction(transaction);
      const elapsed = Date.now() - startTime;

      expect(result?.bitcoinPurchaseId).toBeDefined();
      expect(elapsed).toBeGreaterThan(2000); // Should include latency delay

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(1);
    });
  });

  describe('Treasury Rules Edge Cases', () => {
    it('should not process when treasury rules are inactive', async () => {
      await createTestTreasuryRules({
        conversionPercentage: 10,
        isActive: false // Inactive
      });

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      const result = await treasuryProcessor.processTransaction(transaction);
      expect(result).toBeNull();

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(0);
    });

    it('should not process when no treasury rules exist', async () => {
      // No treasury rules created

      const transaction = await createTestTransaction({
        amount: 10000,
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      const result = await treasuryProcessor.processTransaction(transaction);
      expect(result).toBeNull();

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(0);
    });

    it('should handle minimum conversion amounts', async () => {
      await createTestTreasuryRules({
        conversionPercentage: 10,
        minimumAmount: 2000, // $20 minimum
        isActive: true
      });

      // Small transaction below minimum
      const smallTransaction = await createTestTransaction({
        amount: 5000, // $50, but 10% = $5 which is below $20 minimum
        currency: 'AUD',
        status: 'succeeded',
        shouldConvert: true
      });

      const result = await treasuryProcessor.processTransaction(smallTransaction);
      expect(result).toBeNull();

      const purchases = await getBitcoinPurchases();
      expect(purchases).toHaveLength(0);
    });
  });

  // Helper functions
  async function createTestTreasuryRules(rules: any) {
    const ruleData = {
      name: rules.name || 'Test Treasury Rule',
      rule_type: rules.conversionType || 'percentage',
      conversion_percentage: rules.conversionPercentage || null,
      threshold_amount: rules.thresholdAmount || null,
      minimum_purchase: rules.minimumAmount || null,
      maximum_purchase: rules.maximumAmount || null,
      withdrawal_address: rules.withdrawalAddress || null,
      is_active: rules.isActive || false,
      exchange_provider: 'kraken',
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO treasury_rules (
        name, rule_type, conversion_percentage, threshold_amount, 
        minimum_purchase, maximum_purchase, withdrawal_address,
        is_active, exchange_provider, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        ruleData.name, ruleData.rule_type, ruleData.conversion_percentage, ruleData.threshold_amount,
        ruleData.minimum_purchase, ruleData.maximum_purchase, ruleData.withdrawal_address,
        ruleData.is_active, ruleData.exchange_provider, ruleData.created_at, ruleData.updated_at
      ]
    );

    return result[0];
  }

  async function createTestTransaction(transaction: any) {
    // First create a payment integration if we don't have one
    let paymentIntegration;
    try {
      const integrations = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM integrations WHERE type = \'PAYMENT\' LIMIT 1',
        []
      );
      if (integrations.length === 0) {
        paymentIntegration = await TestDatabaseUtils.createTestIntegration(testTenant.id, {
          provider: transaction.paymentProcessor || 'stripe',
          type: 'PAYMENT'
        });
      } else {
        paymentIntegration = integrations[0];
      }
    } catch (error) {
      paymentIntegration = await TestDatabaseUtils.createTestIntegration(testTenant.id, {
        provider: transaction.paymentProcessor || 'stripe',
        type: 'PAYMENT'
      });
    }

    // Also create an EXCHANGE integration for TreasuryProcessor
    try {
      const exchangeIntegrations = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM integrations WHERE type = \'EXCHANGE\' LIMIT 1',
        []
      );
      if (exchangeIntegrations.length === 0) {
        await TestDatabaseUtils.createTestIntegration(testTenant.id, {
          provider: 'kraken',
          type: 'EXCHANGE'
        });
      }
    } catch (error) {
      await TestDatabaseUtils.createTestIntegration(testTenant.id, {
        provider: 'kraken',
        type: 'EXCHANGE'
      });
    }

    const txData = {
      id: crypto.randomUUID(),
      integration_id: paymentIntegration.id,
      external_id: transaction.externalId || `ext_${crypto.randomUUID().substring(0, 8)}`,
      amount: transaction.amount,
      currency: transaction.currency || 'AUD',
      description: transaction.description || 'Test transaction',
      status: transaction.status || 'PENDING',
      should_convert: transaction.shouldConvert || false,
      provider: transaction.paymentProcessor || 'stripe',
      provider_data: transaction.metadata || {},
      created_at: new Date(),
      updated_at: new Date()
    };

    processedTransactionIds.push(txData.id);

    const result = await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO transactions (
        id, integration_id, external_id, amount, currency, description,
        status, should_convert, provider, provider_data, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        txData.id, txData.integration_id, txData.external_id, txData.amount, 
        txData.currency, txData.description, txData.status, txData.should_convert, 
        txData.provider, JSON.stringify(txData.provider_data), txData.created_at, txData.updated_at
      ]
    );

    return result[0];
  }

  async function getBitcoinPurchases() {
    return await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      'SELECT * FROM bitcoin_purchases ORDER BY created_at DESC',
      []
    );
  }

  async function getProcessingFailures() {
    return await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      'SELECT * FROM processing_failures ORDER BY created_at DESC',
      []
    );
  }
});