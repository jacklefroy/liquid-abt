// LIQUID ABT - Database Test Utilities

import { PrismaClient } from '@prisma/client'
import { tenantSchemaManager } from '@/lib/database/connection'
import bcrypt from 'bcryptjs'

export class TestDatabaseUtils {
  private static prisma: PrismaClient

  static async getPrismaClient(): Promise<PrismaClient> {
    if (!this.prisma) {
      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL
          }
        }
      })
      await this.prisma.$connect()
    }
    return this.prisma
  }

  /**
   * Create a test tenant with proper schema isolation
   */
  static async createTestTenant(overrides: Partial<any> = {}) {
    const prisma = await this.getPrismaClient()
    const uuid = require('crypto').randomUUID()
    
    const tenantData = {
      id: uuid,
      companyName: 'Test Company Ltd',
      subdomain: `test-${uuid.substring(0, 8)}`,
      schemaName: `test_tenant_${uuid.replace(/-/g, '_')}`,
      subscriptionTier: 'GROWTH' as const,
      isActive: true,
      contactEmail: 'test@example.com',
      monthlyVolumeLimit: 500000,
      dailyVolumeLimit: 50000,
      maxTransactionLimit: 10000,
      maxUsers: 10,
      maxIntegrations: 10,
      ...overrides
    }

    // Create tenant in master database
    const tenant = await prisma.tenant.create({
      data: tenantData
    })

    // Create tenant schema
    await tenantSchemaManager.createTenantSchema(tenant.id)

    return tenant
  }

  /**
   * Create a test user for a tenant
   */
  static async createTestUser(tenantId: string, overrides: Partial<any> = {}) {
    const prisma = await this.getPrismaClient()
    const uuid = require('crypto').randomUUID()
    
    const userData = {
      id: uuid,
      tenantId,
      email: `test-user-${uuid.substring(0, 8)}@example.com`,
      passwordHash: await bcrypt.hash('password123', 10),
      firstName: 'Test',
      lastName: 'User',
      role: 'USER' as const,
      isActive: true,
      ...overrides
    }

    return await prisma.user.create({
      data: userData
    })
  }

  /**
   * Create test treasury rules for a tenant
   */
  static async createTestTreasuryRule(tenantId: string, overrides: Partial<any> = {}) {
    // Generate a proper UUID for the rule
    const { randomUUID } = require('crypto')
    const ruleData = {
      id: randomUUID(),
      name: 'Test Rule',
      is_active: true,
      rule_type: 'percentage',
      conversion_percentage: 10.00,
      minimum_purchase: 50.00,
      maximum_purchase: 5000.00,
      threshold_amount: null,
      buffer_amount: null,
      exchange_provider: 'kraken',
      is_auto_withdrawal: false,
      settings: JSON.stringify({ description: 'Test treasury rule' }),
      ...overrides
    }

    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO treasury_rules (
        id, name, is_active, rule_type, conversion_percentage, minimum_purchase,
        maximum_purchase, threshold_amount, buffer_amount, exchange_provider, 
        is_auto_withdrawal, settings, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING *`,
      [
        ruleData.id, ruleData.name, ruleData.is_active, ruleData.rule_type,
        ruleData.conversion_percentage, ruleData.minimum_purchase,
        ruleData.maximum_purchase, ruleData.threshold_amount, ruleData.buffer_amount,
        ruleData.exchange_provider, ruleData.is_auto_withdrawal, ruleData.settings
      ]
    )

    return result[0]
  }

  /**
   * Create test integration for a tenant
   */
  static async createTestIntegration(tenantId: string, overrides: Partial<any> = {}) {
    const integrationData = {
      id: require('crypto').randomUUID(),
      type: 'PAYMENT',
      provider: 'stripe',
      is_active: true,
      access_token: `test_token_${Date.now()}`,
      settings: JSON.stringify({ 
        testMode: true, 
        connectedAt: new Date().toISOString() 
      }),
      ...overrides
    }

    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO integrations (
        id, type, provider, is_active, access_token, settings,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *`,
      [
        integrationData.id, integrationData.type, integrationData.provider,
        integrationData.is_active, integrationData.access_token, integrationData.settings
      ]
    )

    return result[0]
  }

  /**
   * Create test transaction for a tenant
   */
  static async createTestTransaction(tenantId: string, integrationId: string, overrides: Partial<any> = {}) {
    const transactionData = {
      id: require('crypto').randomUUID(),
      integration_id: integrationId,
      external_id: `test_ext_${Date.now()}`,
      amount: 1000.00,
      currency: 'AUD',
      description: 'Test transaction',
      status: 'succeeded',
      should_convert: true,
      provider: 'stripe',
      provider_data: JSON.stringify({ test: true }),
      ...overrides
    }

    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO transactions (
        id, integration_id, external_id, amount, currency, description,
        status, should_convert, provider, provider_data, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        transactionData.id, transactionData.integration_id, transactionData.external_id,
        transactionData.amount, transactionData.currency, transactionData.description,
        transactionData.status, transactionData.should_convert, transactionData.provider,
        transactionData.provider_data
      ]
    )

    return result[0]
  }

  /**
   * Clean up test data for a specific tenant
   * IMPORTANT: Must delete in correct order due to foreign key constraints
   */
  static async cleanupTenant(tenantId: string) {
    try {
      const prisma = await this.getPrismaClient()
      
      // First, check if tenant schema exists
      const schemaExists = await tenantSchemaManager.schemaExists(tenantId)
      
      if (schemaExists) {
        // Get tenant info for schema name
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
        const schemaName = tenant?.schemaName || `tenant_${tenantId.replace(/-/g, '_')}`
        
        // Clean up tenant schema tables in reverse dependency order
        // 1. bitcoin_withdrawals (references bitcoin_purchases)
        await tenantSchemaManager.queryTenantSchema(
          tenantId,
          'DELETE FROM bitcoin_withdrawals'
        ).catch(() => {}) // Ignore errors if table doesn't exist
        
        // 2. processing_failures (references transactions)
        await tenantSchemaManager.queryTenantSchema(
          tenantId,
          'DELETE FROM processing_failures'
        ).catch(() => {})
        
        // 3. bitcoin_purchases (references transactions)
        await tenantSchemaManager.queryTenantSchema(
          tenantId,
          'DELETE FROM bitcoin_purchases'
        ).catch(() => {})
        
        // 4. transactions (references integrations)
        await tenantSchemaManager.queryTenantSchema(
          tenantId,
          'DELETE FROM transactions'
        ).catch(() => {})
        
        // 5. treasury_rules (independent table)
        await tenantSchemaManager.queryTenantSchema(
          tenantId,
          'DELETE FROM treasury_rules'
        ).catch(() => {})
        
        // 6. integrations (base table for many references)
        await tenantSchemaManager.queryTenantSchema(
          tenantId,
          'DELETE FROM integrations'
        ).catch(() => {})
        
        // Finally, drop the entire schema
        await tenantSchemaManager.dropTenantSchema(tenantId)
      }

      // Clean up master database (in correct order)
      // 1. webhook_events (independent)
      await prisma.webhookEvent.deleteMany({ 
        where: { 
          OR: [
            { eventId: { contains: tenantId } },
            { eventId: { startsWith: 'test' } }
          ]
        } 
      }).catch(() => {})
      
      // 2. subscription_history (references tenant)
      await prisma.subscriptionHistory.deleteMany({ where: { tenantId } })
      
      // 3. users (references tenant)  
      await prisma.user.deleteMany({ where: { tenantId } })
      
      // 4. tenant record (delete last)
      await prisma.tenant.delete({ where: { id: tenantId } })

    } catch (error: any) {
      console.warn(`Cleanup warning for tenant ${tenantId}:`, error.message)
      // Try force cleanup if normal cleanup fails
      await this.forceCleanupTenant(tenantId)
    }
  }
  
  /**
   * Force cleanup when normal cleanup fails
   */
  static async forceCleanupTenant(tenantId: string) {
    try {
      const prisma = await this.getPrismaClient()
      
      // Force drop schema using raw SQL
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
      if (tenant?.schemaName) {
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`)
      }
      
      // Force delete from master tables (using correct column names)
      await prisma.$executeRaw`DELETE FROM webhook_events WHERE "eventId" LIKE '%${tenantId}%' OR "eventId" LIKE 'test%'`
      await prisma.$executeRaw`DELETE FROM subscription_history WHERE "tenantId" = ${tenantId}`
      await prisma.$executeRaw`DELETE FROM users WHERE "tenantId" = ${tenantId}`
      await prisma.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}`
      
    } catch (error: any) {
      console.error(`Force cleanup failed for tenant ${tenantId}:`, error.message)
    }
  }

  /**
   * Clean up all test data
   */
  static async cleanup() {
    try {
      const prisma = await this.getPrismaClient()
      
      // Find all test tenants (broader criteria)
      const testTenants = await prisma.tenant.findMany({
        where: {
          OR: [
            { subdomain: { startsWith: 'test' } },
            { companyName: { contains: 'Test' } },
            { contactEmail: { contains: 'test@' } },
            { contactEmail: { contains: 'example.com' } },
            { schemaName: { startsWith: 'test_tenant_' } }
          ]
        }
      })

      console.log(`🧹 Found ${testTenants.length} test tenants to cleanup`)

      // Clean up each tenant sequentially to avoid conflicts
      for (const tenant of testTenants) {
        console.log(`🗑️  Cleaning tenant: ${tenant.companyName} (${tenant.id})`)
        await this.cleanupTenant(tenant.id)
      }
      
      // Clean up any orphaned webhook events
      await prisma.webhookEvent.deleteMany({
        where: {
          OR: [
            { eventId: { startsWith: 'evt_test' } },
            { eventId: { startsWith: 'test_' } },
            { provider: { equals: 'test' } },
            { expiresAt: { lt: new Date() } } // Clean expired events
          ]
        }
      }).catch(() => {})
      
      // Clean up any orphaned test schemas
      await this.cleanupOrphanedSchemas()

    } catch (error: any) {
      console.warn('Global cleanup warning:', error.message)
      // Attempt force cleanup if normal cleanup fails
      await this.forceGlobalCleanup()
    }
  }
  
  /**
   * Clean up orphaned test schemas that might be left behind
   */
  static async cleanupOrphanedSchemas() {
    try {
      const prisma = await this.getPrismaClient()
      
      // Get all schema names that look like test schemas
      const result = await prisma.$queryRaw`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'test_tenant_%'
           OR schema_name LIKE 'tenant_test_%'
      ` as Array<{ schema_name: string }>
      
      for (const row of result) {
        console.log(`🗑️  Dropping orphaned schema: ${row.schema_name}`)
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`)
      }
      
    } catch (error: any) {
      console.warn('Orphaned schema cleanup warning:', error.message)
    }
  }
  
  /**
   * Force global cleanup when normal cleanup fails
   */
  static async forceGlobalCleanup() {
    try {
      const prisma = await this.getPrismaClient()
      
      console.log('🚨 Attempting force cleanup...')
      
      // Force drop all test schemas
      await prisma.$executeRaw`
        DO $$ DECLARE
          schema_name text;
        BEGIN
          FOR schema_name IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'test_tenant_%' OR nspname LIKE 'tenant_test_%'
          LOOP
            EXECUTE 'DROP SCHEMA IF EXISTS ' || quote_ident(schema_name) || ' CASCADE';
          END LOOP;
        END $$;
      `
      
      // Force delete test data from master tables (using correct column names)
      await prisma.$executeRaw`DELETE FROM webhook_events WHERE "eventId" LIKE 'test_%' OR "eventId" LIKE 'evt_test%' OR provider = 'test'`
      await prisma.$executeRaw`DELETE FROM subscription_history WHERE "tenantId" IN (SELECT id FROM tenants WHERE subdomain LIKE 'test%' OR "companyName" LIKE '%Test%')`
      await prisma.$executeRaw`DELETE FROM users WHERE "tenantId" IN (SELECT id FROM tenants WHERE subdomain LIKE 'test%' OR "companyName" LIKE '%Test%')`
      await prisma.$executeRaw`DELETE FROM tenants WHERE subdomain LIKE 'test%' OR "companyName" LIKE '%Test%' OR "contactEmail" LIKE '%test@%' OR "contactEmail" LIKE '%example.com%'`
      
      console.log('✅ Force cleanup completed')
      
    } catch (error: any) {
      console.error('Force global cleanup failed:', error.message)
    }
  }

  /**
   * Reset database to clean state
   */
  static async reset() {
    await this.cleanup()
  }

  /**
   * Create test Bitcoin purchase for a tenant
   */
  static async createTestBitcoinPurchase(tenantId: string, transactionId: string, overrides: Partial<any> = {}) {
    const purchaseData = {
      id: require('crypto').randomUUID(),
      transaction_id: transactionId,
      amount_aud: 1000.00,
      amount_btc: 0.02500000,
      btc_price_aud: 40000.00,
      exchange_fee: 5.00,
      purchase_status: 'completed',
      exchange_order_id: `test_order_${Date.now()}`,
      exchange_provider: 'kraken',
      purchase_data: JSON.stringify({ test: true }),
      ...overrides
    }

    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO bitcoin_purchases (
        id, transaction_id, amount_aud, amount_btc, btc_price_aud, exchange_fee,
        purchase_status, exchange_order_id, exchange_provider, purchase_data,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        purchaseData.id, purchaseData.transaction_id, purchaseData.amount_aud,
        purchaseData.amount_btc, purchaseData.btc_price_aud, purchaseData.exchange_fee,
        purchaseData.purchase_status, purchaseData.exchange_order_id,
        purchaseData.exchange_provider, purchaseData.purchase_data
      ]
    )

    return result[0]
  }

  /**
   * Create test Bitcoin withdrawal for a tenant
   */
  static async createTestBitcoinWithdrawal(tenantId: string, bitcoinPurchaseId: string, overrides: Partial<any> = {}) {
    const withdrawalData = {
      id: require('crypto').randomUUID(),
      bitcoin_purchase_id: bitcoinPurchaseId,
      withdrawal_id: `test_withdrawal_${Date.now()}`,
      wallet_address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      amount_btc: 0.02500000,
      withdrawal_fee: 0.00010000,
      withdrawal_status: 'completed',
      transaction_hash: 'test_hash_' + require('crypto').randomBytes(32).toString('hex'),
      ...overrides
    }

    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO bitcoin_withdrawals (
        id, bitcoin_purchase_id, withdrawal_id, wallet_address, amount_btc,
        withdrawal_fee, withdrawal_status, transaction_hash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *`,
      [
        withdrawalData.id, withdrawalData.bitcoin_purchase_id, withdrawalData.withdrawal_id,
        withdrawalData.wallet_address, withdrawalData.amount_btc, withdrawalData.withdrawal_fee,
        withdrawalData.withdrawal_status, withdrawalData.transaction_hash
      ]
    )

    return result[0]
  }

  /**
   * Create test processing failure for a tenant
   */
  static async createTestProcessingFailure(tenantId: string, transactionId: string, overrides: Partial<any> = {}) {
    const failureData = {
      id: require('crypto').randomUUID(),
      transaction_id: transactionId,
      error_message: 'Test processing failure',
      error_code: 'TEST_ERROR',
      failure_count: 1,
      next_retry: new Date(Date.now() + 60000), // 1 minute from now
      failure_data: JSON.stringify({ test: true }),
      ...overrides
    }

    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO processing_failures (
        id, transaction_id, error_message, error_code, failure_count,
        next_retry, failure_data, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *`,
      [
        failureData.id, failureData.transaction_id, failureData.error_message,
        failureData.error_code, failureData.failure_count, failureData.next_retry,
        failureData.failure_data
      ]
    )

    return result[0]
  }

  /**
   * Create complete test data chain for a tenant
   * Returns all created entities for easy cleanup testing
   */
  static async createCompleteTestData(tenantId: string) {
    // Create integration
    const integration = await this.createTestIntegration(tenantId)
    
    // Create treasury rule
    const treasuryRule = await this.createTestTreasuryRule(tenantId)
    
    // Create transaction
    const transaction = await this.createTestTransaction(tenantId, integration.id)
    
    // Create bitcoin purchase
    const bitcoinPurchase = await this.createTestBitcoinPurchase(tenantId, transaction.id)
    
    // Create bitcoin withdrawal
    const bitcoinWithdrawal = await this.createTestBitcoinWithdrawal(tenantId, bitcoinPurchase.id)
    
    // Create processing failure
    const processingFailure = await this.createTestProcessingFailure(tenantId, transaction.id)

    return {
      integration,
      treasuryRule,
      transaction,
      bitcoinPurchase,
      bitcoinWithdrawal,
      processingFailure
    }
  }

  /**
   * Disconnect from database
   */
  static async disconnect() {
    if (this.prisma) {
      await this.prisma.$disconnect()
    }
  }
}