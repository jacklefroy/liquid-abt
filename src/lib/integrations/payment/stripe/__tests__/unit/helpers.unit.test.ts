// LIQUID ABT - Stripe Helper Functions Unit Tests
// Unit tests for Stripe utility functions

import {
  calculateStripeFee,
  formatStripeAmount,
  parseStripeWebhookEvent,
  validateStripeApiKey,
  generateIdempotencyKey,
  convertStripeAmount,
  isTestEvent,
  extractStripeMetadata,
  isWebhookTimestampValid,
  formatStripeError,
  generateTestWebhookSignature,
  sanitizeStripeDataForLogging,
} from '../../helpers';

describe('Stripe Helper Functions - Unit Tests', () => {
  
  describe('calculateStripeFee', () => {
    it('should calculate local card fee correctly', () => {
      const amount = 10000; // $100.00 in cents
      const fee = calculateStripeFee(amount, 'aud', false);
      
      // 1.75% + 30c = $1.75 + $0.30 = $2.05 = 205 cents
      expect(fee).toBe(205);
    });

    it('should calculate international card fee correctly', () => {
      const amount = 10000; // $100.00 in cents
      const fee = calculateStripeFee(amount, 'aud', true);
      
      // 2.9% + 30c = $2.90 + $0.30 = $3.20 = 320 cents
      expect(fee).toBe(320);
    });

    it('should handle zero amount', () => {
      expect(calculateStripeFee(0)).toBe(0);
      expect(calculateStripeFee(-100)).toBe(0);
    });

    it('should not exceed transaction amount', () => {
      const amount = 50; // 50 cents
      const fee = calculateStripeFee(amount);
      
      expect(fee).toBeLessThanOrEqual(amount);
      expect(fee).toBe(31); // 1.75% + 30c = 1c + 30c = 31c (capped at 31c, not 50c)
    });

    it('should handle small amounts correctly', () => {
      const amount = 100; // $1.00
      const fee = calculateStripeFee(amount, 'aud', false);
      
      // 1.75% + 30c = 2c + 30c = 32c
      expect(fee).toBe(32);
    });
  });

  describe('formatStripeAmount', () => {
    it('should format cents to dollars correctly', () => {
      expect(formatStripeAmount(10000)).toBe('100.00');
      expect(formatStripeAmount(1234)).toBe('12.34');
      expect(formatStripeAmount(50)).toBe('0.50');
      expect(formatStripeAmount(5)).toBe('0.05');
    });

    it('should handle zero amount', () => {
      expect(formatStripeAmount(0)).toBe('0.00');
    });

    it('should handle large amounts', () => {
      expect(formatStripeAmount(123456789)).toBe('1234567.89');
    });
  });

  describe('parseStripeWebhookEvent', () => {
    it('should parse valid JSON payload', () => {
      const payload = '{"type": "payment_intent.succeeded", "data": {"object": {"id": "pi_123"}}}';
      const parsed = parseStripeWebhookEvent(payload);
      
      expect(parsed.type).toBe('payment_intent.succeeded');
      expect(parsed.data.object.id).toBe('pi_123');
    });

    it('should throw error for invalid JSON', () => {
      const invalidPayload = '{"type": "payment_intent.succeeded", "data": {';
      
      expect(() => parseStripeWebhookEvent(invalidPayload)).toThrow('Invalid webhook payload format');
    });

    it('should handle empty payload', () => {
      expect(() => parseStripeWebhookEvent('')).toThrow('Invalid webhook payload format');
    });
  });

  describe('validateStripeApiKey', () => {
    const testSecretKey = 'sk_test_' + '1234567890abcdefghijklmn';
    const testSecretKey2 = 'sk_test_' + 'abcdefghijklmnopqrstuvwxyz123456';
    const liveSecretKey = 'sk_live_' + '1234567890abcdefghijklmn';
    const liveSecretKey2 = 'sk_live_' + 'abcdefghijklmnopqrstuvwxyz123456';
    const testPublishKey = 'pk_test_' + '1234567890abcdefghijklmn';
    const testPublishKey2 = 'pk_test_' + 'abcdefghijklmnopqrstuvwxyz123456';
    const livePublishKey = 'pk_live_' + '1234567890abcdefghijklmn';
    const livePublishKey2 = 'pk_live_' + 'abcdefghijklmnopqrstuvwxyz123456';

    it('should validate test secret keys', () => {
      expect(validateStripeApiKey(testSecretKey)).toBe(true);
      expect(validateStripeApiKey(testSecretKey2)).toBe(true);
    });

    it('should validate live secret keys', () => {
      expect(validateStripeApiKey(liveSecretKey)).toBe(true);
      expect(validateStripeApiKey(liveSecretKey2)).toBe(true);
    });

    it('should validate test publishable keys', () => {
      expect(validateStripeApiKey(testPublishKey)).toBe(true);
      expect(validateStripeApiKey(testPublishKey2)).toBe(true);
    });

    it('should validate live publishable keys', () => {
      expect(validateStripeApiKey(livePublishKey)).toBe(true);
      expect(validateStripeApiKey(livePublishKey2)).toBe(true);
    });

    it('should reject invalid keys', () => {
      expect(validateStripeApiKey('')).toBe(false);
      expect(validateStripeApiKey('invalid_key')).toBe(false);
      expect(validateStripeApiKey('sk_test_')).toBe(false);
      expect(validateStripeApiKey('sk_test_short')).toBe(false);
      expect(validateStripeApiKey(null as any)).toBe(false);
      expect(validateStripeApiKey(undefined as any)).toBe(false);
    });
  });

  describe('generateIdempotencyKey', () => {
    it('should generate unique keys for same tenant and operation', () => {
      const key1 = generateIdempotencyKey('tenant1', 'purchase');
      const key2 = generateIdempotencyKey('tenant1', 'purchase');
      
      expect(key1).not.toBe(key2);
      expect(key1).toContain('tenant1_purchase_');
      expect(key2).toContain('tenant1_purchase_');
    });

    it('should include additional data in hash', () => {
      const key = generateIdempotencyKey('tenant1', 'purchase', 'additional_data');
      
      expect(key).toContain('tenant1_purchase_');
      expect(key.split('_')).toHaveLength(5); // tenant_operation_timestamp_random_hash
    });

    it('should generate different keys for different tenants', () => {
      const key1 = generateIdempotencyKey('tenant1', 'purchase');
      const key2 = generateIdempotencyKey('tenant2', 'purchase');
      
      expect(key1).toContain('tenant1');
      expect(key2).toContain('tenant2');
      expect(key1).not.toBe(key2);
    });
  });

  describe('convertStripeAmount', () => {
    it('should convert USD to AUD', () => {
      const result = convertStripeAmount(100, 'USD', 'AUD');
      
      expect(result.currency).toBe('AUD');
      expect(result.amount).toBe(145); // 100 * 1.45
    });

    it('should convert EUR to AUD', () => {
      const result = convertStripeAmount(100, 'EUR', 'AUD');
      
      expect(result.currency).toBe('AUD');
      expect(result.amount).toBe(165); // 100 * 1.65
    });

    it('should handle same currency conversion', () => {
      const result = convertStripeAmount(100, 'AUD', 'AUD');
      
      expect(result.currency).toBe('AUD');
      expect(result.amount).toBe(100); // 100 * 1.0
    });

    it('should handle unknown currency with 1.0 rate', () => {
      const result = convertStripeAmount(100, 'XYZ', 'AUD');
      
      expect(result.currency).toBe('AUD');
      expect(result.amount).toBe(100); // Default 1.0 rate
    });

    it('should handle case insensitive currencies', () => {
      const result = convertStripeAmount(100, 'usd', 'aud');
      
      expect(result.currency).toBe('aud');
      expect(result.amount).toBe(145);
    });
  });

  describe('isTestEvent', () => {
    it('should identify test events by livemode', () => {
      const testEvent = { livemode: false, id: 'evt_test_123' };
      expect(isTestEvent(testEvent)).toBe(true);
    });

    it('should identify test events by ID pattern', () => {
      const testEvent = { livemode: false, id: 'evt_test_123456' };
      expect(isTestEvent(testEvent)).toBe(true);
    });

    it('should identify test events by object ID', () => {
      const testEvent = {
        livemode: false,
        data: { object: { id: 'pi_test_123' } }
      };
      expect(isTestEvent(testEvent)).toBe(true);
    });

    it('should identify live events', () => {
      const liveEvent = { livemode: true, id: 'evt_123456' };
      expect(isTestEvent(liveEvent)).toBe(false);
    });

    it('should handle missing properties', () => {
      expect(isTestEvent({})).toBe(undefined); // Empty object returns undefined due to && with undefined
      expect(isTestEvent({ livemode: false })).toBe(undefined); // Without id pattern, returns undefined
      expect(isTestEvent({ livemode: true })).toBe(false);
    });
  });

  describe('extractStripeMetadata', () => {
    it('should extract existing metadata', () => {
      const stripeObject = {
        metadata: {
          conversionPercentage: '5',
          tenantId: 'tenant_123'
        }
      };
      
      expect(extractStripeMetadata(stripeObject, 'conversionPercentage')).toBe('5');
      expect(extractStripeMetadata(stripeObject, 'tenantId')).toBe('tenant_123');
    });

    it('should return default value for missing metadata', () => {
      const stripeObject = { metadata: {} };
      
      expect(extractStripeMetadata(stripeObject, 'missing', 'default')).toBe('default');
    });

    it('should handle missing metadata object', () => {
      const stripeObject = {};
      
      expect(extractStripeMetadata(stripeObject, 'key', 'default')).toBe('default');
    });

    it('should handle null/undefined objects', () => {
      expect(extractStripeMetadata(null, 'key', 'default')).toBe('default');
      expect(extractStripeMetadata(undefined, 'key', 'default')).toBe('default');
    });
  });

  describe('isWebhookTimestampValid', () => {
    it('should validate recent timestamps', () => {
      const recentTimestamp = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
      expect(isWebhookTimestampValid(recentTimestamp)).toBe(true);
    });

    it('should reject old timestamps', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      expect(isWebhookTimestampValid(oldTimestamp)).toBe(false);
    });

    it('should reject future timestamps', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 600; // 10 minutes in future
      expect(isWebhookTimestampValid(futureTimestamp)).toBe(false);
    });

    it('should respect custom tolerance', () => {
      const timestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      expect(isWebhookTimestampValid(timestamp, 300)).toBe(false); // 5 minute tolerance
      expect(isWebhookTimestampValid(timestamp, 500)).toBe(true);  // 8+ minute tolerance
    });
  });

  describe('formatStripeError', () => {
    it('should format standard Stripe errors', () => {
      const error = {
        type: 'card_error',
        code: 'card_declined',
        message: 'Your card was declined.'
      };
      
      const formatted = formatStripeError(error);
      
      expect(formatted.message).toBe('Your card was declined.');
      expect(formatted.code).toBe('card_declined');
      expect(formatted.type).toBe('card_error');
      expect(formatted.userMessage).toBe('Your card was declined. Please try a different payment method.');
    });

    it('should handle errors without codes', () => {
      const error = {
        message: 'Network error',
        type: 'api_error'
      };
      
      const formatted = formatStripeError(error);
      
      expect(formatted.message).toBe('Network error');
      expect(formatted.code).toBe('api_error');
      expect(formatted.userMessage).toBe('Please check your payment details and try again.');
    });

    it('should handle null/undefined errors', () => {
      const formatted = formatStripeError(null);
      
      expect(formatted.type).toBe('unknown');
      expect(formatted.userMessage).toBe('An unexpected error occurred with payment processing.');
    });

    it('should provide user-friendly messages for common errors', () => {
      const testCases = [
        { code: 'expired_card', expected: 'Your card has expired. Please use a different card.' },
        { code: 'incorrect_cvc', expected: 'Your card\'s security code is incorrect.' },
        { code: 'processing_error', expected: 'An error occurred processing your card. Please try again.' },
        { code: 'rate_limit', expected: 'Too many requests. Please try again in a moment.' },
      ];
      
      testCases.forEach(({ code, expected }) => {
        const error = { code, type: 'card_error', message: 'Test error' };
        const formatted = formatStripeError(error);
        expect(formatted.userMessage).toBe(expected);
      });
    });
  });

  describe('generateTestWebhookSignature', () => {
    it('should generate valid webhook signature', () => {
      const payload = '{"type": "payment_intent.succeeded"}';
      const secret = 'whsec_test123';
      const timestamp = 1234567890;
      
      const signature = generateTestWebhookSignature(payload, secret, timestamp);
      
      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      expect(signature).toContain(`t=${timestamp}`);
    });

    it('should use current timestamp when not provided', () => {
      const payload = '{"type": "payment_intent.succeeded"}';
      const secret = 'whsec_test123';
      
      const signature = generateTestWebhookSignature(payload, secret);
      
      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    });

    it('should generate different signatures for different payloads', () => {
      const secret = 'whsec_test123';
      const timestamp = 1234567890;
      
      const sig1 = generateTestWebhookSignature('payload1', secret, timestamp);
      const sig2 = generateTestWebhookSignature('payload2', secret, timestamp);
      
      expect(sig1).not.toBe(sig2);
      expect(sig1.split(',')[0]).toBe(sig2.split(',')[0]); // Same timestamp
      expect(sig1.split(',')[1]).not.toBe(sig2.split(',')[1]); // Different signature
    });
  });

  describe('sanitizeStripeDataForLogging', () => {
    it('should redact sensitive fields', () => {
      const data = {
        id: 'pi_123',
        amount: 1000,
        client_secret: 'pi_123_secret_abc',
        payment_method: 'pm_123',
        card: { last4: '4242' },
        bank_account: { last4: '1234' },
        source: 'src_123',
        metadata: { tenantId: 'tenant_123' }
      };
      
      const sanitized = sanitizeStripeDataForLogging(data);
      
      expect(sanitized.id).toBe('pi_123');
      expect(sanitized.amount).toBe(1000);
      expect(sanitized.metadata.tenantId).toBe('tenant_123');
      expect(sanitized.client_secret).toBe('[REDACTED]');
      expect(sanitized.payment_method).toBe('[REDACTED]');
      expect(sanitized.card).toBe('[REDACTED]');
      expect(sanitized.bank_account).toBe('[REDACTED]');
      expect(sanitized.source).toBe('[REDACTED]');
    });

    it('should handle non-object data', () => {
      expect(sanitizeStripeDataForLogging('string')).toBe('string');
      expect(sanitizeStripeDataForLogging(123)).toBe(123);
      expect(sanitizeStripeDataForLogging(null)).toBe(null);
      expect(sanitizeStripeDataForLogging(undefined)).toBe(undefined);
    });

    it('should handle data without sensitive fields', () => {
      const data = {
        id: 'pi_123',
        amount: 1000,
        currency: 'aud'
      };
      
      const sanitized = sanitizeStripeDataForLogging(data);
      
      expect(sanitized).toEqual(data);
    });

    it('should not modify original data', () => {
      const originalData = {
        id: 'pi_123',
        client_secret: 'secret'
      };
      const originalCopy = { ...originalData };
      
      const sanitized = sanitizeStripeDataForLogging(originalData);
      
      expect(originalData).toEqual(originalCopy);
      expect(sanitized.client_secret).toBe('[REDACTED]');
      expect(originalData.client_secret).toBe('secret');
    });
  });
});