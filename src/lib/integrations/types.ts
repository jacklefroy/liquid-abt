// LIQUID ABT - Integration Types and Interfaces
// Common interfaces that all integrations must implement for scalable architecture

// =====================================================
// Base Types
// =====================================================

export interface OAuthResult {
  success: boolean;
  authUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

export interface WebhookResult {
  success: boolean;
  processed: boolean;
  transactionId?: string;
  error?: string;
}

export interface Transaction {
  id: string;
  amount: number;
  currency: string;
  date: Date;
  description: string;
  status: string;
  type: 'payment' | 'refund' | 'transfer';
  fees?: number;
  metadata?: Record<string, any>;
}

export interface Balance {
  available: number;
  pending: number;
  currency: string;
  lastUpdated?: Date;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance?: number;
}

export interface JournalEntry {
  id?: string;
  date: Date;
  description: string;
  reference?: string;
  lineItems: {
    accountId: string;
    debit?: number;
    credit?: number;
    description?: string;
  }[];
}

export interface TaxReport {
  period: string;
  totalCapitalGains: number;
  totalCapitalLosses: number;
  netCapitalGain: number;
  transactions: BitcoinTransaction[];
  method: 'FIFO' | 'LIFO' | 'WEIGHTED_AVERAGE' | 'SPECIFIC_IDENTIFICATION';
}

export interface BASReport {
  quarter: string;
  gstCollected: number;
  gstPaid: number;
  netGst: number;
  totalSales: number;
  totalPurchases: number;
}

export interface BitcoinTransaction {
  id: string;
  type: 'buy' | 'sell' | 'transfer';
  amount: number;
  bitcoinAmount: number;
  price: number;
  date: Date;
  exchange: string;
  fees: number;
  address?: string;
}

export interface PurchaseResult {
  success: boolean;
  orderId: string;
  amount: number;
  bitcoinAmount: number;
  price: number;
  fees: number;
  status: string;
  estimatedSettlement?: Date;
}

export interface SaleResult {
  success: boolean;
  orderId: string;
  amount: number;
  bitcoinAmount: number;
  price: number;
  fees: number;
  status: string;
  estimatedSettlement?: Date;
}

export interface WithdrawalResult {
  success: boolean;
  withdrawalId: string;
  amount: number;
  address: string;
  fees: number;
  status: string;
  txHash?: string;
  estimatedConfirmation?: Date;
}

export interface MarketStats {
  price: number;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  currency: string;
}

// =====================================================
// Integration Interfaces
// =====================================================

export interface PaymentProcessor {
  name: string;
  isEnabled: boolean;
  
  // OAuth
  connect(tenantId: string): Promise<OAuthResult>;
  disconnect(tenantId: string): Promise<void>;
  
  // Webhooks
  handleWebhook(payload: any, signature: string, tenantId?: string): Promise<WebhookResult>;
  
  // Transactions
  getTransactions(tenantId: string, from: Date, to: Date): Promise<Transaction[]>;
  getBalance(tenantId: string): Promise<Balance>;
  
  // Refunds
  createRefund?(transactionId: string, amount?: number): Promise<{ success: boolean; refundId?: string; error?: string }>;
  
  // Account Management
  getAccountInfo?(tenantId: string): Promise<{ name: string; email: string; status: string; country: string }>;
  
  // Health check
  healthCheck(): Promise<boolean>;
}

export interface AccountingIntegration {
  name: string;
  isEnabled: boolean;
  
  // OAuth
  connect(tenantId: string): Promise<OAuthResult>;
  disconnect(tenantId: string): Promise<void>;
  
  // Journal Entries
  createJournalEntry(tenantId: string, entry: JournalEntry): Promise<{ success: boolean; entryId?: string; error?: string }>;
  
  // Accounts
  getAccounts(tenantId: string): Promise<Account[]>;
  createBitcoinAssetAccount(tenantId: string): Promise<Account>;
  
  // Tax
  calculateCGT(tenantId: string, transactions: BitcoinTransaction[]): Promise<TaxReport>;
  generateBAS(tenantId: string, quarter: string): Promise<BASReport>;
  
