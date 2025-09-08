// LIQUID ABT - Database Seed Script

import { PrismaClient } from '@prisma/client';
import { tenantSchemaManager } from '../src/lib/database/connection';
import bcrypt from 'bcryptjs';

// Import enums from types
enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  USER = 'USER',
  VIEWER = 'VIEWER'
}

enum SubscriptionTier {
  FREE = 'FREE',
  GROWTH = 'GROWTH',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE'
}

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding LIQUID ABT database...');

  try {
    // Debug: Check what's available on prisma client
    console.log('Prisma client properties:', Object.keys(prisma));
    
    // 1. Create test tenant
    console.log('Creating test tenant...');
    
    const testTenant = await prisma.tenant.upsert({
      where: { subdomain: 'testco' },
      update: {},
      create: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        companyName: 'Test Company Pty Ltd',
        subdomain: 'testco',
        schemaName: 'tenant_550e8400_e29b_41d4_a716_446655440001',
        subscriptionTier: SubscriptionTier.GROWTH,
        isActive: true,
        contactEmail: 'admin@testco.com',
        abn: 'ABN 12 345 678 901',
        
        // Usage limits for GROWTH tier
        monthlyVolumeLimit: 500000.00,
        dailyVolumeLimit: 50000.00,
        maxTransactionLimit: 10000.00,
        maxUsers: 10,
        maxIntegrations: 10,
        
        // Contact details
        businessAddress: '123 Collins Street, Melbourne VIC 3000, Australia'
      }
    });

    // 2. Create tenant schema
    console.log('Creating tenant schema...');
    const schemaExists = await tenantSchemaManager.schemaExists(testTenant.id);
    if (!schemaExists) {
      await tenantSchemaManager.createTenantSchema(testTenant.id);
    } else {
      console.log('Tenant schema already exists');
    }

    // 3. Create test users with different roles
    console.log('Creating test users...');
    
    // Generate secure passwords for test users (in production, users set their own passwords)
    const ownerPasswordHash = await bcrypt.hash('450e9f67058ca370e775c850284ed089', 12);
    const adminPasswordHash = await bcrypt.hash('ced6621606b4a682e329c9f8bfb3c560', 12);
    const userPasswordHash = await bcrypt.hash('74bf45a33fbe36e040b2f6608dae0faf', 12);
    const viewerPasswordHash = await bcrypt.hash('62380f03b1f1f2f5d68407303f8df2bd', 12);
    
    // Owner user
    const ownerUser = await prisma.user.upsert({
      where: { email: 'owner@testco.com' },
      update: {},
      create: {
        id: '550e8400-e29b-41d4-a716-446655440002',
        tenantId: testTenant.id,
        email: 'owner@testco.com',
        passwordHash: ownerPasswordHash,
        firstName: 'John',
        lastName: 'Smith',
        role: UserRole.OWNER,
        isActive: true,
        lastLoginAt: new Date(),
        lastActiveAt: new Date()
      }
    });

    // Admin user
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin@testco.com' },
      update: {},
      create: {
        id: '550e8400-e29b-41d4-a716-446655440003',
        tenantId: testTenant.id,
        email: 'admin@testco.com',
        passwordHash: adminPasswordHash,
        firstName: 'Jane',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        isActive: true,
        lastLoginAt: new Date(),
        lastActiveAt: new Date()
      }
    });

    // Regular user
    const regularUser = await prisma.user.upsert({
      where: { email: 'user@testco.com' },
      update: {},
      create: {
        id: '550e8400-e29b-41d4-a716-446655440004',
        tenantId: testTenant.id,
        email: 'user@testco.com',
        passwordHash: userPasswordHash,
        firstName: 'Bob',
        lastName: 'Wilson',
        role: UserRole.USER,
        isActive: true,
        lastLoginAt: new Date(),
        lastActiveAt: new Date()
      }
    });

    // Viewer user (for accountants)
    const viewerUser = await prisma.user.upsert({
      where: { email: 'accountant@testco.com' },
      update: {},
      create: {
        id: '550e8400-e29b-41d4-a716-446655440005',
        tenantId: testTenant.id,
        email: 'accountant@testco.com',
        passwordHash: viewerPasswordHash,
        firstName: 'Alice',
        lastName: 'Johnson',
        role: UserRole.VIEWER,
        isActive: true,
        lastLoginAt: new Date(),
        lastActiveAt: new Date()
      }
    });

    // 4. Create sample treasury rules in tenant schema
    console.log('Creating sample treasury rules...');
    
    // 10% percentage rule
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO treasury_rules (
        id, name, is_active, rule_type, conversion_percentage, minimum_purchase,
        maximum_purchase, withdrawal_address, is_auto_withdrawal, exchange_provider,
        settings, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440010',
        '10% Revenue Conversion',
        true,
        'percentage',
        10.00,
        50.00,
        5000.00,
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        true,
        'kraken',
        $1,
        NOW(),
        NOW()
      ) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({"description": "Convert 10% of every payment to Bitcoin automatically"})]
    );

    // Threshold rule (inactive)
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO treasury_rules (
        id, name, is_active, rule_type, threshold_amount, buffer_amount,
        minimum_purchase, withdrawal_address, is_auto_withdrawal, exchange_provider,
        settings, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440011',
        'Threshold $10k Rule',
        false,
        'threshold',
        10000.00,
        1000.00,
        100.00,
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        true,
        'kraken',
        $1,
        NOW(),
        NOW()
      ) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({"description": "Convert when balance reaches $10,000, keep $1,000 buffer"})]
    );

    // 5. Create sample Stripe integration
    console.log('Creating sample integrations...');
    
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO integrations (
        id, type, provider, is_active, access_token, settings, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440020',
        'PAYMENT_PROCESSOR',
        'stripe',
        true,
        'acct_1234567890',
        $1,
        NOW(),
        NOW()
      ) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({
        "accountId": "acct_1234567890",
        "businessName": "Test Company Pty Ltd",
        "email": "admin@testco.com",
        "country": "AU",
        "capabilities": ["card_payments", "transfers"],
        "chargesEnabled": true,
        "payoutsEnabled": true,
        "connectedAt": new Date().toISOString()
      })]
    );

    // Kraken integration (inactive by default)
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO integrations (
        id, type, provider, is_active, settings, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440021',
        'EXCHANGE',
        'kraken',
        false,
        $1,
        NOW(),
        NOW()
      ) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({"environment": "test", "note": "Configure with real API credentials"})]
    );

    // 6. Create sample transactions
    console.log('Creating sample transactions...');
    
    // Recent successful transaction
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO transactions (
        id, integration_id, external_id, amount, currency, description, status,
        should_convert, provider, provider_data, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440030',
        '550e8400-e29b-41d4-a716-446655440020',
        'pi_stripe_test_123',
        1500.00,
        'AUD',
        'Website payment from customer',
        'succeeded',
        true,
        'stripe',
        $1,
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '2 hours'
      ) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({"payment_intent": "pi_stripe_test_123", "customer": "cus_test_123"})]
    );

    // Older transaction
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO transactions (
        id, integration_id, external_id, amount, currency, description, status,
        should_convert, provider, provider_data, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440031',
        '550e8400-e29b-41d4-a716-446655440020',
        'pi_stripe_test_456',
        850.00,
        'AUD',
        'Invoice payment',
        'succeeded',
        true,
        'stripe',
        $1,
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      ) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({"payment_intent": "pi_stripe_test_456", "invoice": "in_test_456"})]
    );

    // 7. Create sample Bitcoin purchases
    console.log('Creating sample Bitcoin purchases...');
    
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO bitcoin_purchases (
        id, transaction_id, amount_aud, bitcoin_amount, price_per_btc,
        exchange_order_id, exchange_provider, status, fees_aud,
        raw_exchange_data, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440040',
        '550e8400-e29b-41d4-a716-446655440030',
        150.00,
        0.00157895,
        95000.00,
        'kraken_order_123',
        'kraken',
        'filled',
        2.50,
        $1,
        NOW() - INTERVAL '1.5 hours',
        NOW() - INTERVAL '1.5 hours'
      ) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({"orderId": "kraken_order_123", "executedAt": new Date(Date.now() - 90*60*1000).toISOString()})]
    );

    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO bitcoin_purchases (
        id, transaction_id, amount_aud, bitcoin_amount, price_per_btc,
        exchange_order_id, exchange_provider, status, fees_aud,
        raw_exchange_data, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440041',
        '550e8400-e29b-41d4-a716-446655440031',
        85.00,
        0.00089474,
        95000.00,
        'kraken_order_456',
        'kraken',
        'filled',
        1.25,
        $1,
        NOW() - INTERVAL '23 hours',
        NOW() - INTERVAL '23 hours'
      ) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({"orderId": "kraken_order_456", "executedAt": new Date(Date.now() - 23*60*60*1000).toISOString()})]
    );

    // 8. Create sample Bitcoin withdrawals
    console.log('Creating sample Bitcoin withdrawals...');
    
    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO bitcoin_withdrawals (
        id, bitcoin_purchase_id, withdrawal_id, amount, address, status,
        exchange_provider, tx_id, fees_btc, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440050',
        '550e8400-e29b-41d4-a716-446655440040',
        'kraken_withdrawal_123',
        0.00157895,
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        'confirmed',
        'kraken',
        'abc123def456789012345678901234567890abcdef123456789012345678901234',
        0.00001500,
        NOW() - INTERVAL '1 hour',
        NOW() - INTERVAL '30 minutes'
      ) ON CONFLICT (id) DO NOTHING`,
      []
    );

    await tenantSchemaManager.queryTenantSchema(
      testTenant.id,
      `INSERT INTO bitcoin_withdrawals (
        id, bitcoin_purchase_id, withdrawal_id, amount, address, status,
        exchange_provider, fees_btc, created_at, updated_at
      ) VALUES (
        '550e8400-e29b-41d4-a716-446655440051',
        '550e8400-e29b-41d4-a716-446655440041',
        'kraken_withdrawal_456',
        0.00089474,
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        'processing',
        'kraken',
        0.00001500,
        NOW() - INTERVAL '22 hours',
        NOW() - INTERVAL '22 hours'
      ) ON CONFLICT (id) DO NOTHING`,
      []
    );

    // 9. Create subscription history
    console.log('Creating subscription history...');
    
    await prisma.subscriptionHistory.upsert({
      where: { id: '550e8400-e29b-41d4-a716-446655440060' },
      update: {},
      create: {
        id: '550e8400-e29b-41d4-a716-446655440060',
        tenantId: testTenant.id,
        previousTier: SubscriptionTier.FREE,
        newTier: SubscriptionTier.GROWTH,
        changeReason: 'Initial upgrade to Growth tier',
        effectiveDate: new Date()
      }
    });

    console.log('✅ Database seeded successfully!');
    console.log('\n📊 Created:');
    console.log(`  • Tenant: ${testTenant.companyName} (${testTenant.subdomain})`);
    console.log(`  • Users: 4 (Owner, Admin, User, Viewer)`);
    console.log(`  • Treasury Rules: 2 (1 active percentage rule, 1 inactive threshold rule)`);
    console.log(`  • Integrations: 2 (Stripe active, Kraken inactive)`);
    console.log(`  • Transactions: 2 successful payments`);
    console.log(`  • Bitcoin Purchases: 2 filled orders`);
    console.log(`  • Bitcoin Withdrawals: 1 confirmed, 1 processing`);
    console.log('\n🔑 Test Credentials:');
    console.log(`  Owner:      owner@testco.com / 450e9f67058ca370e775c850284ed089`);
    console.log(`  Admin:      admin@testco.com / ced6621606b4a682e329c9f8bfb3c560`);
    console.log(`  User:       user@testco.com / 74bf45a33fbe36e040b2f6608dae0faf`);
    console.log(`  Accountant: accountant@testco.com / 62380f03b1f1f2f5d68407303f8df2bd`);
    console.log('\n🌐 Test URL: http://testco.localhost:3000 (with proper subdomain routing)');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });