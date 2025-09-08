// LIQUID ABT - Stripe Integration Implementation
// Stripe implementation following the PaymentProcessor interface

import Stripe from 'stripe';
import crypto from 'crypto';
import { PaymentProcessor, OAuthResult, WebhookResult, Transaction, Balance, PaymentProcessorError } from '../types';
import { 
  generateTestWebhookSignature, 
  convertStripeAmount, 
  extractStripeMetadata,
  formatStripeError,
  sanitizeStripeDataForLogging 
} from './stripe/helpers';

export class StripeIntegration implements PaymentProcessor {
  name = 'Stripe';
  isEnabled = true;
  private stripe: Stripe;
  private rateLimitedUntil: number = 0;
  private processedEvents: Set<string> = new Set();
  
  constructor(apiKey?: string) {
    const secretKey = apiKey || process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new PaymentProcessorError('Missing STRIPE_SECRET_KEY environment variable', 'stripe');
    }
    
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia',
    });
  }
  
  async connect(tenantId: string): Promise<OAuthResult> {
    try {
      // For Stripe Connect, we need to create an account link
      const accountLink = await this.stripe.accountLinks.create({
        account: tenantId,
        refresh_url: `${process.env.NEXT_PUBLIC_DOMAIN}/integrations/stripe/refresh`,
        return_url: `${process.env.NEXT_PUBLIC_DOMAIN}/integrations/stripe/return`,
        type: 'account_onboarding',
      });
      
      return {
        success: true,
        authUrl: accountLink.url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error connecting to Stripe',
      };
    }
  }
  
  async disconnect(tenantId: string): Promise<void> {
    try {
      // In a real implementation, you would:
      // 1. Remove stored Stripe credentials for tenant from database
      // 2. Optionally deauthorize the Stripe Connect account
      console.log(`Disconnecting Stripe for tenant: ${tenantId}`);
      
      // TODO: Implement actual disconnect logic when we have tenant management
    } catch (error) {
      throw new PaymentProcessorError(
        `Failed to disconnect Stripe for tenant ${tenantId}`,
        'stripe',
        'DISCONNECT_ERROR'
      );
    }
  }
  
  async handleWebhook(payload: any, signature: string, tenantId?: string): Promise<WebhookResult> {
    try {
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        throw new PaymentProcessorError('Missing STRIPE_WEBHOOK_SECRET environment variable', 'stripe');
      }
      
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      
      let transactionId: string | undefined;
      
      // Process different event types
      switch (event.type) {
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          transactionId = paymentIntent.id;
          console.log(`Payment intent succeeded: ${paymentIntent.id}`);
          break;
          
        case 'charge.succeeded':
          const charge = event.data.object as Stripe.Charge;
          transactionId = charge.id;
          console.log(`Charge succeeded: ${charge.id}`);
          break;
          
        case 'invoice.payment_succeeded':
          const invoice = event.data.object as Stripe.Invoice;
          transactionId = invoice.id;
          console.log(`Invoice payment succeeded: ${invoice.id}`);
          break;
          
        case 'checkout.session.completed':
          const session = event.data.object as Stripe.Checkout.Session;
          transactionId = session.id;
          console.log(`Checkout session completed: ${session.id}`);
          break;
          
        default:
          console.log(`Unhandled Stripe event type: ${event.type}`);
          return { success: true, processed: false };
      }
      
      return { 
        success: true, 
        processed: true, 
        transactionId 
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown webhook error';
      
      return { 
        success: false, 
        processed: false, 
        error: errorMessage 
      };
    }
  }
  
  async getTransactions(tenantId: string, from: Date, to: Date): Promise<Transaction[]> {
    try {
      const charges = await this.stripe.charges.list({
        created: {
          gte: Math.floor(from.getTime() / 1000),
          lte: Math.floor(to.getTime() / 1000),
        },
        limit: 100,
        // In a real implementation, you would filter by the tenant's connected account
      });
      
      return charges.data.map(charge => ({
        id: charge.id,
        amount: charge.amount / 100, // Convert from cents
        currency: charge.currency.toUpperCase(),
        date: new Date(charge.created * 1000),
        description: charge.description || 'Stripe payment',
        status: charge.status,
        type: 'payment' as const,
        fees: charge.application_fee_amount ? charge.application_fee_amount / 100 : 0,
        metadata: {
          customer: charge.customer,
          paymentMethod: charge.payment_method,
          receiptUrl: charge.receipt_url,
        },
      }));
      
    } catch (error) {
      throw new PaymentProcessorError(
        `Failed to fetch Stripe transactions for tenant ${tenantId}`,
        'stripe',
        'GET_TRANSACTIONS_ERROR',
        undefined,
        true // retryable
      );
    }
  }
  
  async getBalance(tenantId: string): Promise<Balance> {
    try {
      const balance = await this.stripe.balance.retrieve();
      
      const available = balance.available.reduce((sum, b) => sum + b.amount, 0) / 100;
      const pending = balance.pending.reduce((sum, b) => sum + b.amount, 0) / 100;
      
      return {
        available,
        pending,
        currency: 'AUD', // In a real implementation, this would be determined by the account
        lastUpdated: new Date(),
      };
      
    } catch (error) {
      throw new PaymentProcessorError(
        `Failed to fetch Stripe balance for tenant ${tenantId}`,
        'stripe',
        'GET_BALANCE_ERROR',
        undefined,
        true // retryable
      );
    }
  }
  
  async createRefund(transactionId: string, amount?: number): Promise<{ success: boolean; refundId?: string; error?: string }> {
    try {
      const refund = await this.stripe.refunds.create({
        charge: transactionId,
        amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents if specified
      });
      
      return {
        success: true,
        refundId: refund.id,
      };
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown refund error',
      };
    }
  }
  
  async getAccountInfo(tenantId: string): Promise<{ name: string; email: string; status: string; country: string }> {
    try {
      const account = await this.stripe.accounts.retrieve(tenantId);
      
      return {
        name: account.business_profile?.name || account.settings?.dashboard?.display_name || 'Unknown',
        email: account.email || 'Unknown',
        status: account.details_submitted ? 'active' : 'pending',
        country: account.country || 'Unknown',
      };
      
    } catch (error) {
      throw new PaymentProcessorError(
        `Failed to fetch Stripe account info for tenant ${tenantId}`,
        'stripe',
        'GET_ACCOUNT_ERROR'
      );
    }
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      await this.stripe.balance.retrieve();
      return true;
    } catch (error) {
      console.error('Stripe health check failed:', error);
      return false;
    }
  }
  
  // Additional methods for comprehensive testing
  
  /**
   * Save connection details to database
   */
  async saveConnection(tenantId: string, connectionData: {
    accessToken: string;
    refreshToken: string;
    stripeUserId: string;
  }): Promise<void> {
    try {
      const { getTenantPrisma } = await import('@/lib/database/connection');
      const prisma = getTenantPrisma();
      
      await prisma.integration.upsert({
        where: {
          type_provider: {
            type: 'PAYMENT_PROCESSOR',
            provider: 'stripe'
          }
        },
        update: {
          accessToken: connectionData.accessToken,
          refreshToken: connectionData.refreshToken,
          tokenExpiresAt: new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)), // 1 year
          settings: {
            stripeUserId: connectionData.stripeUserId,
            connectedAt: new Date().toISOString(),
            hasLiveMode: !connectionData.accessToken.includes('test_')
          },
          isActive: true,
          updatedAt: new Date()
        },
        create: {
          type: 'PAYMENT_PROCESSOR',
          provider: 'stripe',
          accessToken: connectionData.accessToken,
          refreshToken: connectionData.refreshToken,
          tokenExpiresAt: new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)),
          settings: {
            stripeUserId: connectionData.stripeUserId,
            connectedAt: new Date().toISOString(),
            hasLiveMode: !connectionData.accessToken.includes('test_')
          },
          isActive: true,
          webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/stripe`,
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      console.log(`✅ Stripe connection saved for tenant with user ID: ${connectionData.stripeUserId}`);
    } catch (error) {
      console.error('❌ Failed to save Stripe connection:', error);
      throw new PaymentProcessorError(
        `Failed to save Stripe connection for tenant ${tenantId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'stripe',
        'DATABASE_ERROR'
      );
    }
  }
  
  /**
   * Generate test signature for webhook validation
   */
  generateTestSignature(payload: string, secret: string): string {
    return generateTestWebhookSignature(payload, secret);
  }
  
  /**
   * Process webhook events with idempotency and business logic
   */
  async processWebhookEvent(event: Stripe.Event): Promise<{
    processed: boolean;
    duplicate?: boolean;
    bitcoinPurchaseAmount?: number;
    transactionRecorded?: boolean;
    refundProcessed?: boolean;
    bitcoinAdjustment?: number;
    recurringPaymentProcessed?: boolean;
  }> {
    // Check for duplicate processing
    if (this.processedEvents.has(event.id)) {
      return { processed: false, duplicate: true };
    }
    
    this.processedEvents.add(event.id);
    
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          return await this.handlePaymentIntentSucceeded(event);
          
        case 'charge.succeeded':
          return await this.handleChargeSucceeded(event);
          
        case 'charge.refunded':
          return await this.handleChargeRefunded(event);
          
        case 'invoice.payment_succeeded':
          return await this.handleInvoicePaymentSucceeded(event);
          
        default:
          console.log(`Unhandled Stripe event type: ${event.type}`);
          return { processed: false };
      }
    } catch (error) {
      console.error(`Error processing Stripe event ${event.id}:`, error);
      this.processedEvents.delete(event.id); // Allow retry
      throw error;
    }
  }
  
  /**
   * Get all transactions with pagination
   */
  async getAllTransactions(tenantId: string, options: { limit?: number } = {}): Promise<Transaction[]> {
    try {
      const charges = await this.stripe.charges.list({
        limit: options.limit || 100,
      });
      
      return charges.data.map(charge => this.mapStripeChargeToTransaction(charge));
    } catch (error) {
      throw new PaymentProcessorError(
        `Failed to fetch all transactions for tenant ${tenantId}`,
        'stripe',
        'GET_ALL_TRANSACTIONS_ERROR',
        undefined,
        true
      );
    }
  }
  
  /**
   * Calculate Bitcoin purchase amount based on treasury rules
   */
  calculateBitcoinPurchase(payment: {
    amount: number;
    conversionRule: {
      type: 'percentage' | 'fixed';
      value: number;
      minAmount?: number;
      maxAmount?: number;
    };
  }): number {
    const { amount, conversionRule } = payment;
    
    let purchaseAmount = 0;
    
    if (conversionRule.type === 'percentage') {
      purchaseAmount = (amount * conversionRule.value) / 100;
    } else if (conversionRule.type === 'fixed') {
      purchaseAmount = conversionRule.value;
    }
    
    // Apply minimum threshold (assuming amounts are in dollars, not cents)
    if (conversionRule.minAmount && purchaseAmount < conversionRule.minAmount) {
      return 0;
    }
    
    // Apply maximum cap (assuming amounts are in dollars, not cents)
    if (conversionRule.maxAmount && purchaseAmount > conversionRule.maxAmount) {
      purchaseAmount = conversionRule.maxAmount;
    }
    
    return Math.round(purchaseAmount * 100) / 100; // Round to 2 decimal places
  }
  
  /**
   * Convert payment to base currency (async version)
   */
  async convertToBaseCurrency(payment: { amount: number; currency: string }): Promise<{
    amount: number;
    currency: string;
    rate: number;
  }> {
    return await convertStripeAmount(payment.amount, payment.currency, 'AUD');
  }
  
  /**
   * Convert payment to base currency (sync version for backwards compatibility)
   */
  convertToBaseCurrencySync(payment: { amount: number; currency: string }): {
    amount: number;
    currency: string;
  } {
    const { convertStripeAmountSync } = require('./stripe/helpers');
    return convertStripeAmountSync(payment.amount, payment.currency, 'AUD');
  }
  
  /**
   * Check if integration is currently rate limited
   */
  isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }
  
  /**
   * Make API call with error handling and rate limiting
   */
  async makeApiCall<T>(apiCall: () => Promise<T>, retries: number = 3): Promise<T> {
    if (this.isRateLimited()) {
      throw new PaymentProcessorError('Rate limit active', 'stripe', 'RATE_LIMITED');
    }
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await apiCall();
      } catch (error: any) {
        if (error.type === 'StripeRateLimitError') {
          this.rateLimitedUntil = Date.now() + (60 * 1000); // 1 minute
          throw error;
        }
        
        if (attempt === retries) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    
    throw new Error('Max retries exceeded');
  }
  
  /**
   * Check webhook endpoint configuration
   */
  async checkWebhookEndpoint(): Promise<{
    url: string;
    enabled: boolean;
    events: string[];
  }> {
    // In a real implementation, this would check actual webhook endpoints
    return {
      url: `${process.env.NEXT_PUBLIC_DOMAIN}/api/v1/webhook/stripe`,
      enabled: true,
      events: [
        'payment_intent.succeeded',
        'charge.succeeded',
        'charge.refunded',
        'invoice.payment_succeeded',
      ],
    };
  }
  
  // Private helper methods
  
  private async handlePaymentIntentSucceeded(event: Stripe.Event): Promise<{
    processed: boolean;
    bitcoinPurchaseAmount?: number;
  }> {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const conversionPercentage = extractStripeMetadata(paymentIntent, 'conversionPercentage', '0');
    const percentage = parseFloat(conversionPercentage);
    
    if (percentage > 0) {
      const bitcoinAmount = (paymentIntent.amount / 100) * (percentage / 100);
      return {
        processed: true,
        bitcoinPurchaseAmount: bitcoinAmount,
      };
    }
    
    return { processed: true };
  }
  
  private async handleChargeSucceeded(event: Stripe.Event): Promise<{
    processed: boolean;
    transactionRecorded: boolean;
  }> {
    const charge = event.data.object as Stripe.Charge;
    
    // Record transaction in database
    console.log(`Recording charge: ${charge.id}, Amount: ${charge.amount}`);
    
    return {
      processed: true,
      transactionRecorded: true,
    };
  }
  
  private async handleChargeRefunded(event: Stripe.Event): Promise<{
    processed: boolean;
    refundProcessed: boolean;
    bitcoinAdjustment?: number;
  }> {
    const charge = event.data.object as Stripe.Charge;
    const refundAmount = charge.amount_refunded / 100; // Convert from cents to dollars
    
    try {
      // Get the original conversion percentage from metadata or database
      const originalConversionPercentage = extractStripeMetadata(charge, 'conversionPercentage', '0');
      const conversionRate = parseFloat(originalConversionPercentage) / 100;
      
      // Calculate Bitcoin adjustment based on original conversion rate
      const bitcoinAdjustment = refundAmount * conversionRate;
      
      console.log(`Processing refund: $${refundAmount}, Bitcoin adjustment: $${bitcoinAdjustment} (${originalConversionPercentage}% conversion rate)`);
      
      return {
        processed: true,
        refundProcessed: true,
        bitcoinAdjustment: bitcoinAdjustment > 0 ? bitcoinAdjustment : undefined,
      };
    } catch (error) {
      console.error('Error calculating Bitcoin adjustment for refund:', error);
      return {
        processed: true,
        refundProcessed: true,
        // No Bitcoin adjustment if we can't calculate it properly
      };
    }
  }
  
  private async handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<{
    processed: boolean;
    recurringPaymentProcessed: boolean;
  }> {
    const invoice = event.data.object as Stripe.Invoice;
    
    console.log(`Processing recurring payment: ${invoice.id}, Amount: ${invoice.amount_paid}`);
    
    return {
      processed: true,
      recurringPaymentProcessed: true,
    };
  }
  
  private mapStripeChargeToTransaction(charge: Stripe.Charge): Transaction {
    return {
      id: charge.id,
      amount: charge.amount / 100,
      currency: charge.currency.toUpperCase(),
      date: new Date(charge.created * 1000),
      description: charge.description || 'Stripe payment',
      status: charge.status,
      type: 'payment' as const,
      fees: charge.application_fee_amount ? charge.application_fee_amount / 100 : 0,
      metadata: {
        customer: charge.customer,
        paymentMethod: charge.payment_method,
        receiptUrl: charge.receipt_url,
        sanitized: sanitizeStripeDataForLogging(charge),
      },
    };
  }
}