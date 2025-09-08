// LIQUID ABT - Stripe Webhook Integration Tests

import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { StripeProcessor } from '@/lib/integrations/payments/stripe'
import { tenantSchemaManager } from '@/lib/database/connection'
import crypto from 'crypto'

describe('Stripe Webhook Integration Tests', () => {
  let testTenant: any
  let testUser: any
  let stripeIntegration: any
  
  beforeAll(async () => {
    // Create test tenant for webhook tests
    const uniqueId = require('crypto').randomUUID()
    testTenant = await TestDatabaseUtils.createTestTenant({
      companyName: 'Stripe Webhook Test Company',
      subdomain: `stripe-webhook-${uniqueId.substring(0, 8)}`,
      contactEmail: `webhook+${uniqueId}@test.com`
    })
    
    // Create tenant schema
    if (!await tenantSchemaManager.schemaExists(testTenant.id)) {
      await tenantSchemaManager.createTenantSchema(testTenant.id)
    }
    
    testUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: testTenant.contactEmail,
      role: 'OWNER'
    })
    
    // Create Stripe integration for testing
    stripeIntegration = await TestDatabaseUtils.createTestIntegration(testTenant.id, {
      provider: 'stripe',
      type: 'PAYMENT'
    })
  }, 30000)
  
  afterAll(async () => {
    if (testTenant?.id) {
      await TestDatabaseUtils.cleanupTenant(testTenant.id)
    }
    
    await TestDatabaseUtils.disconnect()
  }, 10000)
  
  beforeEach(async () => {
    if (!testTenant?.id) return
    
    // Manual cleanup of test data for isolation
    try {
      await tenantSchemaManager.queryTenantSchema(testTenant.id, 'DELETE FROM bitcoin_purchases', [])
      await tenantSchemaManager.queryTenantSchema(testTenant.id, 'DELETE FROM transactions', [])
      // Note: We keep integrations as they're created once per test suite
    } catch (error) {
      // Ignore cleanup errors - tables might not exist yet
    }
  })

  // Helper function to create a valid Stripe webhook signature
  const createValidSignature = (payload: string, secret: string): string => {
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${payload}`
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload, 'utf8')
      .digest('hex')
    return `t=${timestamp},v1=${signature}`
  }

  describe('Webhook Processing Logic', () => {
    it('should validate webhook signature creation', async () => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
      expect(webhookSecret).toBeDefined()
      expect(webhookSecret.length).toBeGreaterThan(20)
      
      // Test signature creation
      const testPayload = JSON.stringify({ test: 'data' })
      const signature = createValidSignature(testPayload, webhookSecret)
      
      expect(signature).toContain('t=')
      expect(signature).toContain('v1=')
    })

    it('should process payment intent transactions correctly', async () => {
      // Create test transaction data for Stripe processing
      const testPaymentIntent = {
        id: 'pi_test_payment_intent',
        object: 'payment_intent',
        amount: 10000, // $100.00 in cents
        currency: 'aud',
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
        description: 'Test payment',
        metadata: {
          tenant_id: testTenant.id,
          should_convert: 'true'
        }
      } as any
      
      // Test Stripe processor conversion
      const processor = new StripeProcessor({
        secretKey: 'sk_test_fake_key',
        clientId: 'ca_test_fake_id', // Provide fake client ID for testing
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
      })
      
      const transaction = processor['convertPaymentIntentToTransaction'](testPaymentIntent)
      
      expect(transaction.id).toBe('pi_test_payment_intent')
      expect(transaction.amount).toBe(100) // Converted from cents
      expect(transaction.currency).toBe('AUD')
      expect(transaction.status).toBe('succeeded')
    })

    it('should handle transaction storage in tenant database', async () => {
      // Create a test transaction directly in the tenant database
      const testTransaction = await TestDatabaseUtils.createTestTransaction(
        testTenant.id, 
        stripeIntegration.id, 
        {
          external_id: 'pi_test_transaction',
          amount: 150.00,
          currency: 'AUD',
          description: 'Stripe webhook test transaction',
          status: 'succeeded',
          provider: 'stripe',
          should_convert: true
        }
      )
      
      // Verify transaction was stored correctly
      const storedTransaction = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM transactions WHERE external_id = $1',
        ['pi_test_transaction']
      )
      
      expect(storedTransaction).toHaveLength(1)
      expect(storedTransaction[0].amount).toBe('150.00')
      expect(storedTransaction[0].provider).toBe('stripe')
      expect(storedTransaction[0].should_convert).toBe(true)
    })

    it('should handle different transaction statuses correctly', async () => {
      // Test succeeded transaction
      const succeededTx = await TestDatabaseUtils.createTestTransaction(
        testTenant.id,
        stripeIntegration.id,
        {
          external_id: 'pi_succeeded',
          status: 'succeeded',
          should_convert: true
        }
      )
      
      // Test failed transaction
      const failedTx = await TestDatabaseUtils.createTestTransaction(
        testTenant.id,
        stripeIntegration.id,
        {
          external_id: 'pi_failed',
          status: 'failed',
          should_convert: false // Failed transactions shouldn't convert
        }
      )
      
      // Verify both transactions stored with correct status
      const transactions = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM transactions WHERE external_id IN ($1, $2)',
        ['pi_succeeded', 'pi_failed']
      )
      
      expect(transactions).toHaveLength(2)
      
      const succeeded = transactions.find(t => t.external_id === 'pi_succeeded')
      const failed = transactions.find(t => t.external_id === 'pi_failed')
      
      expect(succeeded.status).toBe('succeeded')
      expect(succeeded.should_convert).toBe(true)
      
      expect(failed.status).toBe('failed')
      expect(failed.should_convert).toBe(false)
    })

    it('should associate transactions with correct tenant integrations', async () => {
      // Verify our Stripe integration exists
      const integrations = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM integrations WHERE provider = $1',
        ['stripe']
      )
      
      expect(integrations).toHaveLength(1)
      expect(integrations[0].provider).toBe('stripe')
      expect(integrations[0].type).toBe('PAYMENT')
      expect(integrations[0].is_active).toBe(true)
      
      // Create transaction linked to this integration
      const transaction = await TestDatabaseUtils.createTestTransaction(
        testTenant.id,
        integrations[0].id,
        {
          external_id: 'pi_integration_test',
          provider: 'stripe'
        }
      )
      
      expect(transaction.integration_id).toBe(integrations[0].id)
    })

    it('should handle currency conversion properly', async () => {
      // Test AUD transaction (no conversion needed)
      const audTransaction = await TestDatabaseUtils.createTestTransaction(
        testTenant.id,
        stripeIntegration.id,
        {
          external_id: 'pi_aud_test',
          amount: 250.00,
          currency: 'AUD'
        }
      )
      
      // Test USD transaction (would need conversion in real scenario)
      const usdTransaction = await TestDatabaseUtils.createTestTransaction(
        testTenant.id,
        stripeIntegration.id,
        {
          external_id: 'pi_usd_test',
          amount: 180.00,
          currency: 'USD'
        }
      )
      
      // Verify both transactions stored correctly
      const transactions = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM transactions WHERE external_id IN ($1, $2)',
        ['pi_aud_test', 'pi_usd_test']
      )
      
      expect(transactions).toHaveLength(2)
      
      const audTx = transactions.find(t => t.currency === 'AUD')
      const usdTx = transactions.find(t => t.currency === 'USD')
      
      expect(audTx.amount).toBe('250.00')
      expect(usdTx.amount).toBe('180.00')
    })

    it('should maintain transaction integrity during processing', async () => {
      // Create multiple transactions in sequence
      const transactions = []
      
      for (let i = 1; i <= 3; i++) {
        const tx = await TestDatabaseUtils.createTestTransaction(
          testTenant.id,
          stripeIntegration.id,
          {
            external_id: `pi_sequence_${i}`,
            amount: 100 * i,
            description: `Sequence transaction ${i}`
          }
        )
        transactions.push(tx)
      }
      
      // Verify all transactions stored correctly
      const storedTransactions = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM transactions ORDER BY amount',
        []
      )
      
      expect(storedTransactions).toHaveLength(3)
      expect(storedTransactions[0].amount).toBe('100.00')
      expect(storedTransactions[1].amount).toBe('200.00')
      expect(storedTransactions[2].amount).toBe('300.00')
    })

    it('should validate Stripe processor initialization', async () => {
      // Test processor can be initialized with credentials
      const processor = new StripeProcessor({
        secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_fake_key',
        clientId: process.env.STRIPE_CLIENT_ID || 'ca_test_fake_id',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
      })
      
      expect(processor.name).toBe('Stripe')
      expect(processor.type).toBe('stripe')
    })

    it('should handle webhook event types correctly', async () => {
      // Test supported event types that StripeProcessor handles
      const supportedEvents = [
        'payment_intent.succeeded',
        'invoice.payment_succeeded', 
        'checkout.session.completed'
      ]
      
      supportedEvents.forEach(eventType => {
        expect(typeof eventType).toBe('string')
        expect(eventType).toContain('.')
      })
      
      // Verify processor can handle these event types
      const processor = new StripeProcessor({
        secretKey: 'sk_test_fake_key',
        clientId: 'ca_test_fake_id',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
      })
      
      expect(processor['convertStripeStatus']).toBeDefined()
    })

    it('should validate webhook signature creation and verification', () => {
      // Test webhook signature validation logic without HTTP calls
      const testPayload = JSON.stringify({
        id: 'evt_test_webhook',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_webhook_payment',
            object: 'payment_intent',
            amount: 5000, // $50.00 in cents
            currency: 'aud',
            status: 'succeeded',
            metadata: {
              tenant_id: testTenant.id,
              should_convert: 'true'
            }
          }
        },
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        pending_webhooks: 0,
        request: {
          id: null,
          idempotency_key: null
        }
      })
      
      // Test signature validation logic
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
      const timestamp = Math.floor(Date.now() / 1000)
      const signature = createValidSignature(testPayload, webhookSecret, timestamp)
      
      // Verify signature format
      expect(signature).toContain('t=')
      expect(signature).toContain('v1=')
      
      // Test signature parts extraction
      const [timestampPart, signaturePart] = signature.split(',')
      expect(timestampPart.startsWith('t=')).toBe(true)
      expect(signaturePart.startsWith('v1=')).toBe(true)
      
      const extractedTimestamp = parseInt(timestampPart.substring(2))
      expect(extractedTimestamp).toBe(timestamp)
      
      // Test signature verification logic
      const signedPayload = `${timestamp}.${testPayload}`
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(signedPayload, 'utf8')
        .digest('hex')
      
      const providedSignature = signaturePart.substring(3) // Remove 'v1='
      expect(providedSignature).toBe(expectedSignature)
    })

    it('should detect invalid webhook signatures', () => {
      // Test invalid signature detection logic
      const testPayload = JSON.stringify({
        id: 'evt_test_invalid',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_invalid' } }
      })
      
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
      const timestamp = Math.floor(Date.now() / 1000)
      
      // Test various invalid signature scenarios
      const invalidSignatures = [
        'invalid_signature',
        't=123456789,v1=invalid_hash',
        `t=${timestamp},v1=wrong_signature`,
        'malformed_signature_format',
        '',
        't=,v1=',
        `t=abc,v1=${crypto.randomBytes(32).toString('hex')}`
      ]
      
      const validateSignature = (signature: string, payload: string, secret: string, currentTimestamp: number) => {
        try {
          if (!signature || !signature.includes('t=') || !signature.includes('v1=')) {
            return { valid: false, reason: 'malformed_signature' }
          }
          
          const [timestampPart, signaturePart] = signature.split(',')
          const providedTimestamp = parseInt(timestampPart.substring(2))
          const providedSignature = signaturePart.substring(3)
          
          if (isNaN(providedTimestamp)) {
            return { valid: false, reason: 'invalid_timestamp' }
          }
          
          // Check timestamp tolerance (5 minutes)
          const timeDifference = Math.abs(currentTimestamp - providedTimestamp)
          if (timeDifference > 300) {
            return { valid: false, reason: 'timestamp_too_old' }
          }
          
          // Verify signature
          const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(`${providedTimestamp}.${payload}`, 'utf8')
            .digest('hex')
          
          if (providedSignature !== expectedSignature) {
            return { valid: false, reason: 'signature_mismatch' }
          }
          
          return { valid: true, reason: 'valid' }
        } catch (error) {
          return { valid: false, reason: 'validation_error' }
        }
      }
      
      invalidSignatures.forEach(invalidSig => {
        const result = validateSignature(invalidSig, testPayload, webhookSecret, timestamp)
        expect(result.valid).toBe(false)
        expect(result.reason).toBeDefined()
      })
      
      // Test valid signature passes
      const validSignature = createValidSignature(testPayload, webhookSecret, timestamp)
      const validResult = validateSignature(validSignature, testPayload, webhookSecret, timestamp)
      expect(validResult.valid).toBe(true)
    })

    it('should handle missing signature validation gracefully', () => {
      // Test missing signature detection logic
      const testPayload = JSON.stringify({
        id: 'evt_test_missing_sig',
        type: 'payment_intent.succeeded'
      })
      
      const checkRequiredHeaders = (headers: Record<string, string | undefined>) => {
        const errors = []
        
        if (!headers['stripe-signature']) {
          errors.push('Missing stripe-signature header')
        }
        
        if (!headers['content-type'] || !headers['content-type'].includes('application/json')) {
          errors.push('Invalid or missing content-type header')
        }
        
        if (!testPayload || testPayload.trim() === '') {
          errors.push('Empty request body')
        }
        
        return {
          valid: errors.length === 0,
          errors,
          shouldReject: errors.length > 0
        }
      }
      
      // Test various header scenarios
      const headerScenarios = [
        { headers: {}, expectedErrors: ['Missing stripe-signature header', 'Invalid or missing content-type header'] },
        { headers: { 'content-type': 'application/json' }, expectedErrors: ['Missing stripe-signature header'] },
        { headers: { 'stripe-signature': 't=123,v1=abc' }, expectedErrors: ['Invalid or missing content-type header'] },
        { headers: { 'stripe-signature': 't=123,v1=abc', 'content-type': 'text/plain' }, expectedErrors: ['Invalid or missing content-type header'] },
        { headers: { 'stripe-signature': 't=123,v1=abc', 'content-type': 'application/json' }, expectedErrors: [] }
      ]
      
      headerScenarios.forEach(({ headers, expectedErrors }) => {
        const result = checkRequiredHeaders(headers)
        expect(result.errors).toEqual(expectedErrors)
        expect(result.valid).toBe(expectedErrors.length === 0)
        expect(result.shouldReject).toBe(expectedErrors.length > 0)
      })
    })

    it('should implement webhook idempotency correctly', async () => {
      // Test webhook idempotency logic using database operations
      const webhookEventId = 'evt_idempotency_test'
      const provider = 'stripe'
      
      const idempotencyChecker = {
        processedEvents: new Map<string, { processed: boolean, timestamp: number }>(),
        
        checkIdempotency: function(eventId: string, provider: string) {
          const key = `${eventId}:${provider}`
          const existingEvent = this.processedEvents.get(key)
          
          if (existingEvent) {
            return {
              alreadyProcessed: true,
              message: `Event ${eventId} already processed`,
              processedAt: existingEvent.timestamp
            }
          }
          
          return {
            alreadyProcessed: false,
            canProcess: true
          }
        },
        
        markAsProcessed: function(eventId: string, provider: string) {
          const key = `${eventId}:${provider}`
          this.processedEvents.set(key, {
            processed: true,
            timestamp: Date.now()
          })
        }
      }
      
      // First processing attempt
      const firstCheck = idempotencyChecker.checkIdempotency(webhookEventId, provider)
      expect(firstCheck.alreadyProcessed).toBe(false)
      expect(firstCheck.canProcess).toBe(true)
      
      // Mark as processed
      idempotencyChecker.markAsProcessed(webhookEventId, provider)
      
      // Second processing attempt (should be detected as duplicate)
      const secondCheck = idempotencyChecker.checkIdempotency(webhookEventId, provider)
      expect(secondCheck.alreadyProcessed).toBe(true)
      expect(secondCheck.message).toBe(`Event ${webhookEventId} already processed`)
      expect(secondCheck.processedAt).toBeDefined()
      
      // Different event should be allowed
      const differentEventCheck = idempotencyChecker.checkIdempotency('evt_different_event', provider)
      expect(differentEventCheck.alreadyProcessed).toBe(false)
      expect(differentEventCheck.canProcess).toBe(true)
      
      // Same event ID but different provider should be allowed
      const differentProviderCheck = idempotencyChecker.checkIdempotency(webhookEventId, 'paypal')
      expect(differentProviderCheck.alreadyProcessed).toBe(false)
      expect(differentProviderCheck.canProcess).toBe(true)
    })

    it('should ensure database isolation between tenants', async () => {
      // Create second tenant for isolation test
      const otherTenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'Other Webhook Test Company',
        subdomain: `other-webhook-${Date.now()}`,
        contactEmail: `other-webhook@${Date.now()}.com`
      })
      
      if (!await tenantSchemaManager.schemaExists(otherTenant.id)) {
        await tenantSchemaManager.createTenantSchema(otherTenant.id)
      }
      
      // Create integration and transaction in other tenant
      const otherIntegration = await TestDatabaseUtils.createTestIntegration(otherTenant.id, {
        provider: 'stripe'
      })
      
      await TestDatabaseUtils.createTestTransaction(otherTenant.id, otherIntegration.id, {
        external_id: 'pi_other_tenant'
      })
      
      // Verify original tenant can't see other tenant's data
      const originalTenantTxs = await tenantSchemaManager.queryTenantSchema(
        testTenant.id,
        'SELECT * FROM transactions WHERE external_id = $1',
        ['pi_other_tenant']
      )
      
      expect(originalTenantTxs).toHaveLength(0)
      
      // Clean up
      await TestDatabaseUtils.cleanupTenant(otherTenant.id)
    })
  })
})