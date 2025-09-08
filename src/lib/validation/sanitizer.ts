// LIQUID ABT - Input Validation and Sanitization
// Comprehensive input validation and XSS protection

import validator from 'validator';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Initialize DOMPurify for server-side sanitization
const window = new JSDOM('').window;
const purify = DOMPurify(window as any);

// Configure DOMPurify for strict sanitization
purify.setConfig({
  WHOLE_DOCUMENT: false,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  RETURN_DOM_IMPORT: false,
  SANITIZE_DOM: true,
  KEEP_CONTENT: false,
  ADD_TAGS: [], // No additional tags allowed
  ADD_ATTR: [], // No additional attributes allowed
  FORBID_TAGS: ['script', 'object', 'embed', 'applet', 'meta', 'link'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style']
});

// Common validation patterns
export const VALIDATION_PATTERNS = {
  // Business and contact information
  BUSINESS_NAME: /^[a-zA-Z0-9\s\-\&\.\,\'\(\)]{1,100}$/,
  PERSON_NAME: /^[a-zA-Z\s\-\'\.\,]{1,50}$/,
  PHONE: /^[\+]?[\d\s\-\(\)]{7,20}$/,
  
  // Financial
  CURRENCY_CODE: /^[A-Z]{3}$/,
  AMOUNT: /^\d+(\.\d{1,8})?$/,
  BITCOIN_ADDRESS: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[02-9ac-hj-np-z]{7,87}$/,
  
  // Technical identifiers
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  TENANT_ID: /^tenant_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  
  // Web and API
  WEBHOOK_URL: /^https:\/\/[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}\/.*/,
  API_KEY: /^[a-zA-Z0-9_\-]{20,128}$/,
  
  // Treasury rules
  PERCENTAGE: /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/,
  TREASURY_RULE_NAME: /^[a-zA-Z0-9\s\-\_]{1,50}$/,
} as const;

// Input sanitization functions
export class InputSanitizer {
  /**
   * Sanitize HTML content to prevent XSS attacks
   */
  static sanitizeHtml(input: string): string {
    if (typeof input !== 'string') return '';
    return purify.sanitize(input, { USE_PROFILES: { html: false } });
  }

  /**
   * Sanitize text content (remove HTML, normalize whitespace)
   */
  static sanitizeText(input: string, maxLength: number = 1000): string {
    if (typeof input !== 'string') return '';
    
    // Remove HTML tags and normalize whitespace
    let sanitized = input
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
    
    // Truncate if too long
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }
    
    return sanitized;
  }

  /**
   * Sanitize business name (allow common business characters)
   */
  static sanitizeBusinessName(input: string): string {
    if (typeof input !== 'string') return '';
    
    return input
      .replace(/[<>\"']/g, '') // Remove dangerous characters
      .replace(/\s+/g, ' ')    // Normalize spaces
      .trim()
      .substring(0, 100);      // Max length
  }

  /**
   * Sanitize person name (letters, spaces, hyphens, apostrophes only)
   */
  static sanitizePersonName(input: string): string {
    if (typeof input !== 'string') return '';
    
    return input
      .replace(/[^a-zA-Z\s\-\'\.]/g, '') // Only allow safe characters
      .replace(/\s+/g, ' ')             // Normalize spaces
      .trim()
      .substring(0, 50);                // Max length
  }

  /**
   * Sanitize email address
   */
  static sanitizeEmail(input: string): string {
    if (typeof input !== 'string') return '';
    
    const email = input.toLowerCase().trim();
    return validator.isEmail(email) ? email : '';
  }

  /**
   * Sanitize phone number
   */
  static sanitizePhone(input: string): string {
    if (typeof input !== 'string') return '';
    
    // Keep only digits, spaces, hyphens, parentheses, and plus
    return input
      .replace(/[^\d\s\-\(\)\+]/g, '')
      .trim()
      .substring(0, 20);
  }

  /**
   * Sanitize financial amounts
   */
  static sanitizeAmount(input: string | number): string {
    if (typeof input === 'number') {
      input = input.toString();
    }
    if (typeof input !== 'string') return '0';
    
    // Remove all non-numeric characters except decimal point
    const sanitized = input.replace(/[^\d\.]/g, '');
    
    // Ensure only one decimal point
    const parts = sanitized.split('.');
    if (parts.length > 2) {
      return parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Validate format
    if (VALIDATION_PATTERNS.AMOUNT.test(sanitized)) {
      return sanitized;
    }
    
    return '0';
  }

  /**
   * Sanitize Bitcoin address
   */
  static sanitizeBitcoinAddress(input: string): string {
    if (typeof input !== 'string') return '';
    
    const address = input.trim();
    return VALIDATION_PATTERNS.BITCOIN_ADDRESS.test(address) ? address : '';
  }

  /**
   * Sanitize URL (webhooks, etc.)
   */
  static sanitizeUrl(input: string): string {
    if (typeof input !== 'string') return '';
    
    const url = input.trim();
    return validator.isURL(url, { 
      protocols: ['https'], 
      require_protocol: true,
      require_host: true,
      require_valid_protocol: true
    }) ? url : '';
  }

  /**
   * Sanitize treasury rule names
   */
  static sanitizeTreasuryRuleName(input: string): string {
    if (typeof input !== 'string') return '';
    
    return input
      .replace(/[^a-zA-Z0-9\s\-\_]/g, '') // Only safe characters
      .replace(/\s+/g, ' ')               // Normalize spaces
      .trim()
      .substring(0, 50);                  // Max length
  }
}

// Input validation functions
export class InputValidator {
  /**
   * Validate business name
   */
  static isValidBusinessName(input: string): boolean {
    return typeof input === 'string' && 
           input.length >= 1 && 
           input.length <= 100 && 
           VALIDATION_PATTERNS.BUSINESS_NAME.test(input);
  }

  /**
   * Validate person name
   */
  static isValidPersonName(input: string): boolean {
    return typeof input === 'string' && 
           input.length >= 1 && 
           input.length <= 50 && 
           VALIDATION_PATTERNS.PERSON_NAME.test(input);
  }

  /**
   * Validate email address
   */
  static isValidEmail(input: string): boolean {
    return typeof input === 'string' && validator.isEmail(input);
  }

  /**
   * Validate phone number
   */
  static isValidPhone(input: string): boolean {
    return typeof input === 'string' && VALIDATION_PATTERNS.PHONE.test(input);
  }

  /**
   * Validate financial amount
   */
  static isValidAmount(input: string | number, min: number = 0, max: number = 999999999): boolean {
    const amount = typeof input === 'number' ? input : parseFloat(input);
    return !isNaN(amount) && amount >= min && amount <= max;
  }

  /**
   * Validate Bitcoin address
   */
  static isValidBitcoinAddress(input: string): boolean {
    return typeof input === 'string' && VALIDATION_PATTERNS.BITCOIN_ADDRESS.test(input);
  }

  /**
   * Validate URL
   */
  static isValidUrl(input: string, requireHttps: boolean = true): boolean {
    if (typeof input !== 'string') return false;
    
    return validator.isURL(input, {
      protocols: requireHttps ? ['https'] : ['http', 'https'],
      require_protocol: true,
      require_host: true
    });
  }

  /**
   * Validate UUID
   */
  static isValidUuid(input: string): boolean {
    return typeof input === 'string' && VALIDATION_PATTERNS.UUID.test(input);
  }

  /**
   * Validate tenant ID
   */
  static isValidTenantId(input: string): boolean {
    return typeof input === 'string' && VALIDATION_PATTERNS.TENANT_ID.test(input);
  }

  /**
   * Validate percentage (0-100)
   */
  static isValidPercentage(input: string | number): boolean {
    const percentage = typeof input === 'number' ? input : parseFloat(input);
    return !isNaN(percentage) && percentage >= 0 && percentage <= 100;
  }

  /**
   * Validate currency code (ISO 4217)
   */
  static isValidCurrencyCode(input: string): boolean {
    const validCurrencies = ['AUD', 'USD', 'EUR', 'GBP', 'BTC', 'ETH'];
    return typeof input === 'string' && validCurrencies.includes(input.toUpperCase());
  }
}

// SQL injection protection helpers
export class SqlSafety {
  /**
   * Escape SQL identifiers (table names, column names)
   */
  static escapeIdentifier(identifier: string): string {
    if (typeof identifier !== 'string') return '';
    
    // Remove dangerous characters and limit length
    return identifier
      .replace(/[^a-zA-Z0-9_]/g, '')
      .substring(0, 63); // PostgreSQL limit
  }

  /**
   * Validate SQL LIMIT clause
   */
  static validateLimit(limit: string | number): number {
    const limitNum = typeof limit === 'number' ? limit : parseInt(limit);
    return Math.min(Math.max(limitNum || 10, 1), 1000); // Between 1 and 1000
  }

  /**
   * Validate SQL OFFSET clause
   */
  static validateOffset(offset: string | number): number {
    const offsetNum = typeof offset === 'number' ? offset : parseInt(offset);
    return Math.max(offsetNum || 0, 0); // Non-negative
  }

  /**
   * Validate ORDER BY direction
   */
  static validateOrderDirection(direction: string): 'ASC' | 'DESC' {
    return direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  }
}

// Combined sanitization and validation
export class SecureInput {
  /**
   * Process user input with sanitization and validation
   */
  static processBusinessName(input: any): { value: string; isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (typeof input !== 'string') {
      errors.push('Business name must be a string');
      return { value: '', isValid: false, errors };
    }

    const sanitized = InputSanitizer.sanitizeBusinessName(input);
    
    if (!sanitized) {
      errors.push('Business name is required');
    } else if (!InputValidator.isValidBusinessName(sanitized)) {
      errors.push('Business name contains invalid characters or is too long');
    }

    return {
      value: sanitized,
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Process email input
   */
  static processEmail(input: any): { value: string; isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (typeof input !== 'string') {
      errors.push('Email must be a string');
      return { value: '', isValid: false, errors };
    }

    const sanitized = InputSanitizer.sanitizeEmail(input);
    
    if (!sanitized) {
      errors.push('Valid email address is required');
    }

    return {
      value: sanitized,
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Process financial amount
   */
  static processAmount(input: any, min: number = 0, max: number = 999999999): { value: number; isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    const sanitized = InputSanitizer.sanitizeAmount(input);
    const numericValue = parseFloat(sanitized);
    
    if (isNaN(numericValue)) {
      errors.push('Amount must be a valid number');
      return { value: 0, isValid: false, errors };
    }
    
    if (!InputValidator.isValidAmount(numericValue, min, max)) {
      errors.push(`Amount must be between ${min} and ${max}`);
    }

    return {
      value: numericValue,
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Process Bitcoin address
   */
  static processBitcoinAddress(input: any): { value: string; isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (typeof input !== 'string') {
      errors.push('Bitcoin address must be a string');
      return { value: '', isValid: false, errors };
    }

    const sanitized = InputSanitizer.sanitizeBitcoinAddress(input);
    
    if (!sanitized) {
      errors.push('Valid Bitcoin address is required');
    }

    return {
      value: sanitized,
      isValid: errors.length === 0,
      errors
    };
  }
}

// Export validation middleware for API routes
export function createValidationMiddleware<T>(
  schema: { [K in keyof T]: (input: any) => { value: T[K]; isValid: boolean; errors: string[] } }
) {
  return function validateInput(data: any): { data: T; isValid: boolean; errors: Record<string, string[]> } {
    const result = {} as T;
    const errors: Record<string, string[]> = {};
    let isValid = true;

    for (const [key, validator] of Object.entries(schema)) {
      const validation = validator(data[key]);
      result[key as keyof T] = validation.value;
      
      if (!validation.isValid) {
        errors[key] = validation.errors;
        isValid = false;
      }
    }

    return { data: result, isValid, errors };
  };
}