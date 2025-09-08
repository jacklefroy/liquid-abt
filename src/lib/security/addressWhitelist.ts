// LIQUID ABT - Bitcoin Address Whitelisting Security
// Implementation of threat model address poisoning prevention

import { tenantSchemaManager } from '@/lib/database/connection';
import { bitcoinAddressValidator } from './bitcoinAddressValidator';
import { createRedisCache } from '../cache/redisClient';
import crypto from 'crypto';

export interface WhitelistAddress {
  id: string;
  tenantId: string;
  address: string;
  label?: string;
  addressType: 'legacy' | 'segwit' | 'bech32';
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
  verificationCode?: string;
  verificationExpiry?: Date;
  isActive: boolean;
}

export interface AddressWhitelistRequest {
  address: string;
  label?: string;
  userEmail: string;
  userId: string;
  requiresDelayedApproval?: boolean;
}

export class AddressWhitelistManager {
  private redis = createRedisCache();
  
  private readonly APPROVAL_DELAY_HOURS = 48; // Threat model requirement
  private readonly VERIFICATION_CODE_LENGTH = 8;
  private readonly VERIFICATION_EXPIRY_HOURS = 24;
  private readonly MAX_ADDRESSES_PER_DAY = 5; // Rate limiting per feedback
  private readonly DAILY_RATE_LIMIT_PREFIX = 'address_whitelist_rate';

  /**
   * Request to add a Bitcoin address to whitelist
   * Implements threat model 48-hour delay requirement with enhanced security
   */
  async requestAddressWhitelisting(
    tenantId: string,
    request: AddressWhitelistRequest
  ): Promise<{ whitelistId: string; verificationCode: string; approvalTime: Date }> {
    // Enhanced Bitcoin address validation with checksum verification
    const validation = bitcoinAddressValidator.validateAddress(request.address);
    if (!validation.isValid) {
      throw new Error(`Invalid Bitcoin address: ${validation.error}`);
    }

    // Check security requirements
    const securityCheck = bitcoinAddressValidator.validateSecurityRequirements(request.address);
    if (!securityCheck.meetsRequirements) {
      throw new Error(`Address security violations: ${securityCheck.violations.join(', ')}`);
    }

    // Rate limiting check - max 5 addresses per day per tenant
    const rateLimitKey = `${this.DAILY_RATE_LIMIT_PREFIX}:${tenantId}`;
    const currentCount = await this.redis.get(rateLimitKey);
    const dailyCount = currentCount ? parseInt(currentCount) : 0;
    
    if (dailyCount >= this.MAX_ADDRESSES_PER_DAY) {
      throw new Error(`Daily address whitelist limit exceeded (${this.MAX_ADDRESSES_PER_DAY} per day)`);
    }

    // Check if address already exists in this tenant
    const existing = await this.findExistingAddress(tenantId, request.address);
    if (existing && existing.isActive) {
      throw new Error('Address already whitelisted for this account');
    }

    // Check for address reuse across the platform (security warning)
    const reuseCheck = await bitcoinAddressValidator.checkAddressReuse(request.address);
    if (reuseCheck.isReused && reuseCheck.reuseCount! > 0) {
      console.warn('Address reuse detected:', {
        address: this.maskAddress(request.address),
        reuseCount: reuseCheck.reuseCount,
        tenantId
      });
      // Don't block but log for security monitoring
    }

    // Generate verification code
    const verificationCode = this.generateVerificationCode();
    const verificationExpiry = new Date(Date.now() + this.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);
    
    // Calculate approval time (48 hours from now)
    const approvalTime = new Date(Date.now() + this.APPROVAL_DELAY_HOURS * 60 * 60 * 1000);

    // Store whitelist request
    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO bitcoin_address_whitelist (
        address, label, address_type, status, requested_at, 
        approved_at, requested_by, verification_code, verification_expiry,
        is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, false, NOW(), NOW())
      RETURNING id`,
      [
        request.address,
        request.label || '',
        validation.type,
        request.requiresDelayedApproval !== false ? 'pending' : 'approved',
        request.requiresDelayedApproval !== false ? approvalTime : new Date(),
        request.userId,
        verificationCode,
        verificationExpiry
      ]
    );

    const whitelistId = result[0].id;

    // Increment daily rate limit counter
    await this.redis.setex(rateLimitKey, 24 * 60 * 60, (dailyCount + 1).toString());

    // Send verification email (implementation would integrate with email service)
    await this.sendAddressVerificationEmail(
      request.userEmail,
      request.address,
      verificationCode,
      approvalTime,
      securityCheck.recommendations
    );

    // Log security event with enhanced details
    console.log('Address whitelist requested:', {
      tenantId,
      whitelistId,
      address: this.maskAddress(request.address),
      addressType: validation.type,
      network: validation.network,
      userId: request.userId,
      approvalTime: approvalTime.toISOString(),
      securityRecommendations: securityCheck.recommendations?.length || 0,
      dailyRequestCount: dailyCount + 1
    });

    return { whitelistId, verificationCode, approvalTime };
  }

  /**
   * Verify email confirmation for address whitelisting
   */
  async verifyAddressWhitelisting(
    tenantId: string,
    whitelistId: string,
    verificationCode: string
  ): Promise<{ verified: boolean; approvalPending: boolean }> {
    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `SELECT * FROM bitcoin_address_whitelist 
       WHERE id = $1 AND verification_code = $2 AND verification_expiry > NOW()`,
      [whitelistId, verificationCode]
    );

    if (result.length === 0) {
      throw new Error('Invalid or expired verification code');
    }

    const whitelist = result[0];

    // Mark as verified but keep pending status if approval time hasn't passed
    const now = new Date();
    const isApprovalReady = now >= new Date(whitelist.approved_at);

    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `UPDATE bitcoin_address_whitelist 
       SET verification_code = NULL, 
           status = CASE 
             WHEN $2 THEN 'approved'
             ELSE 'pending'
           END,
           is_active = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [whitelistId, isApprovalReady]
    );

