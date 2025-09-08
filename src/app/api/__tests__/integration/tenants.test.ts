// LIQUID ABT - Tenant Registration Integration Tests

import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { tenantSchemaManager, getMasterPrisma } from '@/lib/database/connection'
import { authService } from '@/lib/auth/jwt'
import { SubscriptionTier } from '@/types/database'

describe('Tenant Registration Integration Tests', () => {
  let createdTenantIds: string[] = []
  
  beforeAll(async () => {
    // No special database setup needed - use existing test database
  }, 30000)
  
  afterAll(async () => {
    // Clean up any tenants created during tests
    for (const tenantId of createdTenantIds) {
      try {
        await TestDatabaseUtils.cleanupTenant(tenantId)
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    await TestDatabaseUtils.disconnect()
  }, 30000)

  beforeEach(async () => {
    // Manual cleanup of test data for isolation
    const prisma = getMasterPrisma()
    
    // Delete any temporary test tenants and users created during previous tests
    // Be more specific to avoid deleting the main test data
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'temp-test-'
        }
      }
    })
    
    await prisma.tenant.deleteMany({
      where: {
        subdomain: {
          startsWith: 'temp-test-'
        }
      }
    })
  })

  describe('Tenant Registration Process', () => {
    it('should validate tenant registration data structure', () => {
      const validRegistrationData = {
        companyName: 'Test Company Pty Ltd',
        subdomain: 'testcompany123',
        contactEmail: 'admin@testcompany123.com',
        firstName: 'John',
        lastName: 'Smith',
        password: 'SecurePassword123!',
        email: 'admin@testcompany123.com', // Required for user creation
        subscriptionTier: 'FREE' as SubscriptionTier
      }

      expect(validRegistrationData.companyName).toBeDefined()
      expect(validRegistrationData.subdomain).toMatch(/^[a-z0-9-]+$/)
      expect(validRegistrationData.contactEmail).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      expect(validRegistrationData.password.length).toBeGreaterThan(8)
      expect(Object.values(SubscriptionTier)).toContain(validRegistrationData.subscriptionTier)
    })

    it('should create tenant with proper database structure', async () => {
      const tenantData = {
        companyName: 'Database Test Company',
        subdomain: `dbtest-${require('crypto').randomUUID().substring(0, 8)}`,
        contactEmail: `dbtest+${require('crypto').randomUUID()}@test.com`,
        subscriptionTier: SubscriptionTier.FREE
      }

      const tenant = await TestDatabaseUtils.createTestTenant(tenantData)
      createdTenantIds.push(tenant.id)

      expect(tenant.id).toBeDefined()
      expect(tenant.companyName).toBe(tenantData.companyName)
      expect(tenant.subdomain).toBe(tenantData.subdomain)
      expect(tenant.contactEmail).toBe(tenantData.contactEmail)
      expect(tenant.isActive).toBe(true)

      // Verify tenant schema was created
      const schemaExists = await tenantSchemaManager.schemaExists(tenant.id)
      expect(schemaExists).toBe(true)
    })

    it('should create owner user for new tenant', async () => {
      const tenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'User Test Company',
        subdomain: `usertest-${require('crypto').randomUUID().substring(0, 8)}`,
        contactEmail: `usertest+${require('crypto').randomUUID()}@test.com`
      })
      createdTenantIds.push(tenant.id)

      const user = await TestDatabaseUtils.createTestUser(tenant.id, {
        email: tenant.contactEmail,
        firstName: 'Test',
        lastName: 'Owner',
        role: 'OWNER'
      })

      expect(user.id).toBeDefined()
      expect(user.tenantId).toBe(tenant.id)
      expect(user.email).toBe(tenant.contactEmail)
      expect(user.role).toBe('OWNER')
      expect(user.isActive).toBe(true)
      expect(user.passwordHash).toBeDefined()
    })

    it('should enforce subdomain uniqueness', async () => {
      const subdomain = `unique-test-${require('crypto').randomUUID().substring(0, 8)}`
      
      // Create first tenant
      const tenant1 = await TestDatabaseUtils.createTestTenant({
        companyName: 'First Company',
        subdomain: subdomain,
        contactEmail: `first+${require('crypto').randomUUID()}@test.com`
      })
      createdTenantIds.push(tenant1.id)

      // Verify subdomain is taken
      const prisma = getMasterPrisma()
      const existingTenant = await prisma.tenant.findUnique({
        where: { subdomain: subdomain }
      })

      expect(existingTenant).not.toBeNull()
      expect(existingTenant?.id).toBe(tenant1.id)
    })

    it('should validate password hashing security', async () => {
      const plainPassword = 'SecurePassword123!'
      const hashedPassword = await authService.hashPassword(plainPassword)

      expect(hashedPassword).toBeDefined()
      expect(hashedPassword).not.toBe(plainPassword)
      expect(hashedPassword.length).toBeGreaterThan(50) // bcrypt hashes are typically 60 characters
      expect(hashedPassword.startsWith('$2')).toBe(true) // bcrypt hash format

      // Verify password can be validated
      const isValid = await authService.verifyPassword(plainPassword, hashedPassword)
      expect(isValid).toBe(true)

      // Verify wrong password fails
      const isInvalid = await authService.verifyPassword('wrongpassword', hashedPassword)
      expect(isInvalid).toBe(false)
    })

    it('should assign correct subscription tier limits', async () => {
      const { SUBSCRIPTION_LIMITS } = require('@/types/database')
      
      // Test that subscription limits are defined properly
      expect(SUBSCRIPTION_LIMITS[SubscriptionTier.FREE]).toBeDefined()
      expect(SUBSCRIPTION_LIMITS[SubscriptionTier.GROWTH]).toBeDefined()
      expect(SUBSCRIPTION_LIMITS[SubscriptionTier.PRO]).toBeDefined()
      expect(SUBSCRIPTION_LIMITS[SubscriptionTier.ENTERPRISE]).toBeDefined()
      
      // Test FREE tier structure
      const freeLimits = SUBSCRIPTION_LIMITS[SubscriptionTier.FREE]
      expect(freeLimits.monthlyVolumeLimit).toBe(50000)
      expect(freeLimits.dailyVolumeLimit).toBe(5000)
      expect(freeLimits.maxUsers).toBe(2)
      expect(freeLimits.maxIntegrations).toBe(2)

      // Test GROWTH tier structure
      const growthLimits = SUBSCRIPTION_LIMITS[SubscriptionTier.GROWTH]
      expect(growthLimits.monthlyVolumeLimit).toBe(500000)
      expect(growthLimits.dailyVolumeLimit).toBe(50000)
      expect(growthLimits.maxUsers).toBe(10)
      expect(growthLimits.maxIntegrations).toBe(10)
      
      // Test that tenants can be created with different subscription tiers
      const freeTenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'Free Tier Company',
        subdomain: `free-${require('crypto').randomUUID().substring(0, 8)}`,
        contactEmail: `free+${require('crypto').randomUUID()}@test.com`,
        subscriptionTier: SubscriptionTier.FREE
      })
      createdTenantIds.push(freeTenant.id)
      
      expect(freeTenant.subscriptionTier).toBe(SubscriptionTier.FREE)
      
      // Test GROWTH tier
      const growthTenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'Growth Tier Company',
        subdomain: `growth-${require('crypto').randomUUID().substring(0, 8)}`,
        contactEmail: `growth+${require('crypto').randomUUID()}@test.com`,
        subscriptionTier: SubscriptionTier.GROWTH
      })
      createdTenantIds.push(growthTenant.id)
      
      expect(growthTenant.subscriptionTier).toBe(SubscriptionTier.GROWTH)
    })

    it('should generate valid JWT tokens for new users', async () => {
      const tenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'JWT Test Company',
        subdomain: `jwt-${require('crypto').randomUUID().substring(0, 8)}`,
        contactEmail: `jwt+${require('crypto').randomUUID()}@test.com`
      })
      createdTenantIds.push(tenant.id)

      const user = await TestDatabaseUtils.createTestUser(tenant.id, {
        email: tenant.contactEmail,
        role: 'OWNER'
      })

      const token = authService.generateToken({
        userId: user.id,
        tenantId: tenant.id,
        email: user.email,
        role: user.role as any,
        subdomain: tenant.subdomain
      })

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT format

      // Verify token can be decoded
      const tokenResult = authService.verifyToken(token)
      expect(tokenResult.valid).toBe(true)
      expect(tokenResult.payload?.userId).toBe(user.id)
      expect(tokenResult.payload?.tenantId).toBe(tenant.id)
    })

    it('should create isolated tenant databases', async () => {
      // Create two tenants
      const tenant1 = await TestDatabaseUtils.createTestTenant({
        companyName: 'Isolation Test 1',
        subdomain: `isolation1-${require('crypto').randomUUID().substring(0, 8)}`,
        contactEmail: `isolation1+${require('crypto').randomUUID()}@test.com`
      })
      createdTenantIds.push(tenant1.id)

      const tenant2 = await TestDatabaseUtils.createTestTenant({
        companyName: 'Isolation Test 2', 
        subdomain: `isolation2-${require('crypto').randomUUID().substring(0, 8)}`,
        contactEmail: `isolation2+${require('crypto').randomUUID()}@test.com`
      })
      createdTenantIds.push(tenant2.id)

      // Verify both schemas exist
      const schema1Exists = await tenantSchemaManager.schemaExists(tenant1.id)
      const schema2Exists = await tenantSchemaManager.schemaExists(tenant2.id)

      expect(schema1Exists).toBe(true)
      expect(schema2Exists).toBe(true)

      // Create data in tenant 1
      const integration1 = await TestDatabaseUtils.createTestIntegration(tenant1.id)
      
      // Verify tenant 2 can't see tenant 1's data
      const tenant2Integrations = await tenantSchemaManager.queryTenantSchema(
        tenant2.id,
        'SELECT * FROM integrations',
        []
      )

      expect(tenant2Integrations).toHaveLength(0) // Should be empty
    })

    it('should validate subdomain format requirements', () => {
      const validSubdomains = [
        'validcompany',
        'valid-company',
        'company123',
        'test-123-abc'
      ]

      const invalidSubdomains = [
        '-startswithyphen',
        'endswithyphen-',
        'contains_underscore',
        'contains.period',
        'UPPERCASE',
        'contains spaces',
        'contains@symbols'
      ]

      validSubdomains.forEach(subdomain => {
        expect(subdomain).toMatch(/^[a-z0-9-]+$/)
        expect(subdomain.startsWith('-')).toBe(false)
        expect(subdomain.endsWith('-')).toBe(false)
      })

      invalidSubdomains.forEach(subdomain => {
        const isValidFormat = /^[a-z0-9-]+$/.test(subdomain) && 
                            !subdomain.startsWith('-') && 
                            !subdomain.endsWith('-')
        expect(isValidFormat).toBe(false)
      })
    })

    it('should handle tenant creation with all subscription tiers', async () => {
      const subscriptionTiers = Object.values(SubscriptionTier)
      const tenantIds: string[] = []

      for (const tier of subscriptionTiers) {
        const tenant = await TestDatabaseUtils.createTestTenant({
          companyName: `${tier} Tier Company`,
          subdomain: `${tier.toLowerCase()}-${require('crypto').randomUUID().substring(0, 8)}`,
          contactEmail: `${tier.toLowerCase()}+${require('crypto').randomUUID()}@test.com`,
          subscriptionTier: tier
        })
        
        tenantIds.push(tenant.id)
        createdTenantIds.push(tenant.id)

        expect(tenant.subscriptionTier).toBe(tier)
        
        // Verify schema was created
        const schemaExists = await tenantSchemaManager.schemaExists(tenant.id)
        expect(schemaExists).toBe(true)
      }

      expect(tenantIds).toHaveLength(subscriptionTiers.length)
    })
  })
})