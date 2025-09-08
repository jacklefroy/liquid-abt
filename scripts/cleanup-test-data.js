#!/usr/bin/env node

// LIQUID ABT - Manual Test Data Cleanup Script
// Run this if you need to clean up test data manually

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

async function cleanupTestData() {
  console.log('🧹 Starting manual test data cleanup...')
  
  // For manual cleanup, go straight to direct database cleanup
  // This avoids TypeScript compilation issues
  await directDatabaseCleanup()
}

// Direct database cleanup using Prisma
async function directDatabaseCleanup() {
  try {
    console.log('🔧 Attempting direct database cleanup...')
    const { PrismaClient } = require('@prisma/client')
    
    const prisma = new PrismaClient()
    await prisma.$connect()
    
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
    
    // Clean up master tables (using correct column names)
    await prisma.$executeRaw`DELETE FROM webhook_events WHERE "eventId" LIKE 'test_%' OR provider = 'test'`
    await prisma.$executeRaw`DELETE FROM subscription_history WHERE "tenantId" IN (SELECT id FROM tenants WHERE subdomain LIKE 'test%' OR "companyName" LIKE '%Test%')`
    await prisma.$executeRaw`DELETE FROM users WHERE "tenantId" IN (SELECT id FROM tenants WHERE subdomain LIKE 'test%' OR "companyName" LIKE '%Test%')`
    await prisma.$executeRaw`DELETE FROM tenants WHERE subdomain LIKE 'test%' OR "companyName" LIKE '%Test%' OR "contactEmail" LIKE '%test@%'`
    
    await prisma.$disconnect()
    console.log('✅ Direct database cleanup completed')
    process.exit(0)
    
  } catch (error) {
    console.error('❌ Direct database cleanup also failed:', error.message)
    process.exit(1)
  }
}

// Run cleanup if this script is called directly
if (require.main === module) {
  cleanupTestData()
}

module.exports = { cleanupTestData }