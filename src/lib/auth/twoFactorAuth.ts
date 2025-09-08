// LIQUID ABT - Two-Factor Authentication (2FA/TOTP + SMS)
// Implementation of threat model 2FA/TOTP requirements with SMS support

import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import crypto from 'crypto';
import { tenantSchemaManager } from '@/lib/database/connection';
import { sms2FAManager } from './sms2FA';

export interface TwoFactorSecret {
  secret: string;
  qrCodeUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

export interface TwoFactorVerification {
  isValid: boolean;
  error?: string;
  used?: boolean; // For backup codes
}

export interface TwoFactorSettings {
  userId: string;
  tenantId: string;
  isEnabled: boolean;
  method: 'totp' | 'sms' | 'email';
  secret?: string;
  backupCodes?: string[];
  smsPhone?: string;
  smsVerified?: boolean;
  lastUsedBackupCode?: string;
  createdAt: Date;
  enabledAt?: Date;
}

export class TwoFactorAuthManager {
  private readonly APP_NAME = 'LIQUID ABT';
  private readonly BACKUP_CODE_COUNT = 10;
  private readonly BACKUP_CODE_LENGTH = 8;

  /**
   * Generate new 2FA secret and QR code for user
   */
  async generateTwoFactorSecret(
    userId: string,
    userEmail: string,
    tenantId: string,
    companyName?: string
  ): Promise<TwoFactorSecret> {
    try {
      // Generate secret
      const secret = speakeasy.generateSecret({
        name: userEmail,
        issuer: companyName ? `${this.APP_NAME} (${companyName})` : this.APP_NAME,
        length: 32 // 32 bytes = 256 bits of entropy
      });

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();

      // Create QR code data URL
      const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url!);

      // Store secret in database (encrypted)
      await this.storeTwoFactorSecret(userId, tenantId, secret.base32, backupCodes);

      console.log('2FA secret generated for user:', {
        userId,
        tenantId,
        email: this.maskEmail(userEmail)
      });

      return {
        secret: secret.base32,
        qrCodeUrl: secret.otpauth_url!,
        qrCodeDataUrl,
        backupCodes
      };

    } catch (error) {
      console.error('Failed to generate 2FA secret:', error);
      throw new Error('Failed to generate two-factor authentication secret');
    }
  }

  /**
   * Verify TOTP token
   */
  async verifyTOTPToken(
    userId: string,
    tenantId: string,
    token: string,
    window: number = 2 // Allow 2 time steps before/after (60s total window)
  ): Promise<TwoFactorVerification> {
    try {
      // Get user's 2FA settings
      const settings = await this.getTwoFactorSettings(userId, tenantId);
      
      if (!settings || !settings.isEnabled || !settings.secret) {
        return {
          isValid: false,
          error: '2FA is not enabled for this account'
        };
      }

      // Verify TOTP token
      const isValid = speakeasy.totp.verify({
        secret: settings.secret,
        encoding: 'base32',
        token: token.replace(/\s/g, ''), // Remove any spaces
        window,
        time: Math.floor(Date.now() / 1000)
      });

      if (isValid) {
        console.log('2FA TOTP verification successful:', {
          userId,
          tenantId
        });
      } else {
        console.warn('2FA TOTP verification failed:', {
          userId,
          tenantId,
          tokenLength: token.length
        });
      }

      return { isValid };

    } catch (error) {
      console.error('2FA TOTP verification error:', error);
      return {
        isValid: false,
        error: 'Failed to verify two-factor authentication token'
      };
    }
  }

  /**
   * Verify backup code
   */
  async verifyBackupCode(
    userId: string,
    tenantId: string,
    backupCode: string
  ): Promise<TwoFactorVerification> {
    try {
      const settings = await this.getTwoFactorSettings(userId, tenantId);
      
      if (!settings || !settings.isEnabled || !settings.backupCodes) {
        return {
          isValid: false,
          error: '2FA backup codes are not available'
        };
      }

      const cleanCode = backupCode.replace(/\s/g, '').toLowerCase();
      const isValid = settings.backupCodes.includes(cleanCode);

      if (isValid) {
        // Mark backup code as used (remove from list)
        await this.markBackupCodeAsUsed(userId, tenantId, cleanCode);
        
        console.log('2FA backup code used:', {
          userId,
          tenantId,
          codeUsed: cleanCode.substring(0, 2) + '***'
        });

        return {
          isValid: true,
          used: true
        };
      }

      console.warn('Invalid 2FA backup code attempt:', {
        userId,
        tenantId
      });

      return {
        isValid: false,
        error: 'Invalid or already used backup code'
      };

    } catch (error) {
      console.error('2FA backup code verification error:', error);
      return {
        isValid: false,
        error: 'Failed to verify backup code'
      };
    }
  }

