// LIQUID ABT - Tenant Utility Functions
// Helper functions for tenant management and ID generation

import crypto from 'crypto';

/**
 * Generate a unique tenant ID
 */
export function generateTenantId(): string {
  // Generate a UUID v4 style ID
  const timestamp = Date.now().toString(36);
  const randomBytes = crypto.randomBytes(8).toString('hex');
  return `tenant_${timestamp}_${randomBytes}`;
}

/**
 * Generate a tenant slug from company name
 */
export function generateTenantSlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .slice(0, 30); // Limit length
}

/**
 * Validate tenant ID format
 */
export function isValidTenantId(tenantId: string): boolean {
  const pattern = /^tenant_[a-z0-9]+_[a-f0-9]{16}$/;
  return pattern.test(tenantId);
}

/**
 * Extract timestamp from tenant ID
 */
export function getTenantTimestamp(tenantId: string): Date | null {
  try {
    if (!isValidTenantId(tenantId)) {
      return null;
    }
    
    const parts = tenantId.split('_');
    if (parts.length !== 3) {
      return null;
    }
    
    const timestamp = parseInt(parts[1], 36);
    return new Date(timestamp);
  } catch (error) {
    return null;
  }
}

/**
 * Generate subdomain URL for tenant
 */
export function getTenantSubdomain(tenantSlug: string): string {
  const domain = process.env.NEXT_PUBLIC_DOMAIN || 'liquidtreasury.business';
  return `${tenantSlug}.${domain}`;
}

/**
 * Validate tenant slug format
 */
export function isValidTenantSlug(slug: string): boolean {
  const pattern = /^[a-z0-9-]{3,30}$/;
  return pattern.test(slug) && !slug.startsWith('-') && !slug.endsWith('-');
}

/**
 * Generate API key for tenant
 */
export function generateTenantApiKey(tenantId: string): string {
  const prefix = 'lqd_live_'; // Liquid live API key
  const payload = `${tenantId}.${Date.now()}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return `${prefix}${hash.slice(0, 32)}`;
}

/**
 * Generate test API key for tenant
 */
export function generateTenantTestApiKey(tenantId: string): string {
  const prefix = 'lqd_test_'; // Liquid test API key
  const payload = `${tenantId}.${Date.now()}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return `${prefix}${hash.slice(0, 32)}`;
}

/**
 * Validate LIQUID API key format
 */
export function isValidLiquidApiKey(apiKey: string): boolean {
  const livePattern = /^lqd_live_[a-f0-9]{32}$/;
  const testPattern = /^lqd_test_[a-f0-9]{32}$/;
  return livePattern.test(apiKey) || testPattern.test(apiKey);
}

/**
 * Check if API key is test or live
 */
export function isTestApiKey(apiKey: string): boolean {
  return apiKey.startsWith('lqd_test_');
}

/**
 * Generate webhook secret for tenant integrations
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Tenant configuration defaults
 */
export const TENANT_DEFAULTS = {
  currency: 'AUD',
  timezone: 'Australia/Sydney',
  subscriptionTier: 'STARTER',
  features: {
    stripeIntegration: true,
    bitcoinPurchases: true,
    webhooks: true,
    analytics: true,
    multiUser: false,
    advancedReporting: false,
    apiAccess: false,
  },
  limits: {
    monthlyVolume: 50000, // $50K AUD
    dailyVolume: 5000, // $5K AUD
    maxTransactionSize: 1000, // $1K AUD
    maxUsers: 2,
    maxIntegrations: 2,
  },
  settings: {
    emailNotifications: true,
    webhookNotifications: false,
    slackNotifications: false,
    autoConversion: true,
    conversionPercentage: 2, // 2%
    minimumConversion: 100, // $100 AUD
  },
};

/**
 * Get subscription tier limits
 */
export function getSubscriptionLimits(tier: string) {
  switch (tier.toUpperCase()) {
    case 'STARTER':
      return {
        monthlyVolume: 50000,
        dailyVolume: 5000,
        maxTransactionSize: 1000,
        maxUsers: 2,
        maxIntegrations: 2,
        conversionFee: 1.25, // 1.25%
      };
    case 'GROWTH':
      return {
        monthlyVolume: 500000,
        dailyVolume: 50000,
        maxTransactionSize: 10000,
        maxUsers: 10,
        maxIntegrations: 10,
        conversionFee: 0.55, // 0.55%
      };
    case 'PRO':
      return {
        monthlyVolume: 5000000,
        dailyVolume: 500000,
        maxTransactionSize: 100000,
        maxUsers: -1, // Unlimited
        maxIntegrations: -1, // Unlimited
        conversionFee: 0.50, // 0.50%
      };
    case 'ENTERPRISE':
      return {
        monthlyVolume: -1, // Unlimited
        dailyVolume: -1, // Unlimited
        maxTransactionSize: -1, // Unlimited
        maxUsers: -1, // Unlimited
        maxIntegrations: -1, // Unlimited
        conversionFee: 0.20, // 0.20%
      };
    default:
      return TENANT_DEFAULTS.limits;
  }
}

/**
 * Check if tenant can perform action based on limits
 */
export function canPerformAction(
  currentUsage: any,
  limits: any,
  action: string
): { allowed: boolean; reason?: string } {
  switch (action) {
    case 'add_user':
      if (limits.maxUsers !== -1 && currentUsage.userCount >= limits.maxUsers) {
        return { 
          allowed: false, 
          reason: `User limit reached (${limits.maxUsers})` 
        };
      }
      break;
    
    case 'add_integration':
      if (limits.maxIntegrations !== -1 && currentUsage.integrationCount >= limits.maxIntegrations) {
        return { 
          allowed: false, 
          reason: `Integration limit reached (${limits.maxIntegrations})` 
        };
      }
      break;
    
    case 'process_transaction':
      if (limits.maxTransactionSize !== -1 && currentUsage.transactionAmount > limits.maxTransactionSize) {
        return { 
          allowed: false, 
          reason: `Transaction exceeds limit ($${limits.maxTransactionSize})` 
        };
      }
      break;
      
    default:
      break;
  }
  
  return { allowed: true };
}