  // Health check
  healthCheck(): Promise<boolean>;
}

export interface BitcoinExchange {
  name: string;
  isEnabled: boolean;
  
  // Trading
  buyBitcoin(amount: number, currency: string): Promise<PurchaseResult>;
  sellBitcoin(amount: number, currency: string): Promise<SaleResult>;
  
  // Market Data
  getCurrentPrice(currency: string): Promise<number>;
  get24HourStats(currency?: string): Promise<MarketStats>;
  
  // Order Management
  getOrderStatus?(orderId: string): Promise<{ status: string; executedAt?: Date; error?: string }>;
  getOrderBook?(pair: string): Promise<{ bids: number[][]; asks: number[][] }>;
  
  // Wallet
  withdrawToAddress(address: string, amount: number): Promise<WithdrawalResult>;
  getDepositAddress(): Promise<string>;
  getWithdrawalStatus?(withdrawalId: string): Promise<{ status: string; txHash?: string; confirmations?: number }>;
  
  // Balance
  getBalance(currency?: string): Promise<Balance>;
  
  // Health check
  healthCheck(): Promise<boolean>;
}

export interface ComplianceService {
  name: string;
  isEnabled: boolean;
  
  // Verification
  verifyABN?(abn: string): Promise<{ valid: boolean; entityName?: string; error?: string }>;
  verifyBankAccount?(bsb: string, accountNumber: string): Promise<{ valid: boolean; accountName?: string }>;
  
  // Reporting
  generateAUSTRACReport?(tenantId: string, period: { from: Date; to: Date }): Promise<{ success: boolean; reportId?: string; error?: string }>;
  checkThresholdTransactions?(transactions: Transaction[]): Promise<{ flagged: Transaction[]; totalAmount: number }>;
  
  // Health check
  healthCheck(): Promise<boolean>;
}

// =====================================================
// Integration Configuration
// =====================================================

export interface IntegrationConfig {
  enabled: boolean;
  name: string;
  icon: string;
  description: string;
  requiredEnvVars: string[];
  comingSoon?: string;
  dependencies?: string[];
  category: 'payment' | 'accounting' | 'bitcoin' | 'compliance';
}

export interface IntegrationStatus {
  id: string;
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  healthy: boolean;
  lastHealthCheck?: Date;
  error?: string;
  config: IntegrationConfig;
}

// =====================================================
// Factory Pattern Types
// =====================================================

export interface IntegrationFactory<T> {
  register(name: string, integration: T): void;
  get(name: string): T | undefined;
  getEnabled(): T[];
  getAll(): T[];
  getHealthy(): Promise<T[]>;
}

// =====================================================
// Event Types for Integration Events
// =====================================================

export interface IntegrationEvent {
  type: 'connected' | 'disconnected' | 'webhook_received' | 'transaction_processed' | 'health_check_failed';
  integration: string;
  tenantId?: string;
  timestamp: Date;
  data?: any;
  error?: string;
}

export type IntegrationEventHandler = (event: IntegrationEvent) => Promise<void> | void;

// =====================================================
// Webhook Processing Types
// =====================================================

export interface WebhookConfig {
  endpoint: string;
  secret: string;
  events: string[];
  enabled: boolean;
}

export interface WebhookProcessor {
  validateSignature(payload: string, signature: string, secret: string): boolean;
  processEvent(event: any, integration: string): Promise<WebhookResult>;
}

// =====================================================
// Error Types
// =====================================================

export class IntegrationError extends Error {
  constructor(
    message: string,
    public integration: string,
    public code?: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export class PaymentProcessorError extends IntegrationError {
  constructor(message: string, integration: string, code?: string, statusCode?: number) {
    super(message, integration, code, statusCode);
    this.name = 'PaymentProcessorError';
  }
}

export class BitcoinExchangeError extends IntegrationError {
  constructor(message: string, integration: string, code?: string, statusCode?: number, retryable: boolean = true) {
    super(message, integration, code, statusCode, retryable);
    this.name = 'BitcoinExchangeError';
  }
}

export class AccountingIntegrationError extends IntegrationError {
  constructor(message: string, integration: string, code?: string, statusCode?: number) {
    super(message, integration, code, statusCode);
    this.name = 'AccountingIntegrationError';
  }
}