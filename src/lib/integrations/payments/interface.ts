// LIQUID ABT - Payment Processor Interface (for easy swapping)

export interface PaymentProcessor {
  name: string;
  type: PaymentProcessorType;
  
  // Connection Management
  initiateOAuth(): Promise<OAuthResult>;
  handleOAuthCallback(code: string, state: string): Promise<ConnectionResult>;
  
  // Transaction Processing
  handleWebhook(payload: any, signature?: string): Promise<Transaction[]>;
  getTransactions(since: Date): Promise<Transaction[]>;
  
  // Account Management
  getAccountInfo(): Promise<AccountInfo>;
  disconnectAccount(): Promise<void>;
  
  // Refund/Cancellation
  refund?(transactionId: string, amount?: number): Promise<RefundResult>;
}

export type PaymentProcessorType = 'stripe' | 'paypal' | 'square' | 'shopify' | 'tyro';

export interface OAuthResult {
  authUrl: string;
  state: string;
  method: 'oauth2' | 'api_key' | 'manual';
}

export interface ConnectionResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  accountId?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface Transaction {
  id: string;
  externalId: string;
  amount: number;
  currency: string;
  description?: string;
  status: TransactionStatus;
  createdAt: Date;
  processedAt?: Date;
  
  // Customer information
  customerEmail?: string;
  customerName?: string;
  
  // Payment method
  paymentMethod?: string;
  
  // Metadata from provider
  metadata?: Record<string, any>;
  rawData?: any; // Full provider response
}

export interface AccountInfo {
  id: string;
  email: string;
  businessName?: string;
  country: string;
  currency: string;
  isActive: boolean;
  capabilities?: string[];
}

export interface RefundResult {
  id: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed';
  reason?: string;
}

export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded'
}

// Factory for creating payment processors
export class PaymentProcessorFactory {
  static create(type: PaymentProcessorType, credentials: any): PaymentProcessor {
    switch (type) {
      case 'stripe':
        return new StripeProcessor(credentials);
      case 'paypal':
        throw new Error('PayPal integration not yet implemented');
      case 'square':
        throw new Error('Square integration not yet implemented');
      case 'shopify':
        throw new Error('Shopify integration not yet implemented');
      case 'tyro':
        throw new Error('Tyro integration not yet implemented');
      default:
        throw new Error(`Unknown payment processor type: ${type}`);
    }
  }
}

// This will be imported from the specific implementations
declare class StripeProcessor implements PaymentProcessor {
  name: string;
  type: PaymentProcessorType;
  
  constructor(credentials: any);
  
  initiateOAuth(): Promise<OAuthResult>;
  handleOAuthCallback(code: string, state: string): Promise<ConnectionResult>;
  handleWebhook(payload: any, signature?: string): Promise<Transaction[]>;
  getTransactions(since: Date): Promise<Transaction[]>;
  getAccountInfo(): Promise<AccountInfo>;
  disconnectAccount(): Promise<void>;
  refund(transactionId: string, amount?: number): Promise<RefundResult>;
}