// LIQUID ABT - Webhook Idempotency Unit Tests

import { NextRequest } from 'next/server';
import {
  webhookIdempotencyMiddleware,
  isWebhookProcessed,
  storeWebhookEvent,
  markWebhookProcessed,
  completeWebhookProcessing,
  cleanupExpiredWebhookEvents,
  getWebhookStats,
  isWebhookReplay,
  extractWebhookTimestamp,
  validateWebhookSecurity
} from '../../webhookIdempotency';

// Mock Prisma
jest.mock('@/lib/database/connection', () => ({
  getMasterPrisma: jest.fn(() => ({
    webhookEvent: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  })),
}));

const mockPrisma = {
  webhookEvent: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
};

// Mock NextRequest
function createMockRequest(
  url: string = 'http://localhost:3000/api/stripe/webhook',
  method: string = 'POST',
  headers: Record<string, string> = {}
): NextRequest {
  const defaultHeaders = url.includes('/stripe') ? {
    'content-type': 'application/json',
    'stripe-signature': 't=1234567890,v1=test_signature',
  } : {
    'content-type': 'application/json',
  };

  const headerMap = new Map(Object.entries({
    ...defaultHeaders,
    ...headers,
  }));

  return {
    nextUrl: new URL(url),
    method,
    headers: headerMap,
  } as NextRequest;
}

// Mock webhook payload
const mockStripePayload = {
  id: 'evt_test_webhook_123',
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: 'pi_test_123',
      amount: 2000,
      currency: 'aud',
    },
  },
};

