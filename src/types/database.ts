// LIQUID ABT - Database Type Definitions

export enum SubscriptionTier {
  FREE = 'FREE',
  GROWTH = 'GROWTH', 
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE'
}

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  USER = 'USER',
  VIEWER = 'VIEWER'
}

export enum CGTMethod {
  FIFO = 'FIFO',
  LIFO = 'LIFO',
  WEIGHTED_AVERAGE = 'WEIGHTED_AVERAGE',
  SPECIFIC_ID = 'SPECIFIC_ID'
}

export interface Tenant {
  id: string;
  companyName: string;
  subdomain: string;
  subscriptionTier: SubscriptionTier;
  isActive: boolean;
  schemaName: string;
  
  // Subscription Details
  stripeCustomerId?: string;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  
  // Usage Limits
  monthlyVolumeLimit: number;
  dailyVolumeLimit: number;
  maxTransactionLimit: number;
  maxUsers: number;
  maxIntegrations: number;
  
  // Contact & Business Info
  contactEmail: string;
  businessAddress?: string;
  abn?: string;
  
  // Compliance Settings
  cgtMethod: CGTMethod;
  taxYear: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  
  // MFA Settings
  mfaEnabled: boolean;
  mfaSecret?: string;
  
  // Last Activity
  lastLoginAt?: Date;
  lastActiveAt?: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Tenant-specific types (for tables in tenant schemas)

export enum IntegrationType {
  PAYMENT_PROCESSOR = 'PAYMENT_PROCESSOR',
  BANK_ACCOUNT = 'BANK_ACCOUNT', 
  ACCOUNTING_SOFTWARE = 'ACCOUNTING_SOFTWARE',
  EXCHANGE = 'EXCHANGE'
}

export enum RuleType {
  PERCENTAGE = 'PERCENTAGE',     // Convert X% of each payment
  THRESHOLD = 'THRESHOLD',       // Convert when balance hits $X
  FIXED_AMOUNT = 'FIXED_AMOUNT', // Convert fixed amount on schedule
  DCA = 'DCA',                   // Dollar cost averaging
  REBALANCE = 'REBALANCE'        // Maintain BTC/AUD allocation
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum WithdrawalStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING', 
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export interface Integration {
  id: string;
  type: IntegrationType;
  provider: string;
  isActive: boolean;
  
  // OAuth Credentials (encrypted)
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  
  // Provider-specific settings
  settings: Record<string, any>;
  
  // Webhook Configuration
  webhookUrl?: string;
  webhookSecret?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface TreasuryRule {
  id: string;
  name: string;
  isActive: boolean;
  
  // Rule Configuration
  ruleType: RuleType;
  conversionPercentage?: number;
  thresholdAmount?: number;
  fixedAmount?: number;
  
  // Conditions
  minTransactionAmount?: number;
  maxTransactionAmount?: number;
  
  // Advanced Settings (Pro/Enterprise)
  cashFloor?: number;           // Minimum AUD to maintain
  btcAllocationMin?: number;    // Min % in BTC
  btcAllocationMax?: number;    // Max % in BTC
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  integrationId?: string;
  
  // Transaction Details
  externalId: string;      // ID from payment provider
  amount: number;          // Amount in AUD
  currency: string;
  description?: string;
  
  // Processing Status
  status: TransactionStatus;
  processedAt?: Date;
  
  // Bitcoin Conversion
  shouldConvert: boolean;
  conversionAmount?: number;   // Amount to convert to BTC
  conversionFee?: number;      // Platform fee
  
  // Provider Details
  provider: string;            // stripe, paypal, etc.
  providerData?: Record<string, any>;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface BitcoinPurchase {
  id: string;
  transactionId: string;
  
  // Purchase Details
  audAmount: number;           // AUD spent
  btcAmount: number;          // BTC received
  exchangeRate: number;       // BTC/AUD rate at purchase
  exchangeFee: number;        // Exchange fee
  platformFee: number;        // LIQUID ABT fee
  
  // Exchange Details
  exchange: string;           // kraken, zerocap, etc.
  exchangeOrderId?: string;   // Order ID from exchange
  
  // Custody
  customerWallet: string;     // Customer's Bitcoin address
  withdrawalTxId?: string;    // Bitcoin withdrawal transaction ID
  withdrawalStatus: WithdrawalStatus;
  
  // Timestamps
  purchasedAt: Date;
  withdrawnAt?: Date;
}

// Subscription tier limits configuration
export const SUBSCRIPTION_LIMITS = {
  [SubscriptionTier.FREE]: {
    monthlyVolumeLimit: 50000,    // $50K
    dailyVolumeLimit: 5000,       // $5K
    maxTransactionLimit: 1000,    // $1K
    maxUsers: 2,
    maxIntegrations: 2,
    feePercent: 1.25
  },
  [SubscriptionTier.GROWTH]: {
    monthlyVolumeLimit: 500000,   // $500K
    dailyVolumeLimit: 50000,      // $50K
    maxTransactionLimit: 10000,   // $10K
    maxUsers: 10,
    maxIntegrations: 10,
    feePercent: 0.55
  },
  [SubscriptionTier.PRO]: {
    monthlyVolumeLimit: 5000000,  // $5M
    dailyVolumeLimit: 500000,     // $500K
    maxTransactionLimit: 100000,  // $100K
    maxUsers: -1,                 // Unlimited
    maxIntegrations: -1,          // Unlimited
    feePercent: 0.5
  },
  [SubscriptionTier.ENTERPRISE]: {
    monthlyVolumeLimit: -1,       // Unlimited
    dailyVolumeLimit: -1,         // Unlimited
    maxTransactionLimit: -1,      // Unlimited
    maxUsers: -1,                 // Unlimited
    maxIntegrations: -1,          // Unlimited
    feePercent: 0.2
  }
} as const;