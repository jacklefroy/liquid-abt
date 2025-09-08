// LIQUID ABT - Stripe Integration Tests
// Comprehensive integration testing for Stripe payment processing

import { StripeIntegration } from '../../../stripe';
import { createMockWebhookEvent, generateMockStripeCharge, generateStripeWebhookSignature } from '../../../../../../../__tests__/helpers';
import Stripe from 'stripe';

// Mock Stripe SDK
jest.mock('stripe');

describe('Stripe Integration - Integration Tests', () => {
  let stripeIntegration: StripeIntegration;
  let mockStripe: jest.Mocked<Stripe>;
  const testApiKey = 'sk_test_123456789';
  const testTenantId = 'tenant_test_123';
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock Stripe constructor and methods
    mockStripe = {
      accountLinks: {
        create: jest.fn(),
      },
      webhooks: {
        constructEvent: jest.fn(),
      },
      charges: {
        list: jest.fn(),
      },
      balance: {
        retrieve: jest.fn(),
      },
      refunds: {
        create: jest.fn(),
      },
      accounts: {
        retrieve: jest.fn(),
      },
    } as any;
    
    (Stripe as jest.MockedClass<typeof Stripe>).mockImplementation(() => mockStripe);
    
    stripeIntegration = new StripeIntegration(testApiKey);
  });

  describe('OAuth Connection Flow', () => {
    it('should create account link for Stripe Connect', async () => {
      const mockAccountLink = {
        url: 'https://connect.stripe.com/setup/s/acct_123',
      };
      
      mockStripe.accountLinks.create.mockResolvedValue(mockAccountLink as any);
      
      const result = await stripeIntegration.connect(testTenantId);
      
      expect(result.success).toBe(true);
      expect(result.authUrl).toBe(mockAccountLink.url);
      expect(mockStripe.accountLinks.create).toHaveBeenCalledWith({
        account: testTenantId,
        refresh_url: `${process.env.NEXT_PUBLIC_DOMAIN}/integrations/stripe/refresh`,
        return_url: `${process.env.NEXT_PUBLIC_DOMAIN}/integrations/stripe/return`,
        type: 'account_onboarding',
      });
    });

    it('should handle connection errors gracefully', async () => {
      const error = new Error('Account not found');
      mockStripe.accountLinks.create.mockRejectedValue(error);
      
      const result = await stripeIntegration.connect(testTenantId);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe(error.message);
    });
  });

  describe('Webhook Processing', () => {
    const webhookSecret = 'whsec_test123';
    const payload = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_123' } } });
    const signature = 't=1234567890,v1=signature';
    
    beforeEach(() => {
      process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    });

    it('should process payment_intent.succeeded webhook', async () => {
      const mockEvent = createMockWebhookEvent('payment_intent.succeeded', {
        id: 'pi_123',
        amount: 10000,
        metadata: { conversionPercentage: '5' },
      });
      
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      
      const result = await stripeIntegration.handleWebhook(payload, signature);
      
      expect(result.success).toBe(true);
      expect(result.processed).toBe(true);
      expect(result.transactionId).toBe('pi_123');
    });

    it('should process charge.succeeded webhook', async () => {
      const mockEvent = createMockWebhookEvent('charge.succeeded', {
        id: 'ch_123',
        amount: 10000,
      });
      
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      
      const result = await stripeIntegration.handleWebhook(payload, signature);
      
      expect(result.success).toBe(true);
      expect(result.processed).toBe(true);
      expect(result.transactionId).toBe('ch_123');
    });

    it('should handle unhandled event types', async () => {
      const mockEvent = createMockWebhookEvent('customer.created', { id: 'cus_123' });
      
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      
      const result = await stripeIntegration.handleWebhook(payload, signature);
      
      expect(result.success).toBe(true);
      expect(result.processed).toBe(false);
    });

    it('should handle webhook signature verification failures', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });
      
      const result = await stripeIntegration.handleWebhook(payload, signature);
      
      expect(result.success).toBe(false);
      expect(result.processed).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });

    it('should handle missing webhook secret', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      
      const result = await stripeIntegration.handleWebhook(payload, signature);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing STRIPE_WEBHOOK_SECRET');
    });
  });

  describe('Transaction Management', () => {
    it('should fetch transactions for date range', async () => {
      const fromDate = new Date('2025-01-01');
      const toDate = new Date('2025-01-31');
      const mockCharges = {
        data: [
          generateMockStripeCharge({
            id: 'ch_123',
            amount: 10000,
            currency: 'aud',
          }),
        ],
      };
      
      mockStripe.charges.list.mockResolvedValue(mockCharges as any);
      
      const transactions = await stripeIntegration.getTransactions(testTenantId, fromDate, toDate);
      
      expect(transactions).toHaveLength(1);
      expect(transactions[0].id).toBe('ch_123');
      expect(transactions[0].amount).toBe(100); // Converted from cents
      expect(transactions[0].currency).toBe('AUD');
      expect(mockStripe.charges.list).toHaveBeenCalledWith({
        created: {
          gte: Math.floor(fromDate.getTime() / 1000),
          lte: Math.floor(toDate.getTime() / 1000),
        },
        limit: 100,
      });
    });

    it('should handle transaction fetch errors', async () => {
      const fromDate = new Date('2025-01-01');
      const toDate = new Date('2025-01-31');
      
      mockStripe.charges.list.mockRejectedValue(new Error('API error'));
      
      await expect(
        stripeIntegration.getTransactions(testTenantId, fromDate, toDate)
      ).rejects.toThrow('Failed to fetch Stripe transactions');
    });
  });

  describe('Balance Management', () => {
    it('should retrieve account balance', async () => {
      const mockBalance = {
        available: [{ amount: 50000, currency: 'aud' }],
        pending: [{ amount: 10000, currency: 'aud' }],
      };
      
      mockStripe.balance.retrieve.mockResolvedValue(mockBalance as any);
      
      const balance = await stripeIntegration.getBalance(testTenantId);
      
      expect(balance.available).toBe(500); // Converted from cents
      expect(balance.pending).toBe(100);
      expect(balance.currency).toBe('AUD');
    });

    it('should handle balance fetch errors', async () => {
      mockStripe.balance.retrieve.mockRejectedValue(new Error('API error'));
      
      await expect(
        stripeIntegration.getBalance(testTenantId)
      ).rejects.toThrow('Failed to fetch Stripe balance');
    });
  });

  describe('Refund Processing', () => {
    it('should create full refund successfully', async () => {
      const mockRefund = { id: 're_123' };
      mockStripe.refunds.create.mockResolvedValue(mockRefund as any);
      
      const result = await stripeIntegration.createRefund('ch_123');
      
      expect(result.success).toBe(true);
      expect(result.refundId).toBe('re_123');
      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        charge: 'ch_123',
        amount: undefined,
      });
    });

    it('should create partial refund successfully', async () => {
      const mockRefund = { id: 're_123' };
      mockStripe.refunds.create.mockResolvedValue(mockRefund as any);
      
      const result = await stripeIntegration.createRefund('ch_123', 50.00);
      
      expect(result.success).toBe(true);
      expect(result.refundId).toBe('re_123');
      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        charge: 'ch_123',
        amount: 5000, // Converted to cents
      });
    });

    it('should handle refund errors', async () => {
      mockStripe.refunds.create.mockRejectedValue(new Error('Charge not found'));
      
      const result = await stripeIntegration.createRefund('ch_123');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Charge not found');
    });
  });

  describe('Account Information', () => {
    it('should retrieve account info successfully', async () => {
      const mockAccount = {
        business_profile: { name: 'Test Business' },
        email: 'test@example.com',
        details_submitted: true,
        country: 'AU',
      };
      
      mockStripe.accounts.retrieve.mockResolvedValue(mockAccount as any);
      
      const accountInfo = await stripeIntegration.getAccountInfo(testTenantId);
      
      expect(accountInfo.name).toBe('Test Business');
      expect(accountInfo.email).toBe('test@example.com');
      expect(accountInfo.status).toBe('active');
      expect(accountInfo.country).toBe('AU');
    });

    it('should handle missing account info gracefully', async () => {
      const mockAccount = {
        business_profile: null,
        email: null,
        details_submitted: false,
        country: null,
      };
      
      mockStripe.accounts.retrieve.mockResolvedValue(mockAccount as any);
      
      const accountInfo = await stripeIntegration.getAccountInfo(testTenantId);
      
      expect(accountInfo.name).toBe('Unknown');
      expect(accountInfo.email).toBe('Unknown');
      expect(accountInfo.status).toBe('pending');
      expect(accountInfo.country).toBe('Unknown');
    });

    it('should handle account info fetch errors', async () => {
      mockStripe.accounts.retrieve.mockRejectedValue(new Error('Account not found'));
      
      await expect(
        stripeIntegration.getAccountInfo(testTenantId)
      ).rejects.toThrow('Failed to fetch Stripe account info');
    });
  });

  describe('Health Check', () => {
    it('should pass health check when API is accessible', async () => {
      const mockBalance = { available: [], pending: [] };
      mockStripe.balance.retrieve.mockResolvedValue(mockBalance as any);
      
      const isHealthy = await stripeIntegration.healthCheck();
      
      expect(isHealthy).toBe(true);
    });

    it('should fail health check when API is not accessible', async () => {
      mockStripe.balance.retrieve.mockRejectedValue(new Error('API error'));
      
      const isHealthy = await stripeIntegration.healthCheck();
      
      expect(isHealthy).toBe(false);
    });
  });

  describe('Advanced Webhook Event Processing', () => {
    it('should process webhook events with business logic', async () => {
      const mockEvent = createMockWebhookEvent('payment_intent.succeeded', {
        id: 'pi_123',
        amount: 10000,
        metadata: { conversionPercentage: '5' },
      });
      
      const result = await stripeIntegration.processWebhookEvent(mockEvent);
      
      expect(result.processed).toBe(true);
      expect(result.bitcoinPurchaseAmount).toBe(5); // 5% of $100
    });

    it('should handle duplicate event processing', async () => {
      const mockEvent = createMockWebhookEvent('payment_intent.succeeded', {
        id: 'pi_123',
      });
      
      // Process the same event twice
      await stripeIntegration.processWebhookEvent(mockEvent);
      const result = await stripeIntegration.processWebhookEvent(mockEvent);
      
      expect(result.processed).toBe(false);
      expect(result.duplicate).toBe(true);
    });

    it('should calculate Bitcoin purchase amounts correctly', async () => {
      const payment = {
        amount: 1000, // $10.00
        conversionRule: {
          type: 'percentage' as const,
          value: 10, // 10%
        },
      };
      
      const bitcoinAmount = stripeIntegration.calculateBitcoinPurchase(payment);
      
      expect(bitcoinAmount).toBe(100); // 10% of $10.00 = $1.00
    });

    it('should respect minimum thresholds', async () => {
      const payment = {
        amount: 500, // $5.00 in cents
        conversionRule: {
          type: 'percentage' as const,
          value: 5, // 5%
          minAmount: 5000, // $50.00 minimum (in cents) - much higher threshold
        },
      };
      
      const bitcoinAmount = stripeIntegration.calculateBitcoinPurchase(payment);
      
      // 5% of $5.00 = $0.25 = 25 cents (0.25 dollars)
      // minAmount/100 = 5000/100 = 50 dollars  
      // purchaseAmount (0.25) < 50, so should return 0
      expect(bitcoinAmount).toBe(0); // Below minimum threshold
    });
  });

  describe('Rate Limiting', () => {
    it('should detect rate limiting status', () => {
      expect(stripeIntegration.isRateLimited()).toBe(false);
    });

    it('should handle rate limited API calls', async () => {
      const mockApiCall = jest.fn().mockRejectedValue({
        type: 'StripeRateLimitError',
        message: 'Rate limit exceeded',
      });
      
      await expect(
        stripeIntegration.makeApiCall(mockApiCall)
      ).rejects.toMatchObject({
        type: 'StripeRateLimitError',
      });
      
      expect(stripeIntegration.isRateLimited()).toBe(true);
    });
  });

  describe('Currency Conversion', () => {
    it('should convert payments to base currency', () => {
      const payment = { amount: 100, currency: 'usd' };
      
      const converted = stripeIntegration.convertToBaseCurrency(payment);
      
      expect(converted.currency).toBe('AUD');
      expect(converted.amount).toBeGreaterThan(100); // USD to AUD conversion
    });
  });

  describe('Webhook Endpoint Configuration', () => {
    it('should return webhook endpoint configuration', async () => {
      const config = await stripeIntegration.checkWebhookEndpoint();
      
      expect(config.enabled).toBe(true);
      expect(config.events).toContain('payment_intent.succeeded');
      expect(config.events).toContain('charge.succeeded');
    });
  });
});