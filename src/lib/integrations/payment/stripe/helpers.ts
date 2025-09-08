// LIQUID ABT - Stripe Helper Functions
// Utility functions for Stripe integration

import crypto from 'crypto';

/**
 * Calculate Stripe processing fee for Australian transactions
 */
export function calculateStripeFee(
  amount: number,
  currency: string = 'aud',
  isInternationalCard: boolean = false
): number {
  if (amount <= 0) return 0;
  
  // Australian Stripe fees (as of 2025)
  // Local cards: 1.75% + 30c
  // International cards: 2.9% + 30c
  const percentageFee = isInternationalCard ? 0.029 : 0.0175;
  const fixedFee = 30; // 30 cents in cents
  
  const calculatedFee = Math.round(amount * percentageFee) + fixedFee;
  
  return Math.min(calculatedFee, amount); // Fee can't exceed transaction amount
}

/**
 * Format Stripe amount (cents) to dollars with 2 decimal places
 */
export function formatStripeAmount(amountInCents: number): string {
  const dollars = amountInCents / 100;
  return dollars.toFixed(2);
}

/**
 * Parse Stripe webhook event safely
 */
export function parseStripeWebhookEvent(payload: string): any {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error('Invalid webhook payload format');
  }
}

/**
 * Validate Stripe API key format
 */
export function validateStripeApiKey(apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }
  
  // Stripe keys follow specific patterns
  const patterns = [
    /^sk_test_[a-zA-Z0-9]{24,}$/, // Test secret key
    /^sk_live_[a-zA-Z0-9]{24,}$/, // Live secret key
    /^pk_test_[a-zA-Z0-9]{24,}$/, // Test publishable key
    /^pk_live_[a-zA-Z0-9]{24,}$/, // Live publishable key
  ];
  
  return patterns.some(pattern => pattern.test(apiKey));
}

/**
 * Generate idempotency key for Stripe operations
 */
export function generateIdempotencyKey(
  tenantId: string,
  operation: string,
  additionalData?: string
): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const base = `${tenantId}_${operation}_${timestamp}_${random}`;
  
  if (additionalData) {
    const hash = crypto.createHash('md5').update(additionalData).digest('hex').substring(0, 8);
    return `${base}_${hash}`;
  }
  
  return base;
}

/**
 * Convert Stripe amount to display currency using real exchange rates
 */
export async function convertStripeAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string = 'AUD'
): Promise<{ amount: number; currency: string; rate: number }> {
  try {
    // Import exchange rate service dynamically to avoid circular dependencies
    const { ExchangeRateService } = await import('@/lib/services/exchangeRate');
    
    const conversion = await ExchangeRateService.convertAmount(
      amount,
      fromCurrency.toUpperCase(),
      toCurrency.toUpperCase()
    );
    
    return {
      amount: Math.round(conversion.amount),
      currency: toCurrency.toUpperCase(),
      rate: conversion.rate
    };
  } catch (error) {
    // Fallback to hardcoded rates if service fails
    console.warn(`Exchange rate service failed, using fallback rates:`, error);
    
    const fallbackRates: Record<string, number> = {
      'usd_to_aud': 1.55,
      'eur_to_aud': 1.65,
      'gbp_to_aud': 1.88,
      'cad_to_aud': 1.12,
      'nzd_to_aud': 0.93,
      'aud_to_aud': 1.0,
    };
    
    const conversionKey = `${fromCurrency.toLowerCase()}_to_${toCurrency.toLowerCase()}`;
    const rate = fallbackRates[conversionKey] || 1.0;
    
    return {
      amount: Math.round(amount * rate),
      currency: toCurrency.toUpperCase(),
      rate
    };
  }
}

/**
 * Synchronous version for backwards compatibility (uses cached rates or fallback)
 */
export function convertStripeAmountSync(
  amount: number,
  fromCurrency: string,
  toCurrency: string = 'AUD'
): { amount: number; currency: string } {
  // Fallback rates for immediate conversion
  const fallbackRates: Record<string, number> = {
    'usd_to_aud': 1.55,
    'eur_to_aud': 1.65,
    'gbp_to_aud': 1.88,
    'cad_to_aud': 1.12,
    'nzd_to_aud': 0.93,
    'aud_to_aud': 1.0,
  };
  
  const conversionKey = `${fromCurrency.toLowerCase()}_to_${toCurrency.toLowerCase()}`;
  const rate = fallbackRates[conversionKey] || 1.0;
  
  return {
    amount: Math.round(amount * rate),
    currency: toCurrency.toUpperCase(),
  };
}

/**
 * Determine if a Stripe event is a test event
 */
export function isTestEvent(event: any): boolean {
  return !event.livemode && (
    event.id?.startsWith('evt_test_') ||
    event.data?.object?.id?.includes('test')
  );
}

/**
 * Extract metadata from Stripe object safely
 */
export function extractStripeMetadata(
  stripeObject: any,
  key: string,
  defaultValue?: any
): any {
  return stripeObject?.metadata?.[key] ?? defaultValue;
}

/**
 * Validate webhook signature timing to prevent replay attacks
 */
export function isWebhookTimestampValid(
  timestamp: number,
  toleranceSeconds: number = 300 // 5 minutes
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - timestamp);
  return diff <= toleranceSeconds;
}

/**
 * Format Stripe error for user display
 */
export function formatStripeError(error: any): {
  message: string;
  code?: string;
  type: string;
  userMessage: string;
} {
  const defaultMessage = 'An unexpected error occurred with payment processing.';
  
  if (!error) {
    return {
      message: defaultMessage,
      type: 'unknown',
      userMessage: defaultMessage,
    };
  }
  
  // Stripe error structure
  const code = error.code || error.type;
  const message = error.message || defaultMessage;
  
  // User-friendly error messages
  const userFriendlyMessages: Record<string, string> = {
    'card_declined': 'Your card was declined. Please try a different payment method.',
    'expired_card': 'Your card has expired. Please use a different card.',
    'incorrect_cvc': 'Your card\'s security code is incorrect.',
    'processing_error': 'An error occurred processing your card. Please try again.',
    'rate_limit': 'Too many requests. Please try again in a moment.',
    'authentication_required': 'Additional authentication is required for this payment.',
  };
  
  return {
    message,
    code,
    type: error.type || 'unknown',
    userMessage: userFriendlyMessages[code] || 'Please check your payment details and try again.',
  };
}

/**
 * Generate webhook signature for testing
 */
export function generateTestWebhookSignature(
  payload: string,
  secret: string,
  timestamp?: number
): string {
  const actualTimestamp = timestamp || Math.floor(Date.now() / 1000);
  const signedPayload = `${actualTimestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${actualTimestamp},v1=${signature}`;
}

/**
 * Sanitize Stripe data for logging (remove sensitive info)
 */
export function sanitizeStripeDataForLogging(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sensitiveFields = [
    'client_secret',
    'payment_method',
    'card',
    'bank_account',
    'source',
  ];
  
  const sanitized = { ...data };
  
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
}