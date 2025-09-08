// LIQUID ABT - Test Helpers
// Utilities for creating mock data and test scenarios

import crypto from 'crypto';
import Stripe from 'stripe';

/**
 * Create a mock Stripe webhook event for testing
 */
export function createMockWebhookEvent(
  eventType: string,
  data: any,
  options: { 
    id?: string;
    created?: number;
    livemode?: boolean;
  } = {}
): Stripe.Event {
  return {
    id: options.id || `evt_test_${Date.now()}`,
    object: 'event',
    api_version: '2024-12-18.acacia',
    created: options.created || Math.floor(Date.now() / 1000),
    data: {
      object: data,
      previous_attributes: undefined,
    },
    livemode: options.livemode || false,
    pending_webhooks: 1,
    request: {
      id: `req_test_${Date.now()}`,
      idempotency_key: null,
    },
    type: eventType as any,
  };
}

/**
 * Generate test tenant data
 */
export function generateTestTenant(options: {
  id?: string;
  name?: string;
  subdomain?: string;
} = {}) {
  const timestamp = Date.now();
  return {
    id: options.id || `tenant_test_${timestamp}`,
    name: options.name || `Test Business ${timestamp}`,
    subdomain: options.subdomain || `test${timestamp}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true,
    subscriptionTier: 'STARTER',
    settings: {
      currency: 'AUD',
      timezone: 'Australia/Sydney',
      bitcoinAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    },
  };
}

/**
 * Generate test user data
 */
export function generateTestUser(options: {
  tenantId?: string;
  role?: string;
  email?: string;
} = {}) {
  const timestamp = Date.now();
  return {
    id: `user_test_${timestamp}`,
    email: options.email || `test${timestamp}@example.com.au`,
    role: options.role || 'USER',
    tenantId: options.tenantId || `tenant_test_${timestamp}`,
    isActive: true,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    profile: {
      firstName: 'Test',
      lastName: 'User',
      phoneNumber: '+61412345678',
    },
  };
}

/**
 * Generate mock Bitcoin purchase data
 */
export function generateMockBitcoinPurchase(options: {
  tenantId?: string;
  amount?: number;
  bitcoinAmount?: number;
  status?: string;
} = {}) {
  const timestamp = Date.now();
  return {
    id: `purchase_test_${timestamp}`,
    tenantId: options.tenantId || `tenant_test_${timestamp}`,
    amount: options.amount || 1000.00,
    bitcoinAmount: options.bitcoinAmount || 0.01538462,
    status: options.status || 'completed',
    exchange: 'kraken',
    orderId: `order_${timestamp}`,
    executedPrice: 65000.00,
    fees: 15.00,
    createdAt: new Date(),
    completedAt: new Date(),
  };
}

/**
 * Generate mock Stripe charge data
 */
export function generateMockStripeCharge(options: {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  metadata?: Record<string, string>;
} = {}): Stripe.Charge {
  const timestamp = Date.now();
  return {
    id: options.id || `ch_test_${timestamp}`,
    object: 'charge',
    amount: options.amount || 10000,
    amount_captured: options.amount || 10000,
    amount_refunded: 0,
    application: null,
    application_fee: null,
    application_fee_amount: null,
    balance_transaction: `txn_test_${timestamp}`,
    billing_details: {
      address: {
        city: null,
        country: null,
        line1: null,
        line2: null,
        postal_code: null,
        state: null,
      },
      email: null,
      name: null,
      phone: null,
    },
    calculated_statement_descriptor: null,
    captured: true,
    created: Math.floor(Date.now() / 1000),
    currency: options.currency || 'aud',
    customer: null,
    description: 'Test charge',
    destination: null,
    dispute: null,
    disputed: false,
    failure_code: null,
    failure_message: null,
    fraud_details: {},
    invoice: null,
    livemode: false,
    metadata: options.metadata || {},
    on_behalf_of: null,
    order: null,
    outcome: {
      network_status: 'approved_by_network',
      reason: null,
      risk_level: 'normal',
      risk_score: 40,
      seller_message: 'Payment complete.',
      type: 'authorized',
    },
    paid: true,
    payment_intent: `pi_test_${timestamp}`,
    payment_method: `pm_test_${timestamp}`,
    payment_method_details: {
      card: {
        brand: 'visa',
        checks: {
          address_line1_check: null,
          address_postal_code_check: null,
          cvc_check: 'pass',
        },
        country: 'AU',
        exp_month: 12,
        exp_year: 2025,
        fingerprint: 'test_fingerprint',
        funding: 'credit',
        installments: null,
        last4: '4242',
        network: 'visa',
        three_d_secure: null,
        wallet: null,
      },
      type: 'card',
    },
    receipt_email: null,
    receipt_number: null,
    receipt_url: `https://pay.stripe.com/receipts/test_${timestamp}`,
    refunded: false,
    refunds: {
      object: 'list',
      data: [],
      has_more: false,
      total_count: 0,
      url: `/v1/charges/ch_test_${timestamp}/refunds`,
    },
    review: null,
    shipping: null,
    source: null,
    source_transfer: null,
    statement_descriptor: null,
    statement_descriptor_suffix: null,
    status: (options.status as any) || 'succeeded',
    transfer_data: null,
    transfer_group: null,
  };
}

/**
 * Generate mock treasury rule
 */