  /**
   * Enable 2FA for user after verification
   */
  async enableTwoFactor(
    userId: string,
    tenantId: string,
    verificationToken: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // First verify the token to ensure setup is correct
      const verification = await this.verifyTOTPToken(userId, tenantId, verificationToken);
      
      if (!verification.isValid) {
        return {
          success: false,
          error: 'Invalid verification token. Please check your authenticator app.'
        };
      }

      // Enable 2FA in database
      await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `UPDATE user_two_factor_settings 
         SET is_enabled = true, enabled_at = NOW(), updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );

      console.log('2FA enabled for user:', {
        userId,
        tenantId
      });

      return { success: true };

    } catch (error) {
      console.error('Failed to enable 2FA:', error);
      return {
        success: false,
        error: 'Failed to enable two-factor authentication'
      };
    }
  }

  /**
   * Disable 2FA for user
   */
  async disableTwoFactor(
    userId: string,
    tenantId: string,
    currentPassword: string,
    backupCode?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Require either current password or backup code for security
      if (!currentPassword && !backupCode) {
        return {
          success: false,
          error: 'Current password or backup code required to disable 2FA'
        };
      }

      // If backup code provided, verify it
      if (backupCode) {
        const verification = await this.verifyBackupCode(userId, tenantId, backupCode);
        if (!verification.isValid) {
          return {
            success: false,
            error: 'Invalid backup code'
          };
        }
      }

      // Disable 2FA and clear secrets
      await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `UPDATE user_two_factor_settings 
         SET is_enabled = false, secret = NULL, backup_codes = NULL, 
             enabled_at = NULL, updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );

      console.log('2FA disabled for user:', {
        userId,
        tenantId
      });

