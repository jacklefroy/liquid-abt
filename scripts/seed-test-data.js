#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const masterPrisma = new PrismaClient();

async function createTestTenant() {
  console.log('🌱 Seeding test tenant and user data...\n');

  try {
    // Create test tenant in master database
    const tenant = await masterPrisma.tenant.upsert({
      where: { id: 'tenant_test_123' },
      update: {},
      create: {
        id: 'tenant_test_123',
        companyName: 'Demo Company Ltd',
        subdomain: 'demo',
        schemaName: 'tenant_test',
        subscriptionTier: 'PRO',
        isActive: true,
        monthlyVolumeLimit: 500000,
        dailyVolumeLimit: 50000,
        maxTransactionLimit: 10000,
        contactEmail: 'demo@company.com'
      }
    });

    console.log('✅ Created test tenant:', tenant.companyName);

    // Create test user in master database
    const user = await masterPrisma.user.upsert({
      where: { id: 'user_test_123' },
      update: {},
      create: {
        id: 'user_test_123',
        email: 'demo@company.com',
        firstName: 'Demo',
        lastName: 'User',
        passwordHash: 'demo123', // In production this would be properly hashed
        role: 'OWNER',
        tenantId: tenant.id,
        isActive: true
      }
    });

    console.log('✅ Created test user:', user.email);

    // Now create the tenant schema and tables
    await masterPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS tenant_test CASCADE`);
    await masterPrisma.$executeRawUnsafe(`CREATE SCHEMA tenant_test`);
    
    console.log('✅ Created tenant schema: tenant_test');

    // Create tables in tenant schema
    await masterPrisma.$executeRawUnsafe(`
      CREATE TABLE tenant_test.stripe_payments (
        id SERIAL PRIMARY KEY,
        stripe_payment_id VARCHAR(255) UNIQUE NOT NULL,
        customer_id VARCHAR(255),
        amount INTEGER NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'aud',
        status VARCHAR(50) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await masterPrisma.$executeRawUnsafe(`
      CREATE TABLE tenant_test.bitcoin_purchases (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(255) UNIQUE NOT NULL,
        stripe_payment_id VARCHAR(255),
        customer_id VARCHAR(255),
        bitcoin_amount DECIMAL(16,8) NOT NULL,
        fiat_amount DECIMAL(12,2) NOT NULL,
        fiat_currency VARCHAR(10) NOT NULL DEFAULT 'AUD',
        exchange_rate DECIMAL(12,2) NOT NULL,
        fees DECIMAL(12,2) NOT NULL DEFAULT 0,
        exchange_provider VARCHAR(50) NOT NULL DEFAULT 'mock',
        wallet_address VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await masterPrisma.$executeRawUnsafe(`
      CREATE TABLE tenant_test.treasury_rules (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        configuration JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    console.log('✅ Created tenant database tables');

    // Add some test transaction data
    await seedTestTransactions();

    console.log('\n🎉 Test data seeding completed successfully!');
    console.log('\n📋 Login credentials:');
    console.log('   Email: demo@company.com (or any email)');
    console.log('   Password: demo123 (or any password)');
    console.log('\n🚀 You can now test at: http://localhost:3000/login');

  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    process.exit(1);
  } finally {
    await masterPrisma.$disconnect();
  }
}

async function seedTestTransactions() {
  console.log('💰 Adding mock transaction data...');
  
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Add successful transactions
  const successfulPayments = [
    { amount: 50000, btc: 0.00076923, rate: 65000, status: 'succeeded', date: now },
    { amount: 100000, btc: 0.00153846, rate: 65000, status: 'succeeded', date: yesterday },
    { amount: 250000, btc: 0.00384615, rate: 65000, status: 'succeeded', date: lastWeek },
    { amount: 75000, btc: 0.00115385, rate: 65000, status: 'succeeded', date: lastMonth },
  ];

  // Add some problematic transactions for testing recovery system
  const problemTransactions = [
    { amount: 30000, btc: null, status: 'succeeded', date: new Date(now.getTime() - 2 * 60 * 60 * 1000) }, // Orphaned payment
    { amount: 80000, btc: 0.00123077, rate: 65000, status: 'failed', date: new Date(now.getTime() - 1 * 60 * 60 * 1000) }, // Failed Bitcoin purchase
  ];

  let transactionId = 1;

  // Insert successful transactions
  for (const txn of successfulPayments) {
    const stripePaymentId = `pi_test_success_${transactionId}`;
    const bitcoinTxnId = `btc_test_${transactionId}`;
    
    // Insert Stripe payment
    await masterPrisma.$executeRawUnsafe(`
      INSERT INTO tenant_test.stripe_payments 
      (stripe_payment_id, customer_id, amount, currency, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, stripePaymentId, `cus_test_${transactionId}`, txn.amount, 'aud', txn.status, txn.date, txn.date);

    // Insert corresponding Bitcoin purchase
    await masterPrisma.$executeRawUnsafe(`
      INSERT INTO tenant_test.bitcoin_purchases 
      (transaction_id, stripe_payment_id, customer_id, bitcoin_amount, fiat_amount, fiat_currency, exchange_rate, fees, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, bitcoinTxnId, stripePaymentId, `cus_test_${transactionId}`, txn.btc, txn.amount / 100, 'AUD', txn.rate, (txn.amount / 100) * 0.005, 'completed', txn.date, txn.date);

    transactionId++;
  }

  // Insert problem transactions
  for (const txn of problemTransactions) {
    const stripePaymentId = `pi_test_problem_${transactionId}`;
    
    // Insert Stripe payment (successful)
    await masterPrisma.$executeRawUnsafe(`
      INSERT INTO tenant_test.stripe_payments 
      (stripe_payment_id, customer_id, amount, currency, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, stripePaymentId, `cus_test_${transactionId}`, txn.amount, 'aud', txn.status, txn.date, txn.date);

    // Insert Bitcoin purchase only if not orphaned
    if (txn.btc) {
      const bitcoinTxnId = `btc_test_failed_${transactionId}`;
      await masterPrisma.$executeRawUnsafe(`
        INSERT INTO tenant_test.bitcoin_purchases 
        (transaction_id, stripe_payment_id, customer_id, bitcoin_amount, fiat_amount, fiat_currency, exchange_rate, fees, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, bitcoinTxnId, stripePaymentId, `cus_test_${transactionId}`, txn.btc, txn.amount / 100, 'AUD', txn.rate, (txn.amount / 100) * 0.005, 'failed', txn.date, txn.date);
    }

    transactionId++;
  }

  // Add a treasury rule
  await masterPrisma.$executeRawUnsafe(`
    INSERT INTO tenant_test.treasury_rules 
    (name, type, is_active, configuration, created_at, updated_at)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6)
  `, 'Demo 5% Conversion Rule', 'percentage', true, '{"percentage": 5, "minAmount": 100, "maxAmount": 10000}', now, now);

  console.log(`✅ Added ${successfulPayments.length} successful transactions`);
  console.log(`✅ Added ${problemTransactions.length} problem transactions for testing`);
  console.log('✅ Added sample treasury rule');
}

// Run the seeding
createTestTenant();