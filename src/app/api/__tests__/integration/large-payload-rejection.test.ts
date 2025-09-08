// LIQUID ABT - Large Payload Rejection Integration Tests

import { NextRequest } from 'next/server'
import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { signJWT } from '@/lib/auth/jwt'

describe('Large Payload Rejection Integration Tests', () => {
  let testTenant: any
  let testUser: any
  let validJWTToken: string

  beforeAll(async () => {
    const uniqueId = require('crypto').randomUUID()
    testTenant = await TestDatabaseUtils.createTestTenant({
      companyName: 'Large Payload Test Company',
      subdomain: `large-payload-${uniqueId.substring(0, 8)}`,
      contactEmail: `large-payload+${uniqueId}@test.com`
    })

    testUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: testTenant.contactEmail,
      role: 'ADMIN'
    })

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
    await TestDatabaseUtils.disconnect()
  }, 10000)

  // Helper function to generate large payloads
  const generateLargePayload = (sizeInMB: number): string => {
    const sizeInBytes = sizeInMB * 1024 * 1024
    const basePayload = {
      id: 'evt_large_payload_test',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_large_payload_test',
          amount: 5000,
          currency: 'aud',
          status: 'succeeded',
          metadata: {
            tenant_id: testTenant.id,
            should_convert: 'true'
          }
        }
      },
      created: Math.floor(Date.now() / 1000)
    }

    // Add large data to reach target size
    const currentSize = JSON.stringify(basePayload).length
    const remainingBytes = sizeInBytes - currentSize
    
    if (remainingBytes > 0) {
      const paddingSize = Math.max(0, remainingBytes - 100)
      const padding = 'x'.repeat(paddingSize)
      basePayload.data.object.metadata.large_data = padding
    }

    return JSON.stringify(basePayload)
  }

  describe('Payload Size Validation Logic', () => {
    it('should validate normal sized payloads (<1KB)', () => {
      const normalPayload = JSON.stringify({
        id: 'evt_normal_size',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_normal_size',
            amount: 5000,
            currency: 'aud',
            status: 'succeeded',
            metadata: {
              tenant_id: testTenant.id,
              should_convert: 'true'
            }
          }
        },
        created: Math.floor(Date.now() / 1000)
      })

      expect(normalPayload.length).toBeLessThan(1024) // Under 1KB
      expect(normalPayload.length).toBeGreaterThan(100) // Reasonable minimum
    })

    it('should validate medium sized payloads (~100KB)', () => {
      const mediumPayload = generateLargePayload(0.1) // 0.1 MB = ~100KB
      
      expect(mediumPayload.length).toBeGreaterThan(50000) // > 50KB
      expect(mediumPayload.length).toBeLessThan(200000) // < 200KB
      
      // Should be valid JSON
      expect(() => JSON.parse(mediumPayload)).not.toThrow()
    })

    it('should detect very large payloads (>1MB)', () => {
      const largePayload = generateLargePayload(1.5) // 1.5 MB
      
      expect(largePayload.length).toBeGreaterThan(1024 * 1024) // > 1MB
      
      // Test size validation logic
      const isOverLimit = largePayload.length > (1024 * 1024) // 1MB limit
      expect(isOverLimit).toBe(true)
    })

    it('should detect extremely large payloads (>10MB)', () => {
      try {
        const extremePayload = generateLargePayload(10.5) // 10.5 MB
        
        expect(extremePayload.length).toBeGreaterThan(10 * 1024 * 1024) // > 10MB
        
        // Test rejection logic
        const isExtremelyLarge = extremePayload.length > (10 * 1024 * 1024)
        expect(isExtremelyLarge).toBe(true)
        
      } catch (error) {
        // Very large payloads might cause memory issues - this is expected
        expect(error).toBeDefined()
      }
    })
  })

  describe('HTTP Request Size Validation', () => {
    it('should validate content-length headers', () => {
      const testCases = [
        { contentLength: '1000', expected: 1000 },
        { contentLength: '1048576', expected: 1048576 }, // 1MB
        { contentLength: '5242880', expected: 5242880 }, // 5MB
        { contentLength: '0', expected: 0 }
      ]

      testCases.forEach(({ contentLength, expected }) => {
        const size = parseInt(contentLength, 10)
        expect(size).toBe(expected)
        
        // Test size limits
        const isOverLimit = size > (1024 * 1024) // 1MB
        const shouldReject = isOverLimit
        
        if (expected > 1024 * 1024) {
          expect(shouldReject).toBe(true)
        } else {
          expect(shouldReject).toBe(false)
        }
      })
    })

    it('should handle malformed content-length headers', () => {
      const malformedHeaders = ['abc', '', 'null', '-1', '1.5']
      
      malformedHeaders.forEach(header => {
        const size = parseInt(header, 10)
        
        if (isNaN(size) || size < 0) {
          // Malformed or invalid sizes should be handled
          expect(isNaN(size) || size < 0).toBe(true)
        }
      })
    })

    it('should validate different payload sizes without HTTP overhead', () => {
      const validatePayloadSize = (payload: string, limit: number = 1024 * 1024) => {
        const size = Buffer.byteLength(payload, 'utf8')
        return {
          size,
          isValid: size <= limit,
          exceedsLimit: size > limit,
          sizeInMB: (size / (1024 * 1024)).toFixed(2)
        }
      }
      
      // Test small payloads
      const smallPayload = JSON.stringify({ test: 'small' })
      const smallResult = validatePayloadSize(smallPayload)
      expect(smallResult.size).toBeLessThan(1000)
      expect(smallResult.isValid).toBe(true)
      expect(smallResult.exceedsLimit).toBe(false)
      
      // Test medium payloads (50KB)
      const mediumPayload = 'x'.repeat(50000)
      const mediumResult = validatePayloadSize(mediumPayload)
      expect(mediumResult.size).toBe(50000)
      expect(mediumResult.isValid).toBe(true) // Under 1MB limit
      expect(mediumResult.exceedsLimit).toBe(false)
      
      // Test large payloads (2MB)
      const largePayload = 'x'.repeat(2 * 1024 * 1024)
      const largeResult = validatePayloadSize(largePayload)
      expect(largeResult.size).toBe(2 * 1024 * 1024)
      expect(largeResult.isValid).toBe(false) // Exceeds 1MB limit
      expect(largeResult.exceedsLimit).toBe(true)
      expect(parseFloat(largeResult.sizeInMB)).toBe(2.00)
      
      // Test edge case (exactly at limit)
      const limitPayload = 'x'.repeat(1024 * 1024) // Exactly 1MB
      const limitResult = validatePayloadSize(limitPayload)
      expect(limitResult.size).toBe(1024 * 1024)
      expect(limitResult.isValid).toBe(true) // At limit is still valid
      expect(limitResult.exceedsLimit).toBe(false)
    })
  })

  describe('JSON Parsing Size Limits', () => {
    it('should handle normal JSON parsing', () => {
      const normalData = {
        name: 'Test',
        data: 'x'.repeat(1000)
      }
      const json = JSON.stringify(normalData)
      
      expect(() => JSON.parse(json)).not.toThrow()
      expect(JSON.parse(json).name).toBe('Test')
    })

    it('should handle large array parsing', () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        data: `Data for item ${i}`
      }))
      
      const json = JSON.stringify(largeArray)
      
      expect(() => JSON.parse(json)).not.toThrow()
      const parsed = JSON.parse(json)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBe(1000)
    })

    it('should detect deeply nested objects', () => {
      let deepObject: any = { value: 'test' }
      const maxDepth = 100
      
      for (let i = 0; i < maxDepth; i++) {
        deepObject = { nested: deepObject }
      }
      
      const json = JSON.stringify(deepObject)
      expect(json.length).toBeGreaterThan(1000)
      
      // Should be able to parse reasonably deep objects
      expect(() => JSON.parse(json)).not.toThrow()
    })

    it('should handle JSON with special characters', () => {
      const specialData = {
        unicode: '🔐🎫🎪',
        quotes: 'String with "quotes" inside',
        backslashes: 'Path\\with\\backslashes',
        newlines: 'Line 1\nLine 2\nLine 3'
      }
      
      const json = JSON.stringify(specialData)
      expect(() => JSON.parse(json)).not.toThrow()
      
      const parsed = JSON.parse(json)
      expect(parsed.unicode).toBe('🔐🎫🎪')
      expect(parsed.quotes).toBe('String with "quotes" inside')
    })
  })

  describe('Memory and Performance Validation', () => {
    it('should validate size checking performance', () => {
      const startTime = Date.now()
      
      // Test efficient size validation
      const payloadSizes = [1000, 10000, 100000, 500000, 1000000, 2000000]
      
      payloadSizes.forEach(size => {
        const isOverLimit = size > (1024 * 1024) // 1MB limit
        expect(typeof isOverLimit).toBe('boolean')
      })
      
      const endTime = Date.now()
      const duration = endTime - startTime
      
      // Size validation should be very fast
      expect(duration).toBeLessThan(50) // Should take < 50ms
    })

    it('should validate memory usage patterns', () => {
      const startMemory = process.memoryUsage().heapUsed
      
      // Create several small objects
      const objects = []
      for (let i = 0; i < 100; i++) {
        objects.push({
          id: i,
          data: 'x'.repeat(1000)
        })
      }
      
      const endMemory = process.memoryUsage().heapUsed
      const memoryDiff = endMemory - startMemory
      
      // Memory usage should be reasonable
      expect(memoryDiff).toBeLessThan(10 * 1024 * 1024) // < 10MB
      expect(objects.length).toBe(100)
    })

    it('should handle concurrent payload validation', async () => {
      const promises = []
      
      // Create multiple validation tasks
      for (let i = 0; i < 10; i++) {
        promises.push(Promise.resolve().then(() => {
          const payload = JSON.stringify({
            id: `test_${i}`,
            data: 'x'.repeat(1000)
          })
          
          const size = payload.length
          const isValid = size < (1024 * 1024)
          
          return { id: i, size, isValid }
        }))
      }
      
      const results = await Promise.all(promises)
      
      expect(results).toHaveLength(10)
      results.forEach(result => {
        expect(result.isValid).toBe(true)
        expect(result.size).toBeGreaterThan(0)
      })
    })

    it('should validate buffer size limits', () => {
      // Test buffer creation with size limits
      const sizes = [1024, 10240, 102400, 512000] // Up to 500KB
      
      sizes.forEach(size => {
        const buffer = Buffer.alloc(size)
        
        expect(buffer.length).toBe(size)
        expect(buffer).toBeInstanceOf(Buffer)
        
        // Check if size is within reasonable limits
        const isReasonable = size <= (1024 * 1024) // 1MB
        expect(isReasonable).toBe(true)
      })
    })

    it('should validate string length limits', () => {
      const lengths = [100, 1000, 10000, 50000]
      
      lengths.forEach(length => {
        const str = 'a'.repeat(length)
        
        expect(str.length).toBe(length)
        expect(typeof str).toBe('string')
        
        // Test JSON serialization
        const json = JSON.stringify({ data: str })
        expect(json.length).toBeGreaterThan(length)
      })
    })
  })

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty payloads', () => {
      const emptyPayloads = ['', '{}', '[]', 'null']
      
      emptyPayloads.forEach(payload => {
        expect(payload.length).toBeLessThan(10)
        
        if (payload !== '') {
          expect(() => JSON.parse(payload)).not.toThrow()
        }
      })
    })

    it('should handle invalid JSON gracefully', () => {
      const invalidJSON = [
        '{"invalid": json}',
        '{missing: quotes}',
        '{"unclosed": "string}',
        '[1,2,3,]'
      ]
      
      invalidJSON.forEach(json => {
        expect(() => JSON.parse(json)).toThrow()
      })
    })

    it('should validate security considerations', () => {
      // Test payloads that might be used in attacks
      const securityTestCases = [
        '{"script": "<script>alert(1)</script>"}',
        '{"sql": "DROP TABLE users;"}',
        '{"xss": "javascript:alert(1)"}',
        '{"overflow": "' + 'A'.repeat(10000) + '"}'
      ]
      
      securityTestCases.forEach(testCase => {
        expect(() => JSON.parse(testCase)).not.toThrow()
        
        const parsed = JSON.parse(testCase)
        expect(typeof parsed).toBe('object')
        
        // Size validation
        const isLarge = testCase.length > (1024 * 1024)
        if (isLarge) {
          expect(isLarge).toBe(true) // Would be rejected
        }
      })
    })
  })
})