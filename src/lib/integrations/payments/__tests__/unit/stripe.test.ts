// LIQUID ABT - Stripe Integration Unit Tests

import { StripeProcessor } from '../../stripe';
import { TransactionStatus } from '../../interface';
import Stripe from 'stripe';

// Mock Stripe SDK
jest.mock('stripe');

const MockedStripe = Stripe as jest.MockedClass<typeof Stripe>;

describe('StripeProcessor', () => {
  let stripeProcessor: StripeProcessor;
  let mockStripe: jest.Mocked<Stripe>;

  const mockCredentials = {
    secretKey: 'sk_test_123456789',
    clientId: 'ca_123456789',
    webhookSecret: 'whsec_test_123456789',
    accessToken: 'sk_test_access_123456789',
    accountId: 'acct_test_123456789'
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock Stripe instance
    mockStripe = {
      oauth: {
        token: jest.fn(),
        deauthorize: jest.fn(),
      },
      accounts: {
        retrieve: jest.fn(),
      },
      webhooks: {
        constructEvent: jest.fn(),
      },
      charges: {
        list: jest.fn(),
      },
      refunds: {
        create: jest.fn(),
      },
      paymentIntents: {
        retrieve: jest.fn(),
      },
    } as any;

    MockedStripe.mockImplementation(() => mockStripe);

    // Set up environment variables
    process.env.STRIPE_SECRET_KEY = mockCredentials.secretKey;
    process.env.STRIPE_CLIENT_ID = mockCredentials.clientId;
    process.env.STRIPE_WEBHOOK_SECRET = mockCredentials.webhookSecret;

    stripeProcessor = new StripeProcessor(mockCredentials);
  });

  describe('Constructor', () => {
    it('should initialize with provided credentials', () => {
      expect(stripeProcessor.name).toBe('Stripe');
      expect(stripeProcessor.type).toBe('stripe');
      expect(MockedStripe).toHaveBeenCalledWith(
        mockCredentials.secretKey,
        { apiVersion: '2024-06-20' }
      );
    });

    it('should use environment variables when credentials not provided', () => {
      new StripeProcessor({});
      expect(MockedStripe).toHaveBeenCalledWith(
        mockCredentials.secretKey,
        { apiVersion: '2024-06-20' }
      );
    });

    it('should throw error when client ID is missing', () => {
      delete process.env.STRIPE_CLIENT_ID;
      expect(() => new StripeProcessor({})).toThrow('Stripe client ID is required for Connect integration');
    });
  });

  describe('OAuth Flow', () => {
    describe('initiateOAuth', () => {
      it('should generate OAuth URL with correct parameters', async () => {
        const result = await stripeProcessor.initiateOAuth();

        expect(result.authUrl).toContain('https://connect.stripe.com/express/oauth/authorize');
        expect(result.authUrl).toContain(`client_id=${mockCredentials.clientId}`);
        expect(result.authUrl).toContain('stripe_user[business_type]=company');
        expect(result.authUrl).toContain('stripe_user[country]=AU');
        expect(result.authUrl).toContain('stripe_user[currency]=aud');
        expect(result.authUrl).toContain('suggested_capabilities[]=transfers');
        expect(result.authUrl).toContain('suggested_capabilities[]=card_payments');
        expect(result.state).toBeDefined();
        expect(result.method).toBe('oauth2');
      });

      it('should generate unique state values', async () => {
        const result1 = await stripeProcessor.initiateOAuth();
        const result2 = await stripeProcessor.initiateOAuth();

        expect(result1.state).not.toBe(result2.state);
      });
    });

    describe('handleOAuthCallback', () => {
      const mockOAuthResponse = {
        access_token: 'sk_test_access_token',
        stripe_user_id: 'acct_test_account',
      };

      const mockAccount = {
        id: 'acct_test_account',
        business_profile: { name: 'Test Business' },
        display_name: 'Test Display Name',
        email: 'test@example.com',
        country: 'AU',
        capabilities: { card_payments: 'active', transfers: 'active' },
        charges_enabled: true,
        payouts_enabled: true,
      };

      it('should successfully handle OAuth callback', async () => {
        mockStripe.oauth.token.mockResolvedValue(mockOAuthResponse);
        mockStripe.accounts.retrieve.mockResolvedValue(mockAccount);

        const result = await stripeProcessor.handleOAuthCallback('auth_code_123', 'state_123');

        expect(mockStripe.oauth.token).toHaveBeenCalledWith({
          grant_type: 'authorization_code',
          code: 'auth_code_123',
        });
        expect(mockStripe.accounts.retrieve).toHaveBeenCalledWith('acct_test_account');
        expect(result.success).toBe(true);
        expect(result.accessToken).toBe('sk_test_access_token');
        expect(result.accountId).toBe('acct_test_account');
        expect(result.metadata).toEqual({
          businessName: 'Test Business',
          email: 'test@example.com',
          country: 'AU',
          capabilities: ['card_payments', 'transfers'],
          chargesEnabled: true,
          payoutsEnabled: true,
        });
      });

      it('should handle OAuth callback errors', async () => {
        mockStripe.oauth.token.mockRejectedValue(new Error('OAuth failed'));

        const result = await stripeProcessor.handleOAuthCallback('invalid_code', 'state_123');

        expect(result.success).toBe(false);
        expect(result.error).toBe('OAuth failed');
      });

      it('should use display_name when business_profile.name is not available', async () => {
        const accountWithoutBusinessProfile = { ...mockAccount };
        delete accountWithoutBusinessProfile.business_profile;

        mockStripe.oauth.token.mockResolvedValue(mockOAuthResponse);
        mockStripe.accounts.retrieve.mockResolvedValue(accountWithoutBusinessProfile);

        const result = await stripeProcessor.handleOAuthCallback('auth_code_123', 'state_123');

        expect(result.success).toBe(true);
        expect(result.metadata?.businessName).toBe('Test Display Name');
      });
    });
  });

  describe('Webhook Handling', () => {
    const mockWebhookPayload = Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded' }));
    const mockSignature = 'test_signature';

    beforeEach(() => {
      stripeProcessor = new StripeProcessor({
        ...mockCredentials,
        webhookSecret: 'whsec_test_secret'
      });
    });

    it('should throw error when signature is missing', async () => {
      await expect(stripeProcessor.handleWebhook(mockWebhookPayload)).rejects.toThrow(
        'Webhook signature verification failed'
      );
    });

    it('should throw error when webhook secret is missing', async () => {
      const processorWithoutSecret = new StripeProcessor({
        ...mockCredentials,
        webhookSecret: ''
      });

      // The webhook verification will fail and catch the error, throwing generic message
      await expect(processorWithoutSecret.handleWebhook(mockWebhookPayload, mockSignature))
        .rejects.toThrow('Failed to process Stripe webhook');
    });

    it('should process payment_intent.succeeded events', async () => {
      const mockPaymentIntent = {
        id: 'pi_test_123',
        amount: 10000, // $100.00 in cents
        currency: 'aud',
        description: 'Test payment',
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
        receipt_email: 'customer@example.com',
        metadata: { order_id: '12345' }
      };

      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: { object: mockPaymentIntent }
      };

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const transactions = await stripeProcessor.handleWebhook(mockWebhookPayload, mockSignature);

      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        mockWebhookPayload,
        mockSignature,
        'whsec_test_secret'
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        id: 'pi_test_123',
        externalId: 'pi_test_123',
        amount: 100, // Converted from cents
        currency: 'AUD',
        description: 'Test payment',
        status: TransactionStatus.SUCCEEDED,
        customerEmail: 'customer@example.com',
        metadata: { order_id: '12345' }
      });
    });

    it('should process invoice.payment_succeeded events', async () => {
      const mockInvoice = {
        id: 'in_test_123',
        number: 'INV-001',
        amount_paid: 15000, // $150.00 in cents
        currency: 'aud',
        created: Math.floor(Date.now() / 1000),
        status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
        customer_email: 'customer@example.com',
        metadata: { subscription_id: '67890' }
      };

      const mockEvent = {
        type: 'invoice.payment_succeeded',
        data: { object: mockInvoice }
      };

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const transactions = await stripeProcessor.handleWebhook(mockWebhookPayload, mockSignature);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        id: 'in_test_123',
        externalId: 'in_test_123',
        amount: 150, // Converted from cents
        currency: 'AUD',
        description: 'Invoice INV-001',
        status: TransactionStatus.SUCCEEDED,
        customerEmail: 'customer@example.com'
      });
    });

    it('should process checkout.session.completed events', async () => {
      const mockSession = {
        id: 'cs_test_123',
        amount_total: 20000, // $200.00 in cents
        currency: 'aud',
        payment_status: 'paid',
        created: Math.floor(Date.now() / 1000),
        customer_details: {
          email: 'customer@example.com',
          name: 'John Doe'
        },
        metadata: { campaign: 'summer_sale' },
        payment_intent: 'pi_related_123'
      };

      const mockPaymentIntent = {
        payment_method_details: { type: 'card' }
      };

      const mockEvent = {
        type: 'checkout.session.completed',
        data: { object: mockSession }
      };

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockStripe.paymentIntents.retrieve.mockResolvedValue(mockPaymentIntent);

      const transactions = await stripeProcessor.handleWebhook(mockWebhookPayload, mockSignature);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        id: 'cs_test_123',
        externalId: 'cs_test_123',
        amount: 200, // Converted from cents
        currency: 'AUD',
        description: 'Checkout cs_test_123',
        status: TransactionStatus.SUCCEEDED,
        customerEmail: 'customer@example.com',
        customerName: 'John Doe',
        paymentMethod: 'card'
      });
    });

    it('should ignore unpaid checkout sessions', async () => {
      const mockSession = {
        id: 'cs_test_123',
        payment_status: 'unpaid',
        created: Math.floor(Date.now() / 1000)
      };

      const mockEvent = {
        type: 'checkout.session.completed',
        data: { object: mockSession }
      };

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const transactions = await stripeProcessor.handleWebhook(mockWebhookPayload, mockSignature);

      expect(transactions).toHaveLength(0);
    });

    it('should handle unrecognized event types gracefully', async () => {
      const mockEvent = {
        type: 'unknown.event.type',
        data: { object: {} }
      };

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const transactions = await stripeProcessor.handleWebhook(mockWebhookPayload, mockSignature);

      expect(transactions).toHaveLength(0);
      expect(consoleSpy).toHaveBeenCalledWith('Unhandled Stripe event type: unknown.event.type');
    });

    it('should handle webhook verification errors', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(stripeProcessor.handleWebhook(mockWebhookPayload, mockSignature))
        .rejects.toThrow('Failed to process Stripe webhook');
    });
  });

  describe('Transaction Retrieval', () => {
    it('should fetch transactions since a given date', async () => {
      const since = new Date('2024-01-01');
      const mockCharges = {
        data: [
          {
            id: 'ch_test_123',
            amount: 10000,
            currency: 'aud',
            description: 'Test charge',
            status: 'succeeded',
            created: Math.floor(since.getTime() / 1000) + 3600,
            billing_details: {
              email: 'customer@example.com',
              name: 'John Doe'
            },
            payment_method_details: { type: 'card' },
            metadata: { order_id: '123' }
          }
        ]
      };

      mockStripe.charges.list.mockResolvedValue(mockCharges);

      const transactions = await stripeProcessor.getTransactions(since);

      expect(mockStripe.charges.list).toHaveBeenCalledWith(
        {
          created: { gte: Math.floor(since.getTime() / 1000) },
          limit: 100
        },
        { stripeAccount: mockCredentials.accountId }
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        id: 'ch_test_123',
        amount: 100, // Converted from cents
        currency: 'AUD',
        status: TransactionStatus.SUCCEEDED
      });
    });

    it('should throw error when account is not connected', async () => {
      const processorWithoutAccount = new StripeProcessor({
        ...mockCredentials,
        accountId: undefined
      });

      await expect(processorWithoutAccount.getTransactions(new Date()))
        .rejects.toThrow('Stripe account not connected');
    });

    it('should handle API errors', async () => {
      mockStripe.charges.list.mockRejectedValue(new Error('API Error'));

      await expect(stripeProcessor.getTransactions(new Date()))
        .rejects.toThrow('API Error');
    });
  });

  describe('Account Info', () => {
    it('should retrieve account information', async () => {
      const mockAccount = {
        id: 'acct_test_123',
        email: 'business@example.com',
        business_profile: { name: 'Test Business' },
        country: 'AU',
        default_currency: 'aud',
        charges_enabled: true,
        requirements: { currently_due: [] },
        capabilities: { card_payments: 'active', transfers: 'active' }
      };

      mockStripe.accounts.retrieve.mockResolvedValue(mockAccount);

      const accountInfo = await stripeProcessor.getAccountInfo();

      expect(accountInfo).toEqual({
        id: 'acct_test_123',
        email: 'business@example.com',
        businessName: 'Test Business',
        country: 'AU',
        currency: 'aud',
        isActive: true,
        capabilities: ['card_payments', 'transfers']
      });
    });

    it('should handle inactive accounts', async () => {
      const mockAccount = {
        id: 'acct_test_123',
        email: 'business@example.com',
        country: 'AU',
        charges_enabled: false,
        requirements: { currently_due: ['business_profile.name'] },
        capabilities: {}
      };

      mockStripe.accounts.retrieve.mockResolvedValue(mockAccount);

      const accountInfo = await stripeProcessor.getAccountInfo();

      expect(accountInfo.isActive).toBe(false);
    });

    it('should use display_name when business_profile.name is not available', async () => {
      const mockAccount = {
        id: 'acct_test_123',
        email: 'business@example.com',
        display_name: 'Display Name',
        country: 'AU',
        charges_enabled: true,
        requirements: { currently_due: [] },
        capabilities: {}
      };

      mockStripe.accounts.retrieve.mockResolvedValue(mockAccount);

      const accountInfo = await stripeProcessor.getAccountInfo();

      expect(accountInfo.businessName).toBe('Display Name');
    });

    it('should throw error when account is not connected', async () => {
      const processorWithoutAccount = new StripeProcessor({
        ...mockCredentials,
        accountId: undefined
      });

      await expect(processorWithoutAccount.getAccountInfo())
        .rejects.toThrow('Stripe account not connected');
    });
  });

  describe('Account Disconnection', () => {
    it('should disconnect Stripe account', async () => {
      mockStripe.oauth.deauthorize.mockResolvedValue({});

      await stripeProcessor.disconnectAccount();

      expect(mockStripe.oauth.deauthorize).toHaveBeenCalledWith({
        client_id: mockCredentials.clientId,
        stripe_user_id: mockCredentials.accountId
      });
    });

    it('should throw error when client ID is missing', async () => {
      const processor = new StripeProcessor(mockCredentials);
      
      // Manually clear the clientId after construction to test the runtime check
      (processor as any).clientId = '';

      await expect(processor.disconnectAccount())
        .rejects.toThrow('Cannot disconnect: missing client ID or account ID');
    });

    it('should handle deauthorization errors', async () => {
      mockStripe.oauth.deauthorize.mockRejectedValue(new Error('Deauth failed'));

      await expect(stripeProcessor.disconnectAccount())
        .rejects.toThrow('Deauth failed');
    });
  });

  describe('Refunds', () => {
    it('should create full refunds', async () => {
      const mockRefund = {
        id: 're_test_123',
        amount: 10000,
        status: 'succeeded',
        reason: null
      };

      mockStripe.refunds.create.mockResolvedValue(mockRefund);

      const result = await stripeProcessor.refund('ch_test_123');

      expect(mockStripe.refunds.create).toHaveBeenCalledWith(
        {
          charge: 'ch_test_123',
          amount: undefined
        },
        { stripeAccount: mockCredentials.accountId }
      );
      expect(result).toEqual({
        id: 're_test_123',
        amount: 100, // Converted from cents
        status: 'succeeded',
        reason: undefined
      });
    });

    it('should create partial refunds', async () => {
      const mockRefund = {
        id: 're_test_123',
        amount: 5000,
        status: 'pending',
        reason: 'requested_by_customer'
      };

      mockStripe.refunds.create.mockResolvedValue(mockRefund);

      const result = await stripeProcessor.refund('ch_test_123', 50);

      expect(mockStripe.refunds.create).toHaveBeenCalledWith(
        {
          charge: 'ch_test_123',
          amount: 5000 // $50 converted to cents
        },
        { stripeAccount: mockCredentials.accountId }
      );
      expect(result).toEqual({
        id: 're_test_123',
        amount: 50, // Converted from cents
        status: 'pending',
        reason: 'requested_by_customer'
      });
    });

    it('should handle refund without connected account', async () => {
      const processorWithoutAccount = new StripeProcessor({
        ...mockCredentials,
        accountId: undefined
      });

      const mockRefund = {
        id: 're_test_123',
        amount: 10000,
        status: 'succeeded',
        reason: null
      };

      mockStripe.refunds.create.mockResolvedValue(mockRefund);

      await processorWithoutAccount.refund('ch_test_123');

      expect(mockStripe.refunds.create).toHaveBeenCalledWith(
        {
          charge: 'ch_test_123',
          amount: undefined
        },
        undefined // No stripeAccount option
      );
    });

    it('should handle refund errors', async () => {
      mockStripe.refunds.create.mockRejectedValue(new Error('Refund failed'));

      await expect(stripeProcessor.refund('ch_test_123'))
        .rejects.toThrow('Refund failed');
    });
  });

  describe('Status Conversion', () => {
    it('should convert Stripe statuses correctly', () => {
      const processor = new StripeProcessor(mockCredentials);
      
      // Access private method through bracket notation for testing
      const convertStatus = (processor as any).convertStripeStatus.bind(processor);
      
      expect(convertStatus('pending')).toBe(TransactionStatus.PENDING);
      expect(convertStatus('requires_payment_method')).toBe(TransactionStatus.PENDING);
      expect(convertStatus('processing')).toBe(TransactionStatus.PROCESSING);
      expect(convertStatus('succeeded')).toBe(TransactionStatus.SUCCEEDED);
      expect(convertStatus('failed')).toBe(TransactionStatus.FAILED);
      expect(convertStatus('canceled')).toBe(TransactionStatus.CANCELLED);
      expect(convertStatus('unknown_status')).toBe(TransactionStatus.PENDING);
    });
  });
});