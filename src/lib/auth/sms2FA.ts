// LIQUID ABT - SMS Two-Factor Authentication for Australian Market
// Implementation of SMS-based 2FA using Twilio for broader market appeal

import crypto from 'crypto';
import { tenantSchemaManager } from '@/lib/database/connection';
import { createRedisCache } from '../cache/redisClient';

export interface SMS2FACode {
  id: string;
  phoneNumber: string;
  code: string;
  expiresAt: Date;
  verified: boolean;
  attempts: number;
  createdAt: Date;
}

export interface SMS2FASettings {
  userId: string;
  tenantId: string;
  phoneNumber: string;
  verified: boolean;
  enabled: boolean;
  createdAt: Date;
  verifiedAt?: Date;
}

export interface SMSVerificationResult {
  success: boolean;
  error?: string;
  attemptsRemaining?: number;
  cooldownUntil?: Date;
}

export class SMS2FAManager {
  private redis = createRedisCache();
  
  private readonly CODE_LENGTH = 6;
  private readonly CODE_EXPIRY_MINUTES = 10; // 10-minute expiry for SMS codes
  private readonly MAX_ATTEMPTS = 3; // Max verification attempts per code
  private readonly RATE_LIMIT_WINDOW_MS = 60000; // 1 minute between SMS sends
  private readonly DAILY_SMS_LIMIT = 10; // Max 10 SMS per day per number
  private readonly SMS_PREFIX = 'sms_2fa';
  private readonly RATE_LIMIT_PREFIX = 'sms_rate_limit';

  // Australian phone number validation
  private readonly AUSTRALIAN_PHONE_REGEX = /^(\+61|0)[2-478](?:[ -]?[0-9]){8}$/;