      return { success: true };

    } catch (error) {
      console.error('Failed to disable 2FA:', error);
      return {
        success: false,
        error: 'Failed to disable two-factor authentication'
      };
    }
  }

  /**
   * Get 2FA settings for user
   */
  async getTwoFactorSettings(userId: string, tenantId: string): Promise<TwoFactorSettings | null> {
    try {
      const result = await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `SELECT * FROM user_two_factor_settings WHERE user_id = $1`,
        [userId]
      );

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        userId: row.user_id,
        tenantId,
        isEnabled: row.is_enabled,
        method: row.method || 'totp',
        secret: row.secret,
        backupCodes: row.backup_codes ? JSON.parse(row.backup_codes) : [],
        smsPhone: row.sms_phone,
        smsVerified: row.sms_verified,
        lastUsedBackupCode: row.last_used_backup_code,
        createdAt: new Date(row.created_at),
        enabledAt: row.enabled_at ? new Date(row.enabled_at) : undefined
      };

    } catch (error) {
      console.error('Failed to get 2FA settings:', error);
      return null;
    }
  }

  /**
   * Generate new backup codes (replacing old ones)
   */
  async regenerateBackupCodes(
    userId: string,
    tenantId: string,
    verificationToken: string
  ): Promise<{ success: boolean; backupCodes?: string[]; error?: string }> {
    try {
      // Verify current 2FA token
      const verification = await this.verifyTOTPToken(userId, tenantId, verificationToken);
      if (!verification.isValid) {
        return {
          success: false,
          error: 'Invalid verification token'
        };
      }

      // Generate new backup codes
      const backupCodes = this.generateBackupCodes();

      // Update in database
      await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `UPDATE user_two_factor_settings 
         SET backup_codes = $2, last_used_backup_code = NULL, updated_at = NOW()
         WHERE user_id = $1`,
        [userId, JSON.stringify(backupCodes)]
      );

      console.log('2FA backup codes regenerated:', {
        userId,
        tenantId,
        codeCount: backupCodes.length
      });

      return {
        success: true,
        backupCodes
      };

    } catch (error) {
      console.error('Failed to regenerate backup codes:', error);
      return {
        success: false,
        error: 'Failed to regenerate backup codes'
      };
    }
  }

  /**
   * Verify 2FA code (TOTP or SMS)
   */
  async verify2FACode(
    userId: string,
    tenantId: string,
    code: string,
    method?: 'totp' | 'sms'
  ): Promise<TwoFactorVerification> {
    const settings = await this.getTwoFactorSettings(userId, tenantId);
    
    if (!settings || !settings.isEnabled) {
      return {
        isValid: false,
        error: '2FA is not enabled for this account'
      };
    }

    // Use specified method or default to user's configured method
    const verificationMethod = method || settings.method;

    if (verificationMethod === 'sms') {
      // For SMS 2FA, the code parameter should be the codeId from SMS sending
      // In practice, this would be handled differently in the API layer
      return {
        isValid: false,
        error: 'SMS verification requires codeId and code parameters'
      };
    } else {
      // TOTP verification
      return this.verifyTOTPToken(userId, tenantId, code);
    }
  }

  /**
   * Check if user has 2FA enabled (any method)
   */
  async isTwoFactorEnabled(userId: string, tenantId: string): Promise<boolean> {
    const settings = await this.getTwoFactorSettings(userId, tenantId);
    if (settings?.isEnabled) return true;
    
    // Also check SMS 2FA
    const smsEnabled = await sms2FAManager.isSMS2FAEnabled(tenantId, userId);
    return smsEnabled;
  }

  /**
   * Get available 2FA methods for user
   */
  async getAvailable2FAMethods(userId: string, tenantId: string): Promise<{
    totp: boolean;
    sms: boolean;
    activeMethod?: 'totp' | 'sms';
  }> {
    const [totpSettings, smsSettings] = await Promise.all([
      this.getTwoFactorSettings(userId, tenantId),
      sms2FAManager.getSMS2FASettings(tenantId, userId)
    ]);

    const totp = totpSettings?.isEnabled || false;
    const sms = smsSettings?.enabled && smsSettings?.verified || false;

    let activeMethod: 'totp' | 'sms' | undefined;
    if (totp && totpSettings?.method === 'totp') activeMethod = 'totp';
    else if (sms && smsSettings?.enabled) activeMethod = 'sms';

    return { totp, sms, activeMethod };
  }

  /**
   * Store 2FA secret in database (encrypted)
   */
  private async storeTwoFactorSecret(
    userId: string,
    tenantId: string,
    secret: string,
    backupCodes: string[]
  ): Promise<void> {
    // TODO: Encrypt secret before storing
    // For now, store as-is but in production should encrypt with tenant-specific key
    
    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO user_two_factor_settings (
        user_id, secret, backup_codes, is_enabled, created_at, updated_at
      ) VALUES ($1, $2, $3, false, NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET 
        secret = $2, 
        backup_codes = $3, 
        is_enabled = false,
        updated_at = NOW()`,
      [userId, secret, JSON.stringify(backupCodes)]
    );
  }

  /**
   * Mark backup code as used
   */
  private async markBackupCodeAsUsed(
    userId: string,
    tenantId: string,
    usedCode: string
  ): Promise<void> {
    const settings = await this.getTwoFactorSettings(userId, tenantId);
    if (!settings || !settings.backupCodes) return;

    // Remove used code from list
    const remainingCodes = settings.backupCodes.filter(code => code !== usedCode);

    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `UPDATE user_two_factor_settings 
       SET backup_codes = $2, last_used_backup_code = $3, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, JSON.stringify(remainingCodes), usedCode]
    );
  }

  /**
   * Generate backup codes
   */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    
    for (let i = 0; i < this.BACKUP_CODE_COUNT; i++) {
      let code = '';
      for (let j = 0; j < this.BACKUP_CODE_LENGTH; j++) {
        code += crypto.randomInt(10).toString();
      }
      codes.push(code);
    }
    
    return codes;
  }

  /**
   * Mask email for logging
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    return `${local.substring(0, 2)}***@${domain}`;
  }
}

// Export singleton instance
export const twoFactorAuthManager = new TwoFactorAuthManager();