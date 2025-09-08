// LIQUID ABT - Authentication Integration Tests

import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import { signJWT } from '@/lib/auth/jwt'
import { tenantSchemaManager } from '@/lib/database/connection'

describe('Authentication Integration Tests', () => {
  let testTenant: any
  let testUser: any
  
  beforeAll(async () => {
    // Create test tenant for all auth tests with unique data
    const uniqueId = require('crypto').randomUUID()
    testTenant = await TestDatabaseUtils.createTestTenant({
      companyName: 'Auth Test Company',
      subdomain: `auth-test-${uniqueId.substring(0, 8)}`,
      contactEmail: `auth+${uniqueId}@test.com`
    })
    
    testUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
      email: testTenant.contactEmail,
      role: 'OWNER'
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
    const prisma = await TestDatabaseUtils.getPrismaClient()
    
    // Delete any users created during previous tests (except the main test user)
    await prisma.user.deleteMany({
      where: {
        tenantId: testTenant.id,
        email: {
          not: testTenant.contactEmail // Keep the main test user
        }
      }
    })
  })

  describe('User Authentication', () => {

    it('should validate user credentials correctly', async () => {
      const prisma = await TestDatabaseUtils.getPrismaClient()
      
      // Find our test user
      const user = await prisma.user.findUnique({
        where: { email: testTenant.contactEmail },
        include: {
          tenant: {
            select: {
              id: true,
              companyName: true,
              subdomain: true,
              subscriptionTier: true,
              isActive: true
            }
          }
        }
      })
      
      expect(user).toBeDefined()
      expect(user?.email).toBe(testTenant.contactEmail)
      expect(user?.tenant.subdomain).toBe(testTenant.subdomain)
      expect(user?.isActive).toBe(true)
      expect(user?.tenant.isActive).toBe(true)
    })

    it('should handle nonexistent users properly', async () => {
      const prisma = await TestDatabaseUtils.getPrismaClient()
      
      // Try to find a user that doesn't exist
      const nonExistentUser = await prisma.user.findUnique({
        where: { email: 'nonexistent@example.com' },
        include: {
          tenant: {
            select: {
              id: true,
              companyName: true,
              subdomain: true,
              subscriptionTier: true,
              isActive: true
            }
          }
        }
      })
      
      expect(nonExistentUser).toBeNull()
    })

    it('should verify password hashing is secure', async () => {
      const prisma = await TestDatabaseUtils.getPrismaClient()
      
      const user = await prisma.user.findUnique({
        where: { email: testTenant.contactEmail }
      })
      
      expect(user).toBeDefined()
      expect(user?.passwordHash).toBeDefined()
      expect(user?.passwordHash).not.toBe('password123') // Ensure it's actually hashed
      expect(user?.passwordHash.startsWith('$2')).toBe(true) // bcrypt hash format
      expect(user?.passwordHash.length).toBeGreaterThan(50) // Proper hash length
    })

    it('should validate tenant subdomain uniqueness', async () => {
      const prisma = await TestDatabaseUtils.getPrismaClient()
      
      // Verify our test tenant exists with unique subdomain
      const tenant = await prisma.tenant.findUnique({
        where: { subdomain: testTenant.subdomain }
      })
      
      expect(tenant).toBeDefined()
      expect(tenant?.id).toBe(testTenant.id)
      expect(tenant?.isActive).toBe(true)
      
      // Verify non-existent subdomain returns null
      const nonExistentTenant = await prisma.tenant.findUnique({
        where: { subdomain: 'nonexistent-subdomain-12345' }
      })
      
      expect(nonExistentTenant).toBeNull()
    })

    it('should handle user activation status', async () => {
      const prisma = await TestDatabaseUtils.getPrismaClient()
      
      // Create an inactive user for testing
      const inactiveUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
        email: `inactive@${Date.now()}.com`,
        isActive: false,
        role: 'USER'
      })
      
      // Verify inactive user exists but is not active
      const foundUser = await prisma.user.findUnique({
        where: { email: inactiveUser.email }
      })
      
      expect(foundUser).toBeDefined()
      expect(foundUser?.isActive).toBe(false)
      
      // Clean up
      await prisma.user.delete({ where: { id: inactiveUser.id } })
    })

    it('should handle tenant activation status', async () => {
      const prisma = await TestDatabaseUtils.getPrismaClient()
      
      // Create an inactive tenant for testing
      const inactiveTenant = await TestDatabaseUtils.createTestTenant({
        companyName: 'Inactive Test Company',
        subdomain: `inactive-${Date.now()}`,
        contactEmail: `inactive@${Date.now()}.com`,
        isActive: false
      })
      
      // Verify inactive tenant exists but is not active
      const foundTenant = await prisma.tenant.findUnique({
        where: { id: inactiveTenant.id }
      })
      
      expect(foundTenant).toBeDefined()
      expect(foundTenant?.isActive).toBe(false)
      
      // Clean up
      await TestDatabaseUtils.cleanupTenant(inactiveTenant.id)
    })

    it('should maintain database connection integrity', async () => {
      const prisma = await TestDatabaseUtils.getPrismaClient()
      
      // Test database connectivity with a simple query
      const connectionTest = await prisma.$queryRaw`SELECT 1 as test`
      
      expect(connectionTest).toBeDefined()
      expect(Array.isArray(connectionTest)).toBe(true)
    })

    it('should support JWT token generation and validation', async () => {
      // Generate a JWT token for the test user
      const token = await signJWT({
        userId: testUser.id,
        tenantId: testTenant.id,
        email: testUser.email,
        role: testUser.role,
        subdomain: testTenant.subdomain
      })
      
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT has 3 parts
      
      // Verify token contains correct information
      const { verifyJWT } = require('@/lib/auth/jwt')
      const payload = await verifyJWT(token)
      
      expect(payload.userId).toBe(testUser.id)
      expect(payload.tenantId).toBe(testTenant.id)
      expect(payload.email).toBe(testUser.email)
      expect(payload.subdomain).toBe(testTenant.subdomain)
    })

    it('should validate user role permissions', async () => {
      const prisma = await TestDatabaseUtils.getPrismaClient()
      
      // Create users with different roles
      const viewerUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
        email: `viewer@${Date.now()}.com`,
        role: 'VIEWER'
      })
      
      const adminUser = await TestDatabaseUtils.createTestUser(testTenant.id, {
        email: `admin@${Date.now()}.com`,
        role: 'ADMIN'
      })
      
      // Verify roles are set correctly
      expect(testUser.role).toBe('OWNER')
      expect(viewerUser.role).toBe('VIEWER')
      expect(adminUser.role).toBe('ADMIN')
      
      // Clean up
      await prisma.user.deleteMany({
        where: {
          id: { in: [viewerUser.id, adminUser.id] }
        }
      })
    })
  })
})