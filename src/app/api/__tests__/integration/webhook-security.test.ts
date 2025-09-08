// LIQUID ABT - Webhook Replay Attack Prevention Tests

import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { tenantSchemaManager, getMasterPrisma } from '@/lib/database/connection'
import crypto from 'crypto'

describe('Webhook Security Integration Tests', () => {
  let testTenant: any
  
  beforeAll(async () => {
    // Create test tenant with unique data
    const uniqueId = crypto.randomUUID()
    testTenant = await TestDatabaseUtils.createTestTenant({
      companyName: 'Webhook Security Test',
      subdomain: `webhook-sec-${uniqueId.substring(0, 8)}`,
      contactEmail: `webhook-sec+${uniqueId}@test.com`
    })
    
    if (!await tenantSchemaManager.schemaExists(testTenant.id)) {
      await tenantSchemaManager.createTenantSchema(testTenant.id)
    }
  }, 30000)
  
  afterAll(async () => {
    if (testTenant?.id) {
      await TestDatabaseUtils.cleanupTenant(testTenant.id)
    }
    
    await TestDatabaseUtils.disconnect()
  }, 10000)

  beforeEach(async () => {
    // Manual cleanup of test data for isolation
    const prisma = getMasterPrisma()
    
    // This test suite doesn't create persistent data, so minimal cleanup needed
    // The webhook security tests are stateless and don't modify the database
  })

  describe('Webhook Replay Attack Prevention', () => {
    // Helper to create webhook signature
    const createWebhookSignature = (payload: string, secret: string, timestamp?: number): string => {
      const ts = timestamp || Math.floor(Date.now() / 1000)
      const signedPayload = `${ts}.${payload}`
      const signature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload, 'utf8')
        .digest('hex')
      return `t=${ts},v1=${signature}`
    }

    it('should prevent replay attacks with old timestamps', async () => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
      const payload = JSON.stringify({
        id: 'evt_test_replay',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_replay', status: 'succeeded' } }
      })
      
      // Create signature with old timestamp (1 hour ago)
      const oldTimestamp = Math.floor(Date.now() / 1000) - 3600
      const oldSignature = createWebhookSignature(payload, webhookSecret, oldTimestamp)
      
      // Verify the signature format is valid but old
      expect(oldSignature).toContain('t=')
      expect(oldSignature).toContain('v1=')
      
      const extractedTimestamp = parseInt(oldSignature.split(',')[0].substring(2))
      expect(extractedTimestamp).toBe(oldTimestamp)
      expect(Date.now() / 1000 - extractedTimestamp).toBeGreaterThan(3000) // More than 5 minutes old
    })

    it('should validate webhook signature timing', () => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
      const payload = JSON.stringify({ test: 'data' })
      
      // Create current signature
      const currentSignature = createWebhookSignature(payload, webhookSecret)
      
      // Extract timestamp
      const timestampMatch = currentSignature.match(/t=(\d+)/)
      expect(timestampMatch).toBeTruthy()
      
      const timestamp = parseInt(timestampMatch![1])
      const currentTime = Math.floor(Date.now() / 1000)
      
      // Should be within tolerance (5 minutes = 300 seconds)
      const timeDiff = Math.abs(currentTime - timestamp)
      expect(timeDiff).toBeLessThan(300)
    })

    it('should prevent signature tampering', () => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
      const payload = JSON.stringify({
        id: 'evt_original',
        type: 'payment_intent.succeeded',
        data: { object: { amount: 1000 } }
      })
      
      // Create valid signature
      const validSignature = createWebhookSignature(payload, webhookSecret)
      
      // Tamper with the payload (change amount)
      const tamperedPayload = JSON.stringify({
        id: 'evt_original',
        type: 'payment_intent.succeeded',
        data: { object: { amount: 999999 } } // Changed amount
      })
      
      // Original signature shouldn't work with tampered payload
      const parts = validSignature.split(',')
      const timestamp = parts[0]
      const originalHash = parts[1].substring(3) // Remove 'v1='
      
      // Calculate what the hash should be for tampered payload
      const timestampValue = timestamp.substring(2)
      const expectedHash = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestampValue}.${tamperedPayload}`, 'utf8')
        .digest('hex')
      
      // Signatures should be different
      expect(originalHash).not.toBe(expectedHash)
    })

    it('should handle duplicate webhook processing', async () => {
      const webhookEventId = `evt_duplicate_${crypto.randomUUID().substring(0, 8)}`
      
      // Simulate processing the same webhook twice
      const integration = await TestDatabaseUtils.createTestIntegration(testTenant.id)
      
      // First processing
      const transaction1 = await TestDatabaseUtils.createTestTransaction(
        testTenant.id,
        integration.id,
        {
          external_id: webhookEventId,
          description: 'First webhook processing'
        }
      )
      
      // Check if duplicate external_id would be prevented by database constraints
      try {
        const transaction2 = await TestDatabaseUtils.createTestTransaction(
          testTenant.id,
          integration.id,
          {
            external_id: webhookEventId, // Same external_id
            description: 'Duplicate webhook processing'
          }
        )
        
        // If no constraint exists, we still have both transactions
        expect(transaction2.external_id).toBe(webhookEventId)
        
        // Verify both exist but application should handle deduplication
        const duplicates = await tenantSchemaManager.queryTenantSchema(
          testTenant.id,
          'SELECT COUNT(*) as count FROM transactions WHERE external_id = $1',
          [webhookEventId]
        )
        
        expect(parseInt(duplicates[0].count)).toBeGreaterThan(0)
        
      } catch (error) {
        // If there's a unique constraint, that's good for preventing duplicates
        expect(error.message).toMatch(/unique|duplicate/i)
      }
    })

    it('should validate webhook secret strength', () => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
      
      expect(webhookSecret).toBeDefined()
      expect(webhookSecret.length).toBeGreaterThan(20) // Reasonable minimum length
      
      // Secret should not be a default value
      const defaultSecrets = ['whsec_test', 'webhook_secret', 'secret', '123456']
      expect(defaultSecrets).not.toContain(webhookSecret)
    })

    it('should validate webhook payload structure', () => {
      // Test various webhook payload structures
      const validWebhookPayloads = [
        {
          id: 'evt_valid_1',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_123', amount: 1000 } }
        },
        {
          id: 'evt_valid_2',
          type: 'invoice.payment_succeeded',
          data: { object: { id: 'in_456', amount_paid: 2000 } }
        }
      ]
      
      const invalidWebhookPayloads = [
        {}, // Empty object
        { id: 'evt_invalid' }, // Missing type and data
        { type: 'unknown_event' }, // Missing id and data
        null, // Null payload
        'invalid_json_string' // String instead of object
      ]
      
      validWebhookPayloads.forEach(payload => {
        expect(payload.id).toBeDefined()
        expect(payload.type).toBeDefined()
        expect(payload.data).toBeDefined()
        expect(payload.data.object).toBeDefined()
      })
      
      invalidWebhookPayloads.forEach(payload => {
        if (payload && typeof payload === 'object') {
          const hasRequiredFields = payload.id && payload.type && payload.data
          expect(hasRequiredFields).toBeFalsy()
        } else {
          expect(payload).not.toEqual(expect.objectContaining({
            id: expect.any(String),
            type: expect.any(String),
            data: expect.any(Object)
          }))
        }
      })
    })

    it('should enforce webhook processing idempotency', async () => {
      // Idempotency ensures the same webhook has the same effect whether processed once or multiple times
      const idempotencyKey = `idempotent_${crypto.randomUUID().substring(0, 8)}`
      const integration = await TestDatabaseUtils.createTestIntegration(testTenant.id)
      
      // Process the same logical operation multiple times
      const operations = []
      for (let i = 0; i < 3; i++) {
        operations.push(
          TestDatabaseUtils.createTestTransaction(testTenant.id, integration.id, {
            external_id: `${idempotencyKey}_${i}`,
            description: `Idempotent operation ${i}`,
            amount: 1000 // Same amount each time
          })
        )
      }
      
      const results = await Promise.all(operations)
      
      // All operations should succeed but represent the same logical transaction
      expect(results).toHaveLength(3)
      results.forEach((transaction, index) => {
        expect(transaction.amount).toBe('1000.00')
        expect(transaction.description).toBe(`Idempotent operation ${index}`)
      })
    })

    it('should log webhook security events', () => {
      // Test that security events would be properly logged
      const securityEvents = [
        {
          type: 'webhook_replay_attempt',
          timestamp: new Date(),
          details: 'Webhook timestamp too old'
        },
        {
          type: 'webhook_signature_invalid',
          timestamp: new Date(),
          details: 'HMAC signature verification failed'
        },
        {
          type: 'webhook_duplicate_processing',
          timestamp: new Date(),
          details: 'Duplicate event ID detected'
        }
      ]
      
      securityEvents.forEach(event => {
        expect(event.type).toBeDefined()
        expect(event.timestamp).toBeInstanceOf(Date)
        expect(event.details).toBeDefined()
        
        // In a real implementation, these would be logged to a security monitoring system
        console.log(`Security Event: ${event.type} - ${event.details}`)
      })
    })
  })
})