export function generateMockTreasuryRule(options: {
  type?: 'percentage' | 'threshold' | 'fixed';
  value?: number;
  minAmount?: number;
  maxAmount?: number;
  enabled?: boolean;
} = {}) {
  return {
    id: `rule_test_${Date.now()}`,
    type: options.type || 'percentage',
    value: options.value || 5,
    minAmount: options.minAmount || 100,
    maxAmount: options.maxAmount || 10000,
    enabled: options.enabled !== false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Generate Stripe webhook signature for testing
 */
export function generateStripeWebhookSignature(
  payload: string,
  secret: string,
  timestamp?: number
): string {
  const actualTimestamp = timestamp || Math.floor(Date.now() / 1000);
  const signedPayload = `${actualTimestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${actualTimestamp},v1=${signature}`;
}

/**
 * Mock Prisma client for testing
 */
export function createMockPrismaClient() {
  return {
    tenant: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    integration: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    bitcoinPurchase: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    treasuryRule: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn((cb) => cb(this)),
  };
}

/**
 * Wait for a specified amount of time
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random string for testing
 */
export function generateRandomString(length: number = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create mock Australian business details
 */
export function generateMockAustralianBusiness() {
  return {
    abn: '12345678901',
    entityName: 'TEST BUSINESS PTY LTD',
    tradingName: 'Test Trading Co',
    address: {
      street: '123 Test Street',
      suburb: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      country: 'AU',
    },
    industryCode: '6201',
    gstRegistered: true,
    createdAt: new Date(),
  };
}

/**
 * Create test user for security testing
 */
export async function createTestUser(options: {
  email?: string;
  password?: string;
  tenantId?: string;
} = {}): Promise<{
  id: string;
  email: string;
  tenantId: string;
  password: string;
}> {
  const testUser = {
    id: `user_test_${Date.now()}`,
    email: options.email || `test${Date.now()}@example.com`,
    password: options.password || 'TestPassword123!',
    tenantId: options.tenantId || `tenant_test_${Date.now()}`,
  };

  // In test environment, we just return mock data
  // In integration tests, this would actually create database records
  if (process.env.NODE_ENV === 'test') {
    // Mock implementation for unit tests
    console.log(`Created mock test user: ${testUser.email}`);
    return testUser;
  }

  try {
    // For integration tests, create actual database records
    const { getMasterPrisma } = await import('../src/lib/database/connection');
    const masterPrisma = getMasterPrisma();

    // Create tenant first
    const tenant = await masterPrisma.tenant.create({
      data: {
        id: testUser.tenantId,
        companyName: 'Test Company',
        subdomain: `test${Date.now()}`,
        subscriptionTier: 'FREE',
        isActive: true,
        schemaName: `tenant_test_${Date.now()}`,
        cancelAtPeriodEnd: false,
        monthlyVolumeLimit: 50000,
        dailyVolumeLimit: 5000,
        maxTransactionLimit: 1000,
        maxUsers: 2,
        maxIntegrations: 2,
        contactEmail: testUser.email,
        cgtMethod: 'FIFO',
        taxYear: new Date().getFullYear(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Hash password for database storage
    const { passwordManager } = await import('../src/lib/auth/argon2Password');
    const hashedPassword = await passwordManager.hashPassword(testUser.password);

    // Create user
    const user = await masterPrisma.user.create({
      data: {
        id: testUser.id,
        tenantId: tenant.id,
        email: testUser.email,
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'OWNER',
        isActive: true,
        mfaEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    console.log(`✅ Created integration test user: ${user.email} in tenant: ${tenant.companyName}`);
    return {
      ...testUser,
      id: user.id,
      tenantId: tenant.id,
    };
  } catch (error) {
    console.error('Failed to create test user:', error);
    throw error;
  }
}

/**
 * Clean up test data after testing
 */
export async function cleanupTestData(options: {
  userId?: string;
  tenantId?: string;
  email?: string;
} = {}): Promise<void> {
  // Skip cleanup in unit test environment
  if (process.env.NODE_ENV === 'test') {
    console.log('Skipping test data cleanup in unit test mode');
    return;
  }

  try {
    const { getMasterPrisma } = await import('../src/lib/database/connection');
    const masterPrisma = getMasterPrisma();

    // Clean up user
    if (options.userId) {
      await masterPrisma.user.deleteMany({
        where: { id: options.userId },
      });
      console.log(`🧹 Cleaned up test user: ${options.userId}`);
    }

    // Clean up tenant
    if (options.tenantId) {
      await masterPrisma.tenant.deleteMany({
        where: { id: options.tenantId },
      });
      console.log(`🧹 Cleaned up test tenant: ${options.tenantId}`);
    }

    // Clean up by email pattern
    if (options.email) {
      const users = await masterPrisma.user.findMany({
        where: { email: { contains: 'test' } },
        include: { tenant: true },
      });

      for (const user of users) {
        await masterPrisma.user.delete({ where: { id: user.id } });
        await masterPrisma.tenant.delete({ where: { id: user.tenantId } });
      }
      console.log(`🧹 Cleaned up ${users.length} test users and tenants`);
    }
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
    // Don't throw - cleanup failures shouldn't break tests
  }
}

/**
 * Setup test database connection
 */
export async function setupTestDatabase(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setupTestDatabase should only be called in test environment');
  }

  try {
    // Ensure test database exists and is properly configured
    const { getMasterPrisma } = await import('../src/lib/database/connection');
    const masterPrisma = getMasterPrisma();

    // Test the connection
    await masterPrisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Test database connection established');
  } catch (error) {
    console.error('❌ Failed to setup test database:', error);
    throw error;
  }
}

/**
 * Teardown test database connection
 */
export async function teardownTestDatabase(): Promise<void> {
  try {
    const { getMasterPrisma } = await import('../src/lib/database/connection');
    const masterPrisma = getMasterPrisma();
    
    await masterPrisma.$disconnect();
    console.log('✅ Test database connection closed');
  } catch (error) {
    console.error('❌ Failed to teardown test database:', error);
    // Don't throw - teardown failures shouldn't break tests
  }
}