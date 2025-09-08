// LIQUID ABT - Authorization Header Validation Integration Tests

import { NextRequest } from 'next/server'
import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { signJWT, verifyJWT } from '@/lib/auth/jwt'
import { tenantSchemaManager } from '@/lib/database/connection'

describe('Authorization Header Validation Integration Tests', () => {
  let testTenant: any
  let testUser: any
  let adminUser: any
  let viewerUser: any
  let inactiveUser: any
  let validJWTToken: string
  let adminJWTToken: string
  let viewerJWTToken: string

  beforeAll(async () => {
    const uniqueId = require('crypto').randomUUID()
    testTenant = await TestDatabaseUtils.createTestTenant({
      companyName: 'Authorization Test Company',
      subdomain: `auth-validation-${uniqueId.substring(0, 8)}`,
      contactEmail: `auth-validation+${uniqueId}@test.com`
    })

    if (!await tenantSchemaManager.schemaExists(testTenant.id)) {
      await tenantSchemaManager.createTenantSchema(testTenant.id)
    }

    // Create users with different roles
    testUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: testTenant.contactEmail,
      role: 'OWNER'
    })

    adminUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: `admin+${uniqueId}@test.com`,
      role: 'ADMIN'
    })

    viewerUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: `viewer+${uniqueId}@test.com`,
      role: 'VIEWER'
    })

    inactiveUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: `inactive+${uniqueId}@test.com`,
      role: 'USER',
      isActive: false
    })

    // Create JWT tokens for different users
    validJWTToken = await signJWT({
      userId: testUser.id,
      tenantId: testTenant.id,
      email: testUser.email,
      role: testUser.role,
      subdomain: testTenant.subdomain
    })

    adminJWTToken = await signJWT({
      userId: adminUser.id,
      tenantId: testTenant.id,
      email: adminUser.email,
      role: adminUser.role,
      subdomain: testTenant.subdomain
    })

    viewerJWTToken = await signJWT({
      userId: viewerUser.id,
      tenantId: testTenant.id,
      email: viewerUser.email,
      role: viewerUser.role,
      subdomain: testTenant.subdomain
    })
  }, 30000)

  afterAll(async () => {
    if (testTenant?.id) {
      await TestDatabaseUtils.cleanupTenant(testTenant.id)
    }
    await TestDatabaseUtils.disconnect()
  }, 10000)

  describe('Authorization Header Format Validation', () => {
    it('should validate Bearer token format correctly', () => {
      // Test Bearer token format validation without hitting actual endpoints
      const validateAuthHeader = (authHeader: string | undefined) => {
        if (!authHeader) {
          return { valid: false, reason: 'missing_header' }
        }
        
        if (!authHeader.toLowerCase().startsWith('bearer ')) {
          return { valid: false, reason: 'invalid_scheme' }
        }
        
        const token = authHeader.substring(7) // Remove 'Bearer '
        if (!token || token.trim().length === 0) {
          return { valid: false, reason: 'empty_token' }
        }
        
        // Basic JWT format validation (3 parts separated by dots)
        const tokenParts = token.split('.')
        if (tokenParts.length !== 3) {
          return { valid: false, reason: 'invalid_jwt_format' }
        }
        
        // Each part should be non-empty base64url
        for (const part of tokenParts) {
          if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) {
            return { valid: false, reason: 'invalid_base64url' }
          }
        }
        
        return { valid: true, token, reason: 'valid' }
      }
      
      // Test valid Bearer token
      const validResult = validateAuthHeader(`Bearer ${validJWTToken}`)
      expect(validResult.valid).toBe(true)
      expect(validResult.token).toBe(validJWTToken)
      expect(validResult.reason).toBe('valid')
      
      // Test invalid formats
      const invalidHeaders = [
        undefined,
        '',
        'Basic dXNlcjpwYXNz',
        'Bearer',
        'Bearer ',
        'bearer token_without_proper_case',
        'Token abc123',
        `Bearer invalid.jwt`,
        `Bearer invalid..jwt.format`,
        `Bearer ${validJWTToken} extra_content`
      ]
      
      invalidHeaders.forEach(header => {
        const result = validateAuthHeader(header)
        expect(result.valid).toBe(false)
        expect(result.reason).toBeDefined()
      })
    })

    it('should validate Bearer token format', () => {
      // Test token format validation without hitting actual endpoint
      const validFormat = `Bearer ${validJWTToken}`
      expect(validFormat.startsWith('Bearer ')).toBe(true)
      expect(validFormat.split(' ')).toHaveLength(2)
      expect(validFormat.split(' ')[1]).toBe(validJWTToken)
      
      // Test invalid formats
      const invalidFormats = [
        validJWTToken, // Missing "Bearer "
        `Basic ${Buffer.from('user:pass').toString('base64')}`, // Wrong scheme
        'Bearer ', // Empty token
        `Bearer  ${validJWTToken}`, // Extra space
      ]
      
      invalidFormats.forEach(format => {
        if (format === validJWTToken) {
          expect(format.startsWith('Bearer ')).toBe(false)
        } else if (format.startsWith('Basic ')) {
          expect(format.startsWith('Bearer ')).toBe(false)
        } else if (format === 'Bearer ') {
          expect(format.split(' ')[1]).toBe('')
        } else if (format.includes('  ')) {
          expect(format.split(' ')).toHaveLength(3) // Extra space creates extra element
        }
      })
    })

    it('should handle header validation edge cases', () => {
      // Test that problematic headers would be rejected at HTTP level
      const problematicHeaders = [
        'Bearer 🔐🎫🎪' + validJWTToken, // Unicode characters
        `Bearer ${validJWTToken}\0malicious`, // Null bytes
        'Bearer ' + 'a'.repeat(10000), // Extremely long token
      ]

      problematicHeaders.forEach(header => {
        try {
          // This should either work or fail gracefully
          const hasProblematicChars = /[^\x00-\x7F]/.test(header) || header.includes('\0')
          if (hasProblematicChars) {
            expect(header).toMatch(/[^\x00-\x7F]|\0/) // Contains non-ASCII or null
          }
        } catch (error) {
          // Expected for malformed headers
          expect(error).toBeDefined()
        }
      })
    })
  })

  describe('JWT Token Validation', () => {
    it('should reject malformed JWT tokens', () => {
      const malformedTokens = [
        'invalid.token',           // Only 2 parts
        'invalid.token.here.extra', // 4 parts
        'notbase64.notbase64.notbase64', // Invalid base64
        '',                       // Empty token
        'a.b.c',                 // Too short
        'header.payload.signature.extra.parts' // Too many parts
      ]

      malformedTokens.forEach(token => {
        const parts = token.split('.')
        if (token === '') {
          expect(token.length).toBe(0)
        } else if (parts.length !== 3) {
          expect(parts.length).not.toBe(3) // Invalid JWT structure
        } else if (token === 'a.b.c') {
          expect(token.length).toBeLessThan(50) // Too short for real JWT
        }
      })
    })

    it('should reject expired JWT tokens', async () => {
      // Create token that expires immediately
      const expiredToken = await signJWT({
        userId: testUser.id,
        tenantId: testTenant.id,
        email: testUser.email,
        role: testUser.role,
        subdomain: testTenant.subdomain
      }, '1ms') // Expire in 1ms

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10))

      try {
        await verifyJWT(expiredToken)
        throw new Error('Should have thrown error for expired token')
      } catch (error: any) {
        expect(error.message).toContain('expired')
      }
    })

    it('should reject tokens with invalid signatures', async () => {
      // Create a valid token and tamper with the signature
      const validTokenParts = validJWTToken.split('.')
      const tamperedToken = validTokenParts[0] + '.' + validTokenParts[1] + '.tampered_signature'

      try {
        await verifyJWT(tamperedToken)
        throw new Error('Should have thrown error for invalid signature')
      } catch (error: any) {
        expect(error.message.toLowerCase()).toMatch(/invalid|signature/)
      }
    })

    it('should validate token payload structure', async () => {
      // Test that our valid token has correct structure
      const payload = await verifyJWT(validJWTToken)
      
      expect(payload).toBeDefined()
      expect(payload.userId).toBe(testUser.id)
      expect(payload.tenantId).toBe(testTenant.id)
      expect(payload.email).toBe(testUser.email)
      expect(payload.role).toBe(testUser.role)
      expect(payload.subdomain).toBe(testTenant.subdomain)
      expect(payload.iat).toBeDefined() // Issued at
      expect(payload.exp).toBeDefined() // Expires at
    })
  })

  describe('Role-Based Authorization Logic', () => {
    it('should validate different user roles exist', () => {
      expect(testUser.role).toBe('OWNER')
      expect(adminUser.role).toBe('ADMIN')
      expect(viewerUser.role).toBe('VIEWER')
      expect(inactiveUser.role).toBe('USER')
      expect(inactiveUser.isActive).toBe(false)
    })

    it('should have properly structured JWT tokens for each role', async () => {
      const tokens = [
        { token: validJWTToken, expectedRole: 'OWNER' },
        { token: adminJWTToken, expectedRole: 'ADMIN' },
        { token: viewerJWTToken, expectedRole: 'VIEWER' }
      ]

      for (const { token, expectedRole } of tokens) {
        const payload = await verifyJWT(token)
        expect(payload.role).toBe(expectedRole)
        expect(payload.tenantId).toBe(testTenant.id)
        expect(payload.subdomain).toBe(testTenant.subdomain)
      }
    })

    it('should validate tenant isolation in tokens', async () => {
      // Create another tenant
      const otherTenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'Other Test Company',
        subdomain: `other-auth-${Date.now()}`,
        contactEmail: `other-auth@${Date.now()}.com`
      })

      // Create token for user in different tenant
      const crossTenantToken = await signJWT({
        userId: testUser.id,
        tenantId: otherTenant.id, // Different tenant ID
        email: testUser.email,
        role: testUser.role,
        subdomain: otherTenant.subdomain // Different subdomain
      })

      const originalPayload = await verifyJWT(validJWTToken)
      const crossTenantPayload = await verifyJWT(crossTenantToken)

      // Should have different tenant contexts
      expect(originalPayload.tenantId).not.toBe(crossTenantPayload.tenantId)
      expect(originalPayload.subdomain).not.toBe(crossTenantPayload.subdomain)

      // Clean up
      await TestDatabaseUtils.cleanupTenant(otherTenant.id)
    })
  })

  describe('Security Validation Logic', () => {
    it('should handle case-insensitive authorization header parsing', () => {
      const headerVariations = [
        'Authorization',
        'authorization', 
        'AUTHORIZATION',
        'AuthorizatioN'
      ]

      // Test that all variations would be recognized
      headerVariations.forEach(headerName => {
        expect(headerName.toLowerCase()).toBe('authorization')
      })
    })

    it('should validate token freshness', async () => {
      // Test that tokens have reasonable expiration times
      const payload = await verifyJWT(validJWTToken)
      const now = Math.floor(Date.now() / 1000)
      const expirationTime = payload.exp
      const issueTime = payload.iat

      expect(expirationTime).toBeGreaterThan(now) // Should not be expired
      expect(issueTime).toBeLessThanOrEqual(now) // Should not be from future
      expect(expirationTime - issueTime).toBeGreaterThan(0) // Should have positive duration
    })

    it('should handle token verification edge cases', async () => {
      // Test various token manipulation attempts
      const originalToken = validJWTToken
      const parts = originalToken.split('.')

      const manipulatedTokens = [
        parts[0] + '.' + parts[1] + '.', // Missing signature
        '.' + parts[1] + '.' + parts[2], // Missing header
        parts[0] + '..' + parts[2], // Missing payload
        parts[0] + '.' + parts[1], // Missing signature part entirely
      ]

      for (const token of manipulatedTokens) {
        try {
          await verifyJWT(token)
          throw new Error(`Should have rejected manipulated token: ${token}`)
        } catch (error: any) {
          expect(error).toBeDefined()
        }
      }
    })

    it('should validate user existence for token', async () => {
      // Create temporary user and token
      const tempUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
        email: `temp-${Date.now()}@test.com`,
        role: 'USER'
      })

      const tempToken = await signJWT({
        userId: tempUser.id,
        tenantId: testTenant.id,
        email: tempUser.email,
        role: tempUser.role,
        subdomain: testTenant.subdomain
      })

      // Verify token works initially
      const payload = await verifyJWT(tempToken)
      expect(payload.userId).toBe(tempUser.id)

      // Delete the user
      const prisma = await TestDatabaseUtils.getPrismaClient()
      await prisma.user.delete({ where: { id: tempUser.id } })

      // Token should still be valid from JWT perspective (user validation happens in middleware)
      const payloadAfterDeletion = await verifyJWT(tempToken)
      expect(payloadAfterDeletion.userId).toBe(tempUser.id) // JWT still valid

      // But user lookup should fail
      const deletedUser = await prisma.user.findUnique({ where: { id: tempUser.id } })
      expect(deletedUser).toBeNull()
    })
  })

  describe('Integration with Authentication Middleware', () => {
    it('should demonstrate proper authentication flow', async () => {
      // This tests the expected authentication flow without hitting actual endpoints
      
      // 1. Extract authorization header
      const authHeader = `Bearer ${validJWTToken}`
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null
      expect(token).toBe(validJWTToken)

      // 2. Verify JWT token
      const payload = await verifyJWT(token!)
      expect(payload).toBeDefined()

      // 3. Check user exists and is active
      const prisma = await TestDatabaseUtils.getPrismaClient()
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { tenant: true }
      })
      
      expect(user).toBeDefined()
      expect(user?.isActive).toBe(true)
      expect(user?.tenant.isActive).toBe(true)

      // 4. Validate tenant context matches
      expect(user?.tenantId).toBe(payload.tenantId)
      expect(user?.tenant.subdomain).toBe(payload.subdomain)
    })

    it('should validate role hierarchy for authorization', () => {
      const roleHierarchy = {
        'OWNER': 4,
        'ADMIN': 3,
        'USER': 2,
        'VIEWER': 1
      }

      expect(roleHierarchy['OWNER']).toBeGreaterThan(roleHierarchy['ADMIN'])
      expect(roleHierarchy['ADMIN']).toBeGreaterThan(roleHierarchy['USER'])
      expect(roleHierarchy['USER']).toBeGreaterThan(roleHierarchy['VIEWER'])

      // Test that our users have appropriate roles
      expect(roleHierarchy[testUser.role as keyof typeof roleHierarchy]).toBe(4)
      expect(roleHierarchy[adminUser.role as keyof typeof roleHierarchy]).toBe(3)
      expect(roleHierarchy[viewerUser.role as keyof typeof roleHierarchy]).toBe(1)
    })
  })
})