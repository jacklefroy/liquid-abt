// LIQUID ABT - Stripe Connect Integration

import Stripe from 'stripe';
import { 
  PaymentProcessor, 
  PaymentProcessorType,
  OAuthResult,
  ConnectionResult,
  Transaction,
  AccountInfo,
  RefundResult,
  TransactionStatus
} from './interface';

export class StripeProcessor implements PaymentProcessor {
  public readonly name = 'Stripe';
  public readonly type: PaymentProcessorType = 'stripe';
  
  private stripe: Stripe;
  private clientId: string;
  private webhookSecret: string;
  private accessToken?: string;
  private accountId?: string;

  constructor(credentials: {
    secretKey?: string;
    clientId?: string;
    webhookSecret?: string;
    accessToken?: string;
    accountId?: string;
  }) {
    this.stripe = new Stripe(credentials.secretKey || process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
    });
    
    this.clientId = credentials.clientId || process.env.STRIPE_CLIENT_ID!;
    this.webhookSecret = credentials.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET!;
    this.accessToken = credentials.accessToken;
    this.accountId = credentials.accountId;

    if (!this.clientId) {
      throw new Error('Stripe client ID is required for Connect integration');
    }
  }

  /**
   * Initiate Stripe Connect OAuth flow
   */
  async initiateOAuth(): Promise<OAuthResult> {
    const state = this.generateSecureState();
    
    const authUrl = `https://connect.stripe.com/express/oauth/authorize?` +
      `client_id=${this.clientId}&` +
      `state=${state}&` +
      `stripe_user[business_type]=company&` +
      `stripe_user[country]=AU&` +
      `stripe_user[currency]=aud&` +
      `suggested_capabilities[]=transfers&` +
      `suggested_capabilities[]=card_payments`;

    return {
      authUrl,
      state,
      method: 'oauth2'
    };
  }

  /**
   * Handle OAuth callback from Stripe
   */
  async handleOAuthCallback(code: string, state: string): Promise<ConnectionResult> {
    try {
      // Exchange authorization code for access token
      const response = await this.stripe.oauth.token({
        grant_type: 'authorization_code',
        code: code,
      });

      this.accessToken = response.access_token;
      this.accountId = response.stripe_user_id;

      // Get account information to verify connection
      const account = await this.stripe.accounts.retrieve(this.accountId!);

      return {
        success: true,
        accessToken: this.accessToken,
        accountId: this.accountId,
        metadata: {
          businessName: account.business_profile?.name || account.display_name,
          email: account.email,
          country: account.country,
          capabilities: Object.keys(account.capabilities || {}),
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled
        }
      };
    } catch (error) {
      console.error('Stripe OAuth callback error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect Stripe account'
      };
    }
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(payload: any, signature?: string): Promise<Transaction[]> {
    if (!signature || !this.webhookSecret) {
      throw new Error('Webhook signature verification failed');
    }

    try {
      // Verify webhook signature
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret
      );

      const transactions: Transaction[] = [];

      // Process different event types
      switch (event.type) {
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          transactions.push(this.convertPaymentIntentToTransaction(paymentIntent));
          break;

        case 'invoice.payment_succeeded':
          const invoice = event.data.object as Stripe.Invoice;
          transactions.push(this.convertInvoiceToTransaction(invoice));
          break;

        case 'checkout.session.completed':
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.payment_status === 'paid') {
            transactions.push(await this.convertCheckoutSessionToTransaction(session));
          }
          break;

        default:
          console.log(`Unhandled Stripe event type: ${event.type}`);
      }

      return transactions;
    } catch (error) {
      console.error('Stripe webhook processing error:', error);
      throw new Error('Failed to process Stripe webhook');
    }
  }

  /**
   * Get transactions from Stripe
   */
  async getTransactions(since: Date): Promise<Transaction[]> {
    if (!this.accountId) {
      throw new Error('Stripe account not connected');
    }

    try {
      const charges = await this.stripe.charges.list({
        created: { gte: Math.floor(since.getTime() / 1000) },
        limit: 100,
      }, {
        stripeAccount: this.accountId
      });

      return charges.data.map(charge => this.convertChargeToTransaction(charge));
    } catch (error) {
      console.error('Failed to fetch Stripe transactions:', error);
      throw error;
    }
  }

  /**
   * Get Stripe account information
   */
  async getAccountInfo(): Promise<AccountInfo> {
    if (!this.accountId) {
      throw new Error('Stripe account not connected');
    }

    try {
      const account = await this.stripe.accounts.retrieve(this.accountId);

      return {
        id: account.id,
        email: account.email!,
        businessName: account.business_profile?.name || account.display_name,
        country: account.country!,
        currency: account.default_currency || 'aud',
        isActive: account.charges_enabled && !account.requirements?.currently_due?.length,
        capabilities: Object.keys(account.capabilities || {})
      };
    } catch (error) {
      console.error('Failed to get Stripe account info:', error);
      throw error;
    }
  }

  /**
   * Disconnect Stripe account
   */
  async disconnectAccount(): Promise<void> {
    if (!this.clientId || !this.accountId) {
      throw new Error('Cannot disconnect: missing client ID or account ID');
    }

    try {
      await this.stripe.oauth.deauthorize({
        client_id: this.clientId,
        stripe_user_id: this.accountId
      });

      this.accessToken = undefined;
      this.accountId = undefined;
    } catch (error) {
      console.error('Failed to disconnect Stripe account:', error);
      throw error;
    }
  }

  /**
   * Refund a Stripe transaction
   */
  async refund(transactionId: string, amount?: number): Promise<RefundResult> {
    try {
      const refund = await this.stripe.refunds.create(
        {
          charge: transactionId,
          amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents
        },
        this.accountId ? { stripeAccount: this.accountId } : undefined
      );

      return {
        id: refund.id,
        amount: refund.amount / 100, // Convert from cents
        status: refund.status as 'pending' | 'succeeded' | 'failed',
        reason: refund.reason || undefined
      };
    } catch (error) {
      console.error('Stripe refund error:', error);
      throw error;
    }
  }

  // Private helper methods

  private generateSecureState(): string {
    return Buffer.from(Math.random().toString(36) + Date.now().toString(36)).toString('base64');
  }

  private convertChargeToTransaction(charge: Stripe.Charge): Transaction {
    return {
      id: charge.id,
      externalId: charge.id,
      amount: charge.amount / 100, // Convert from cents to AUD
      currency: charge.currency.toUpperCase(),
      description: charge.description || `Stripe charge ${charge.id}`,
      status: this.convertStripeStatus(charge.status),
      createdAt: new Date(charge.created * 1000),
      processedAt: charge.status === 'succeeded' ? new Date(charge.created * 1000) : undefined,
      customerEmail: charge.billing_details?.email || undefined,
      customerName: charge.billing_details?.name || undefined,
      paymentMethod: charge.payment_method_details?.type || 'card',
      metadata: charge.metadata,
      rawData: charge
    };
  }

  private convertPaymentIntentToTransaction(paymentIntent: Stripe.PaymentIntent): Transaction {
    return {
      id: paymentIntent.id,
      externalId: paymentIntent.id,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency.toUpperCase(),
      description: paymentIntent.description || `Payment ${paymentIntent.id}`,
      status: this.convertStripeStatus(paymentIntent.status),
      createdAt: new Date(paymentIntent.created * 1000),
      processedAt: paymentIntent.status === 'succeeded' ? new Date() : undefined,
      customerEmail: paymentIntent.receipt_email || undefined,
      metadata: paymentIntent.metadata,
      rawData: paymentIntent
    };
  }

  private convertInvoiceToTransaction(invoice: Stripe.Invoice): Transaction {
    return {
      id: invoice.id,
      externalId: invoice.id,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency.toUpperCase(),
      description: `Invoice ${invoice.number || invoice.id}`,
      status: TransactionStatus.SUCCEEDED,
      createdAt: new Date(invoice.created * 1000),
      processedAt: new Date(invoice.status_transitions.paid_at! * 1000),
      customerEmail: invoice.customer_email || undefined,
      metadata: invoice.metadata,
      rawData: invoice
    };
  }

  private async convertCheckoutSessionToTransaction(session: Stripe.Checkout.Session): Transaction {
    // Fetch payment intent for more details
    let paymentIntent: Stripe.PaymentIntent | undefined;
    if (session.payment_intent && typeof session.payment_intent === 'string') {
      try {
        paymentIntent = await this.stripe.paymentIntents.retrieve(session.payment_intent);
      } catch (error) {
        console.error('Failed to fetch payment intent for checkout session:', error);
      }
    }

    return {
      id: session.id,
      externalId: session.id,
      amount: (session.amount_total || 0) / 100,
      currency: (session.currency || 'aud').toUpperCase(),
      description: `Checkout ${session.id}`,
      status: TransactionStatus.SUCCEEDED,
      createdAt: new Date(session.created * 1000),
      processedAt: new Date(),
      customerEmail: session.customer_details?.email || undefined,
      customerName: session.customer_details?.name || undefined,
      paymentMethod: paymentIntent?.payment_method_details?.type || 'unknown',
      metadata: session.metadata || {},
      rawData: session
    };
  }

  private convertStripeStatus(stripeStatus: string): TransactionStatus {
    const statusMap: Record<string, TransactionStatus> = {
      'pending': TransactionStatus.PENDING,
      'requires_payment_method': TransactionStatus.PENDING,
      'requires_confirmation': TransactionStatus.PENDING,
      'requires_action': TransactionStatus.PENDING,
      'processing': TransactionStatus.PROCESSING,
      'succeeded': TransactionStatus.SUCCEEDED,
      'failed': TransactionStatus.FAILED,
      'canceled': TransactionStatus.CANCELLED,
      'requires_capture': TransactionStatus.PROCESSING,
    };

    return statusMap[stripeStatus] || TransactionStatus.PENDING;
  }
}