describe('Webhook Idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations
    require('@/lib/database/connection').getMasterPrisma.mockReturnValue(mockPrisma);
  });

  describe('isWebhookProcessed', () => {
    it('should return false when webhook not found', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);

      const result = await isWebhookProcessed('evt_test_123', 'stripe');

      expect(result).toBe(false);
      expect(mockPrisma.webhookEvent.findUnique).toHaveBeenCalledWith({
        where: {
          eventId_provider: {
            eventId: 'evt_test_123',
            provider: 'stripe',
          },
        },
      });
    });

    it('should return true when webhook is processed', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({
        id: '123',
        eventId: 'evt_test_123',
        provider: 'stripe',
        processed: true,
      });

      const result = await isWebhookProcessed('evt_test_123', 'stripe');

      expect(result).toBe(true);
    });

    it('should return false when webhook exists but not processed', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({
        id: '123',
        eventId: 'evt_test_123',
        provider: 'stripe',
        processed: false,
      });

      const result = await isWebhookProcessed('evt_test_123', 'stripe');

      expect(result).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.webhookEvent.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await isWebhookProcessed('evt_test_123', 'stripe');

      expect(result).toBe(false); // Allow processing to continue on error
    });
  });

  describe('storeWebhookEvent', () => {
    it('should store new webhook event', async () => {
      mockPrisma.webhookEvent.upsert.mockResolvedValue({
        id: '123',
        eventId: 'evt_test_123',
        provider: 'stripe',
        processed: false,
      });

      const result = await storeWebhookEvent('evt_test_123', 'stripe', 'payment_intent.succeeded');

      expect(result).toBe(true);
      expect(mockPrisma.webhookEvent.upsert).toHaveBeenCalledWith({
        where: {
          eventId_provider: {
            eventId: 'evt_test_123',
            provider: 'stripe',
          },
        },
        update: {
          processed: false,
          eventType: 'payment_intent.succeeded',
          expiresAt: expect.any(Date),
        },
        create: {
          eventId: 'evt_test_123',
          provider: 'stripe',
          eventType: 'payment_intent.succeeded',
          processed: false,
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should handle database errors', async () => {
      mockPrisma.webhookEvent.upsert.mockRejectedValue(new Error('Database error'));

      const result = await storeWebhookEvent('evt_test_123', 'stripe', 'payment_intent.succeeded');

      expect(result).toBe(false);
    });
  });

  describe('markWebhookProcessed', () => {
    it('should mark webhook as processed', async () => {
      mockPrisma.webhookEvent.update.mockResolvedValue({
        id: '123',
        processed: true,
      });

      const result = await markWebhookProcessed('evt_test_123', 'stripe');

      expect(result).toBe(true);
      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: {
          eventId_provider: {
            eventId: 'evt_test_123',
            provider: 'stripe',
          },
        },
        data: {
          processed: true,
        },
      });
    });

    it('should handle update errors', async () => {
      mockPrisma.webhookEvent.update.mockRejectedValue(new Error('Update failed'));

      const result = await markWebhookProcessed('evt_test_123', 'stripe');

      expect(result).toBe(false);
    });
  });

  describe('completeWebhookProcessing', () => {
    it('should mark webhook as processed', async () => {
      mockPrisma.webhookEvent.update.mockResolvedValue({ processed: true });

      await completeWebhookProcessing('evt_test_123', 'stripe');

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: {
          eventId_provider: {
            eventId: 'evt_test_123',
            provider: 'stripe',
          },
        },
        data: {
          processed: true,
        },
      });
    });
  });

  describe('cleanupExpiredWebhookEvents', () => {
    it('should delete expired webhook events', async () => {
      mockPrisma.webhookEvent.deleteMany.mockResolvedValue({ count: 5 });

      const result = await cleanupExpiredWebhookEvents();

      expect(result).toBe(5);
      expect(mockPrisma.webhookEvent.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('should handle cleanup errors', async () => {
      mockPrisma.webhookEvent.deleteMany.mockRejectedValue(new Error('Cleanup failed'));

      const result = await cleanupExpiredWebhookEvents();

      expect(result).toBe(0);
    });
  });

  describe('getWebhookStats', () => {
    it('should return webhook statistics', async () => {
      mockPrisma.webhookEvent.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(80)  // processed
        .mockResolvedValueOnce(10); // expired

      mockPrisma.webhookEvent.groupBy.mockResolvedValue([
        { provider: 'stripe', _count: { provider: 60 } },
        { provider: 'square', _count: { provider: 40 } },
      ]);

      const stats = await getWebhookStats();

      expect(stats).toEqual({
        total: 100,
        processed: 80,
        pending: 20,
        expired: 10,
        byProvider: {
          stripe: 60,
          square: 40,
        },
      });
    });

    it('should handle stats errors gracefully', async () => {
      mockPrisma.webhookEvent.count.mockRejectedValue(new Error('Stats failed'));

      const stats = await getWebhookStats();

      expect(stats).toEqual({
        total: 0,
        processed: 0,
        pending: 0,
        expired: 0,
        byProvider: {},
      });
    });
  });

  describe('webhookIdempotencyMiddleware', () => {
    it('should allow processing for new webhook event', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValue({ id: '123' });

      const req = createMockRequest();
      const result = await webhookIdempotencyMiddleware(req, mockStripePayload);

      expect(result).toEqual({
        shouldProcess: true,
        eventId: 'evt_test_webhook_123',
        provider: 'stripe',
      });
    });

    it('should skip processing for already processed event', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({
        id: '123',
        processed: true,
      });

      const req = createMockRequest();
      const result = await webhookIdempotencyMiddleware(req, mockStripePayload);

      expect(result).toEqual({
        shouldProcess: false,
        eventId: 'evt_test_webhook_123',
        provider: 'stripe',
        reason: 'already_processed',
      });
    });

    it('should allow processing when no event ID found', async () => {
      const payloadWithoutId = { type: 'test', data: {} };
      const req = createMockRequest();

      const result = await webhookIdempotencyMiddleware(req, payloadWithoutId);

      expect(result).toEqual({
        shouldProcess: true,
        eventId: null,
        provider: 'stripe',
        reason: 'no_event_id',
      });
    });

    it('should detect different providers correctly', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValue({ id: '123' });

      // Test Square webhook
      const squareReq = createMockRequest('http://localhost:3000/api/square/webhook');
      const squarePayload = { event_id: 'square_123', type: 'payment.created' };

      const result = await webhookIdempotencyMiddleware(squareReq, squarePayload);

      expect(result.provider).toBe('square');
      expect(result.eventId).toBe('square_123');
    });
  });

  describe('isWebhookReplay', () => {
    it('should detect replay attacks', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const result = isWebhookReplay(oldTimestamp, 300); // 5 minute tolerance

      expect(result).toBe(true);
    });

    it('should allow recent timestamps', () => {
      const recentTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
      const result = isWebhookReplay(recentTimestamp, 300); // 5 minute tolerance

      expect(result).toBe(false);
    });
  });

  describe('extractWebhookTimestamp', () => {
    it('should extract timestamp from Stripe signature', () => {
      const req = createMockRequest('http://localhost:3000/api/stripe/webhook', 'POST', {
        'stripe-signature': 't=1234567890,v1=signature_here',
      });

      const timestamp = extractWebhookTimestamp(req);

      expect(timestamp).toBe(1234567890);
    });

    it('should extract timestamp from generic header', () => {
      const req = createMockRequest('http://localhost:3000/api/webhook', 'POST', {
        'x-timestamp': '1234567890',
      });

      const timestamp = extractWebhookTimestamp(req);

      expect(timestamp).toBe(1234567890);
    });

    it('should return null when no timestamp found', () => {
      const req = createMockRequest('http://localhost:3000/api/webhook', 'POST', {
        // Remove stripe-signature header
        'content-type': 'application/json'
      });
      // Override the default header
      req.headers.delete('stripe-signature');

      const timestamp = extractWebhookTimestamp(req);

      expect(timestamp).toBeNull();
    });
  });

  describe('validateWebhookSecurity', () => {
    it('should validate secure webhook', () => {
      // Use current timestamp to avoid replay detection
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const req = createMockRequest('http://localhost:3000/api/stripe/webhook', 'POST', {
        'stripe-signature': `t=${currentTimestamp},v1=signature_here`,
        'content-type': 'application/json',
      });

      const validation = validateWebhookSecurity(req);

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it('should detect missing signature', () => {
      const req = createMockRequest('http://localhost:3000/api/webhook', 'POST', {
        'content-type': 'application/json',
      });
      // Remove any signature headers
      req.headers.delete('stripe-signature');

      const validation = validateWebhookSecurity(req);

      expect(validation.valid).toBe(false);
      expect(validation.issues).toContain('No webhook signature found');
    });

    it('should detect invalid content type', () => {
      const req = createMockRequest('http://localhost:3000/api/webhook', 'POST', {
        'x-signature': 'test_sig',
        'content-type': 'text/plain',
      });

      const validation = validateWebhookSecurity(req);

      expect(validation.valid).toBe(false);
      expect(validation.issues).toContain('Invalid content type for webhook');
    });

    it('should detect replay attacks', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const req = createMockRequest('http://localhost:3000/api/stripe/webhook', 'POST', {
        'stripe-signature': `t=${oldTimestamp},v1=signature_here`,
        'content-type': 'application/json',
      });

      const validation = validateWebhookSecurity(req);

      expect(validation.valid).toBe(false);
      expect(validation.issues).toContain('Webhook timestamp indicates potential replay attack');
    });
  });

  describe('Provider Detection', () => {
    it('should detect Stripe from URL path', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValue({ id: '123' });

      const req = createMockRequest('http://localhost:3000/api/stripe/webhook');
      const result = await webhookIdempotencyMiddleware(req, mockStripePayload);

      expect(result.provider).toBe('stripe');
    });

    it('should detect Square from URL path', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValue({ id: '123' });

      const req = createMockRequest('http://localhost:3000/api/square/webhook');
      const result = await webhookIdempotencyMiddleware(req, { event_id: 'sq_123' });

      expect(result.provider).toBe('square');
    });

    it('should detect PayPal from URL path', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValue({ id: '123' });

      const req = createMockRequest('http://localhost:3000/api/paypal/webhook');
      const result = await webhookIdempotencyMiddleware(req, { id: 'pp_123' });

      expect(result.provider).toBe('paypal');
    });

    it('should detect provider from headers when path is generic', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValue({ id: '123' });

      const req = createMockRequest('http://localhost:3000/api/webhook', 'POST', {
        'square-signature': 'square_signature_here',
      });
      // Remove stripe signature to avoid conflicting headers
      req.headers.delete('stripe-signature');
      req.headers.set('square-signature', 'square_signature_here');
      
      const result = await webhookIdempotencyMiddleware(req, { event_id: 'sq_456' });

      expect(result.provider).toBe('square');
    });
  });

  describe('Event ID Extraction', () => {
    it('should extract Stripe event ID', async () => {
      const payload = { id: 'evt_stripe_123', type: 'payment.succeeded' };
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValue({ id: '123' });

      const req = createMockRequest();
      const result = await webhookIdempotencyMiddleware(req, payload);

      expect(result.eventId).toBe('evt_stripe_123');
    });

    it('should extract Square event ID', async () => {
      const payload = { event_id: 'square_event_123', type: 'payment.created' };
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.upsert.mockResolvedValue({ id: '123' });

      const req = createMockRequest('http://localhost:3000/api/square/webhook');
      const result = await webhookIdempotencyMiddleware(req, payload);

      expect(result.eventId).toBe('square_event_123');
    });

    it('should handle missing event ID gracefully', async () => {
      const payload = { type: 'unknown_event', data: {} };
      const req = createMockRequest();
      const result = await webhookIdempotencyMiddleware(req, payload);

      expect(result.shouldProcess).toBe(true);
      expect(result.eventId).toBeNull();
      expect(result.reason).toBe('no_event_id');
    });
  });
});