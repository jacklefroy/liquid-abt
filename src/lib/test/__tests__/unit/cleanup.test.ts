// LIQUID ABT - Database Cleanup Test

import { TestDatabaseUtils } from '../../../../../__tests__/utils/database'

describe('Database Cleanup', () => {
  beforeAll(async () => {
    // Clean up any existing test data before starting
    await TestDatabaseUtils.cleanup()
  })

  afterAll(async () => {
    // Clean up test data after completion
    await TestDatabaseUtils.cleanup()
    await TestDatabaseUtils.disconnect()
  })

  it('should clean up all test data properly', async () => {
    // Create a test tenant with full data chain
    const tenant = await TestDatabaseUtils.createTestTenant()
    
    // Create a test user
    const user = await TestDatabaseUtils.createTestUser(tenant.id)
    
    // Create complete test data chain
    const testData = await TestDatabaseUtils.createCompleteTestData(tenant.id)
    
    // Verify data was created
    expect(tenant).toBeDefined()
    expect(user).toBeDefined()
    expect(testData.integration).toBeDefined()
    expect(testData.treasuryRule).toBeDefined()
    expect(testData.transaction).toBeDefined()
    expect(testData.bitcoinPurchase).toBeDefined()
    expect(testData.bitcoinWithdrawal).toBeDefined()
    expect(testData.processingFailure).toBeDefined()
    
    // Run cleanup
    await TestDatabaseUtils.cleanupTenant(tenant.id)
    
    // Verify tenant was removed from master database
    const prisma = await TestDatabaseUtils.getPrismaClient()
    const tenantAfterCleanup = await prisma.tenant.findUnique({
      where: { id: tenant.id }
    })
    expect(tenantAfterCleanup).toBeNull()
    
    // Verify user was removed
    const userAfterCleanup = await prisma.user.findUnique({
      where: { id: user.id }
    })
    expect(userAfterCleanup).toBeNull()
  })

  it('should handle cleanup when tenant schema does not exist', async () => {
    // Create a tenant record without schema
    const tenant = await TestDatabaseUtils.createTestTenant()
    
    // Delete the tenant record from master but leave schema reference
    const prisma = await TestDatabaseUtils.getPrismaClient()
    await prisma.tenant.delete({ where: { id: tenant.id } })
    
    // Cleanup should not throw errors
    await expect(TestDatabaseUtils.cleanupTenant(tenant.id)).resolves.not.toThrow()
  })

  it('should clean up orphaned test schemas', async () => {
    // This test verifies the orphaned schema cleanup functionality
    await expect(TestDatabaseUtils.cleanupOrphanedSchemas()).resolves.not.toThrow()
  })

  it('should handle force cleanup when normal cleanup fails', async () => {
    // Create a tenant
    const tenant = await TestDatabaseUtils.createTestTenant()
    
    // Force cleanup should work
    await expect(TestDatabaseUtils.forceCleanupTenant(tenant.id)).resolves.not.toThrow()
    
    // Verify tenant was removed
    const prisma = await TestDatabaseUtils.getPrismaClient()
    const tenantAfterCleanup = await prisma.tenant.findUnique({
      where: { id: tenant.id }
    })
    expect(tenantAfterCleanup).toBeNull()
  })

  it('should clean up all test tenants in global cleanup', async () => {
    // Create multiple test tenants
    const tenant1 = await TestDatabaseUtils.createTestTenant({
      companyName: 'Test Company 1',
      subdomain: 'test-cleanup-1'
    })
    
    const tenant2 = await TestDatabaseUtils.createTestTenant({
      companyName: 'Test Company 2',
      subdomain: 'test-cleanup-2'
    })
    
    // Create some test data for each
    await TestDatabaseUtils.createTestUser(tenant1.id)
    await TestDatabaseUtils.createTestUser(tenant2.id)
    
    // Run global cleanup
    await TestDatabaseUtils.cleanup()
    
    // Verify all test tenants were removed
    const prisma = await TestDatabaseUtils.getPrismaClient()
    const remainingTenants = await prisma.tenant.findMany({
      where: {
        OR: [
          { id: tenant1.id },
          { id: tenant2.id }
        ]
      }
    })
    
    expect(remainingTenants).toHaveLength(0)
  })
})