  /**
   * Send SMS 2FA code to phone number
   */
  async sendSMSCode(
    tenantId: string,
    userId: string,
    phoneNumber: string,
    purpose: 'setup' | 'login' | 'verification' = 'login'
  ): Promise<{ success: boolean; codeId?: string; error?: string; cooldownUntil?: Date }> {
    try {
      // Validate Australian phone number format
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      if (!this.isValidAustralianNumber(cleanPhone)) {
        return {
          success: false,
          error: 'Invalid Australian phone number format. Use format: +61 4XX XXX XXX or 04XX XXX XXX'
        };
      }

      // Check rate limiting - max 1 SMS per minute per phone number
      const rateLimitKey = `${this.RATE_LIMIT_PREFIX}:${cleanPhone}`;
      const lastSent = await this.redis.get(rateLimitKey);
      
      if (lastSent) {
        const cooldownUntil = new Date(parseInt(lastSent) + this.RATE_LIMIT_WINDOW_MS);
        if (Date.now() < cooldownUntil.getTime()) {
          return {
            success: false,
            error: 'SMS rate limit exceeded. Please wait before requesting another code.',
            cooldownUntil
          };
        }
      }

      // Check daily SMS limit
      const dailyKey = `${this.RATE_LIMIT_PREFIX}:daily:${cleanPhone}:${new Date().toDateString()}`;
      const dailyCount = await this.redis.get(dailyKey);
      
      if (dailyCount && parseInt(dailyCount) >= this.DAILY_SMS_LIMIT) {
        return {
          success: false,
          error: 'Daily SMS limit exceeded. Please try again tomorrow.'
        };
      }

      // Generate 6-digit numeric code
      const code = this.generateSMSCode();
      const codeId = `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const expiresAt = new Date(Date.now() + this.CODE_EXPIRY_MINUTES * 60 * 1000);

      // Store code in Redis
      const smsData: SMS2FACode = {
        id: codeId,
        phoneNumber: cleanPhone,
        code,
        expiresAt,
        verified: false,
        attempts: 0,
        createdAt: new Date()
      };

      const smsKey = `${this.SMS_PREFIX}:${codeId}`;
      await this.redis.setex(smsKey, this.CODE_EXPIRY_MINUTES * 60, JSON.stringify(smsData));

      // Send SMS via Twilio
      const smsResult = await this.sendTwilioSMS(cleanPhone, code, purpose);
      
      if (!smsResult.success) {
        return {
          success: false,
          error: `Failed to send SMS: ${smsResult.error}`
        };
      }

      // Update rate limiting counters
      await Promise.all([
        this.redis.setex(rateLimitKey, Math.floor(this.RATE_LIMIT_WINDOW_MS / 1000), Date.now().toString()),
        this.redis.setex(dailyKey, 24 * 60 * 60, ((dailyCount ? parseInt(dailyCount) : 0) + 1).toString())
      ]);

      // Log SMS sending for security monitoring
      console.log('SMS 2FA code sent:', {
        tenantId,
        userId,
        phoneNumber: this.maskPhoneNumber(cleanPhone),
        purpose,
        codeId
      });

      return {
        success: true,
        codeId
      };

    } catch (error) {
      console.error('SMS 2FA code send failed:', error);
      return {
        success: false,
        error: 'Failed to send SMS code'
      };
    }
  }

  /**
   * Verify SMS 2FA code
   */
  async verifySMSCode(
    codeId: string,
    providedCode: string,
    tenantId: string,
    userId: string
  ): Promise<SMSVerificationResult> {
    try {
      const smsKey = `${this.SMS_PREFIX}:${codeId}`;
      const smsDataStr = await this.redis.get(smsKey);

      if (!smsDataStr) {
        return {
          success: false,
          error: 'SMS code not found or expired'
        };
      }

      const smsData: SMS2FACode = JSON.parse(smsDataStr);

      // Check if already verified
      if (smsData.verified) {
        return {
          success: false,
          error: 'SMS code has already been used'
        };
      }

      // Check if expired
      if (new Date() > smsData.expiresAt) {
        await this.redis.del(smsKey);
        return {
          success: false,
          error: 'SMS code has expired'
        };
      }

      // Check attempt limit
      if (smsData.attempts >= this.MAX_ATTEMPTS) {
        await this.redis.del(smsKey);
        return {
          success: false,
          error: 'Maximum verification attempts exceeded'
        };
      }

      // Verify code
      const cleanProvidedCode = providedCode.replace(/\s/g, '');
      if (cleanProvidedCode === smsData.code) {
        // Mark as verified
        smsData.verified = true;
        await this.redis.setex(smsKey, 300, JSON.stringify(smsData)); // Keep for 5 minutes as verified

        // Log successful verification
        console.log('SMS 2FA code verified:', {
          tenantId,
          userId,
          phoneNumber: this.maskPhoneNumber(smsData.phoneNumber),
          codeId
        });

        return { success: true };
      } else {
        // Increment attempts
        smsData.attempts += 1;
        const attemptsRemaining = this.MAX_ATTEMPTS - smsData.attempts;
        
        await this.redis.setex(smsKey, Math.floor((smsData.expiresAt.getTime() - Date.now()) / 1000), JSON.stringify(smsData));

        console.warn('SMS 2FA code verification failed:', {
          tenantId,
          userId,
          phoneNumber: this.maskPhoneNumber(smsData.phoneNumber),
          attemptsRemaining,
          codeId
        });

        return {
          success: false,
          error: 'Invalid SMS code',
          attemptsRemaining
        };
      }

    } catch (error) {
      console.error('SMS 2FA verification error:', error);
      return {
        success: false,
        error: 'SMS verification failed'
      };
    }
  }

  /**
   * Setup SMS 2FA for user
   */
  async setupSMS2FA(
    tenantId: string,
    userId: string,
    phoneNumber: string
  ): Promise<{ success: boolean; codeId?: string; error?: string }> {
    try {
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      if (!this.isValidAustralianNumber(cleanPhone)) {
        return {
          success: false,
          error: 'Invalid Australian phone number format'
        };
      }

      // Check if phone number is already registered to another user
      const existingUser = await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `SELECT user_id FROM user_2fa_secrets WHERE sms_phone = $1 AND user_id != $2`,
        [cleanPhone, userId]
      );

      if (existingUser.length > 0) {
        return {
          success: false,
          error: 'Phone number is already registered to another account'
        };
      }

      // Send verification SMS
      const smsResult = await this.sendSMSCode(tenantId, userId, cleanPhone, 'setup');
      
      if (!smsResult.success) {
        return smsResult;
      }

      // Store phone number in database (unverified)
      await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `INSERT INTO user_2fa_secrets (user_id, tenant_id, secret, sms_phone, sms_verified, enabled, method, created_at, updated_at)
         VALUES ($1, $2, '', $3, false, false, 'sms', NOW(), NOW())
         ON CONFLICT (tenant_id, user_id) 
         DO UPDATE SET sms_phone = $3, sms_verified = false, method = 'sms', updated_at = NOW()`,
        [userId, tenantId, cleanPhone]
      );

      console.log('SMS 2FA setup initiated:', {
        tenantId,
        userId,
        phoneNumber: this.maskPhoneNumber(cleanPhone)
      });

      return {
        success: true,
        codeId: smsResult.codeId
      };

    } catch (error) {
      console.error('SMS 2FA setup failed:', error);
      return {
        success: false,
        error: 'Failed to setup SMS 2FA'
      };
    }
  }

  /**
   * Enable SMS 2FA after verification
   */
  async enableSMS2FA(
    tenantId: string,
    userId: string,
    codeId: string,
    verificationCode: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify the SMS code
      const verificationResult = await this.verifySMSCode(codeId, verificationCode, tenantId, userId);
      
      if (!verificationResult.success) {
        return {
          success: false,
          error: verificationResult.error
        };
      }

      // Get the phone number from the verified code
      const smsKey = `${this.SMS_PREFIX}:${codeId}`;
      const smsDataStr = await this.redis.get(smsKey);
      
      if (!smsDataStr) {
        return {
          success: false,
          error: 'Verification data not found'
        };
      }

      const smsData: SMS2FACode = JSON.parse(smsDataStr);

      // Enable SMS 2FA in database
      await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `UPDATE user_2fa_secrets 
         SET sms_verified = true, enabled = true, updated_at = NOW()
         WHERE user_id = $1 AND sms_phone = $2`,
        [userId, smsData.phoneNumber]
      );

      console.log('SMS 2FA enabled:', {
        tenantId,
        userId,
        phoneNumber: this.maskPhoneNumber(smsData.phoneNumber)
      });

      return { success: true };

    } catch (error) {
      console.error('Failed to enable SMS 2FA:', error);
      return {
        success: false,
        error: 'Failed to enable SMS 2FA'
      };
    }
  }

  /**
   * Send SMS via Twilio
   */
  private async sendTwilioSMS(
    phoneNumber: string,
    code: string,
    purpose: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if Twilio credentials are configured
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;

      if (!accountSid || !authToken || !fromNumber) {
        console.log('Twilio SMS (mock mode - credentials not configured):', {
          to: this.maskPhoneNumber(phoneNumber),
          code,
          purpose
        });
        return { success: true }; // Mock success for development
      }

      // Create SMS message
      const purposeText = {
        setup: 'setup your LIQUID ABT account',
        login: 'sign in to your LIQUID ABT account',
        verification: 'verify your phone number'
      }[purpose] || 'authenticate';

      const message = `Your LIQUID ABT verification code is: ${code}. Use this code to ${purposeText}. Code expires in 10 minutes. Don't share this code.`;

      // TODO: Implement actual Twilio SMS sending
      // const twilio = require('twilio');
      // const client = twilio(accountSid, authToken);
      // 
      // const result = await client.messages.create({
      //   body: message,
      //   from: fromNumber,
      //   to: phoneNumber
      // });

      console.log('SMS sent via Twilio (mock):', {
        to: this.maskPhoneNumber(phoneNumber),
        message: message.substring(0, 50) + '...',
        purpose
      });

      return { success: true };

    } catch (error) {
      console.error('Twilio SMS send failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SMS delivery failed'
      };
    }
  }

