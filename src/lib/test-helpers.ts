// LIQUID ABT - Simple Test Helpers
// Core testing utilities for the platform

import crypto from 'crypto';
import Stripe from 'stripe';

/**
 * Create a mock Stripe webhook event for testing
 */
export function createMockWebhookEvent(
  type: string,
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
    type: type as any,
  };
}

/**
 * Generate test tenant data
 */
export function generateTestTenant(options: {
  id?: string;
  name?: string;
  subdomain?: string;
  industry?: string;
  monthlyRevenue?: string;
} = {}) {
  const timestamp = Date.now();
  const tenantId = options.id || `tenant_test_${timestamp}`;
  
  return {
    id: tenantId,
    name: options.name || `Test Business ${timestamp}`,
    subdomain: options.subdomain || `test${timestamp}`,
    industry: options.industry || 'technology',
    monthlyRevenue: options.monthlyRevenue || '50k-100k',
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true,
    subscriptionTier: 'STARTER',
    isBetaUser: true,
    settings: {
      currency: 'AUD',
      timezone: 'Australia/Sydney',
      bitcoinAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    },
  };
}

/**
 * Generate a mock Stripe charge for testing
 */
export function createMockStripeCharge(options: {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  metadata?: Record<string, string>;
} = {}): Partial<Stripe.Charge> {
  const timestamp = Date.now();
  
  return {
    id: options.id || `ch_test_${timestamp}`,
    object: 'charge',
    amount: options.amount || 10000, // $100 in cents
    amount_captured: options.amount || 10000,
    amount_refunded: 0,
    balance_transaction: `txn_test_${timestamp}`,
    captured: true,
    created: Math.floor(Date.now() / 1000),
    currency: options.currency || 'aud',
    description: 'Test charge',
    livemode: false,
    metadata: options.metadata || {},
    paid: true,
    receipt_url: `https://pay.stripe.com/receipts/test_${timestamp}`,
    refunded: false,
    status: (options.status as any) || 'succeeded',
  };
}

/**
 * Generate a mock Bitcoin purchase record
 */
export function createMockBitcoinPurchase(options: {
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
 * Generate Stripe webhook signature for testing
 */
export function generateMockWebhookSignature(
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
 * Create a mock treasury rule for testing
 */
export function createMockTreasuryRule(options: {
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
 * Wait for a specified amount of time (useful in tests)
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random string for testing
 */
export function generateRandomId(length: number = 10): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}