    console.log('Address whitelist verified:', {
      tenantId,
      whitelistId,
      address: this.maskAddress(whitelist.address),
      approved: isApprovalReady
    });

    return {
      verified: true,
      approvalPending: !isApprovalReady
    };
  }

  /**
   * Check if address is whitelisted for withdrawals
   */
  async isAddressWhitelisted(tenantId: string, address: string): Promise<boolean> {
    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `SELECT id FROM bitcoin_address_whitelist 
       WHERE address = $1 AND is_active = true AND status = 'approved'`,
      [address]
    );

    return result.length > 0;
  }

  /**
   * Get all whitelisted addresses for tenant
   */
  async getWhitelistedAddresses(tenantId: string): Promise<WhitelistAddress[]> {
    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `SELECT * FROM bitcoin_address_whitelist 
       WHERE is_active = true 
       ORDER BY approved_at DESC`,
      []
    );

    return result.map(row => ({
      id: row.id,
      tenantId,
      address: row.address,
      label: row.label,
      addressType: row.address_type,
      status: row.status,
      requestedAt: new Date(row.requested_at),
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
      approvedBy: row.approved_by,
      isActive: row.is_active
    }));
  }

  /**
   * Remove address from whitelist
   */
  async removeWhitelistedAddress(
    tenantId: string,
    addressId: string,
    userId: string
  ): Promise<void> {
    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `UPDATE bitcoin_address_whitelist 
       SET is_active = false, updated_at = NOW()
       WHERE id = $1`,
      [addressId]
    );

    console.log('Address removed from whitelist:', {
      tenantId,
      addressId,
      userId
    });
  }

  /**
   * DEPRECATED: Use bitcoinAddressValidator instead
   * This method is kept for backward compatibility but should not be used
   */
  private validateBitcoinAddress(address: string): 'legacy' | 'segwit' | 'bech32' | null {
    console.warn('validateBitcoinAddress is deprecated, use bitcoinAddressValidator instead');
    const validation = bitcoinAddressValidator.validateAddress(address);
    return validation.isValid ? validation.type : null;
  }

  /**
   * Find existing address in whitelist
   */
  private async findExistingAddress(tenantId: string, address: string) {
    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `SELECT * FROM bitcoin_address_whitelist WHERE address = $1`,
      [address]
    );

    return result.length > 0 ? result[0] : null;
  }

  /**
   * Generate secure verification code
   */
  private generateVerificationCode(): string {
    return crypto.randomBytes(this.VERIFICATION_CODE_LENGTH / 2).toString('hex').toUpperCase();
  }

  /**
   * Mask Bitcoin address for logging (security requirement)
   */
  private maskAddress(address: string): string {
    if (address.length < 8) return '***';
    return address.substring(0, 6) + '***' + address.substring(address.length - 4);
  }

  /**
   * Send verification email (placeholder - integrate with email service)
   */
  private async sendAddressVerificationEmail(
    email: string,
    address: string,
    verificationCode: string,
    approvalTime: Date,
    securityRecommendations?: string[]
  ): Promise<void> {
    // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
    console.log('Sending address verification email:', {
      email,
      address: this.maskAddress(address),
      verificationCode,
      approvalTime: approvalTime.toISOString(),
      recommendations: securityRecommendations?.length || 0
    });

    // Email template would include:
    // - Verification code
    // - Address being whitelisted with checksum validation status
    // - 48-hour approval delay explanation
    // - Security warning about address changes
    // - Address type and security recommendations (e.g., use Bech32 for lower fees)
    // - Rate limiting information (X of 5 daily addresses used)
  }

  /**
   * Process pending approvals (called by scheduled job)
   */
  async processPendingApprovals(): Promise<number> {
    const tenantsResult = await tenantSchemaManager.query(
      `SELECT DISTINCT tenant_id FROM public.tenants WHERE is_active = true`,
      []
    );

    let processedCount = 0;

    for (const tenant of tenantsResult) {
      const tenantId = tenant.tenant_id;
      
      // Activate addresses where approval time has passed
      const result = await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `UPDATE bitcoin_address_whitelist 
         SET status = 'approved', is_active = true, updated_at = NOW()
         WHERE status = 'pending' 
         AND approved_at <= NOW() 
         AND verification_code IS NULL
         RETURNING id, address`,
        []
      );

      processedCount += result.length;

      // Log approved addresses
      for (const approved of result) {
        console.log('Address automatically approved:', {
          tenantId,
          whitelistId: approved.id,
          address: this.maskAddress(approved.address)
        });
      }
    }

    return processedCount;
  }
}