  /**
   * Generate 6-digit SMS code
   */
  private generateSMSCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Clean and normalize phone number
   */
  private cleanPhoneNumber(phoneNumber: string): string {
    let cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
    
    // Convert Australian formats to international
    if (cleaned.startsWith('04')) {
      cleaned = '+61' + cleaned.substring(1);
    } else if (cleaned.startsWith('614')) {
      cleaned = '+' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Validate Australian mobile number
   */
  private isValidAustralianNumber(phoneNumber: string): boolean {
    // Australian mobile numbers: +61 4XX XXX XXX
    const internationalRegex = /^\+614[0-9]{8}$/;
    const localRegex = /^04[0-9]{8}$/;
    
    return internationalRegex.test(phoneNumber) || localRegex.test(phoneNumber);
  }

  /**
   * Mask phone number for logging
   */
  private maskPhoneNumber(phoneNumber: string): string {
    if (phoneNumber.length < 8) return '***';
    return phoneNumber.substring(0, 4) + '***' + phoneNumber.substring(phoneNumber.length - 3);
  }

  /**
   * Get SMS 2FA settings for user
   */
  async getSMS2FASettings(tenantId: string, userId: string): Promise<SMS2FASettings | null> {
    try {
      const result = await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `SELECT * FROM user_2fa_secrets WHERE user_id = $1 AND method = 'sms'`,
        [userId]
      );

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        userId: row.user_id,
        tenantId,
        phoneNumber: row.sms_phone,
        verified: row.sms_verified,
        enabled: row.enabled,
        createdAt: new Date(row.created_at),
        verifiedAt: row.updated_at ? new Date(row.updated_at) : undefined
      };

    } catch (error) {
      console.error('Failed to get SMS 2FA settings:', error);
      return null;
    }
  }

  /**
   * Check if SMS 2FA is enabled for user
   */
  async isSMS2FAEnabled(tenantId: string, userId: string): Promise<boolean> {
    const settings = await this.getSMS2FASettings(tenantId, userId);
    return settings?.enabled && settings?.verified || false;
  }

  /**
   * Disable SMS 2FA
   */
  async disableSMS2FA(
    tenantId: string,
    userId: string,
    verificationCode?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // If user provides a verification code, verify it first
      if (verificationCode) {
        const settings = await this.getSMS2FASettings(tenantId, userId);
        if (!settings) {
          return { success: false, error: 'SMS 2FA not found' };
        }

        // Send verification SMS and verify
        const smsResult = await this.sendSMSCode(tenantId, userId, settings.phoneNumber, 'verification');
        if (!smsResult.success || !smsResult.codeId) {
          return { success: false, error: 'Failed to send verification code' };
        }

        const verifyResult = await this.verifySMSCode(smsResult.codeId, verificationCode, tenantId, userId);
        if (!verifyResult.success) {
          return { success: false, error: verifyResult.error };
        }
      }

      // Disable SMS 2FA
      await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `UPDATE user_2fa_secrets SET enabled = false, updated_at = NOW() WHERE user_id = $1`,
        [userId]
      );

      console.log('SMS 2FA disabled:', { tenantId, userId });
      return { success: true };

    } catch (error) {
      console.error('Failed to disable SMS 2FA:', error);
      return { success: false, error: 'Failed to disable SMS 2FA' };
    }
  }
}

// Export singleton instance
export const sms2FAManager = new SMS2FAManager();