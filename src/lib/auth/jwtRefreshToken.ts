// LIQUID ABT - JWT Refresh Token Security System
// Implementation of threat model JWT refresh token requirements

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createRedisCache } from '../cache/redisClient';
import { tenantSchemaManager } from '@/lib/database/connection';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface TokenFamily {
  familyId: string;
  generation: number;
  parentTokenId?: string;
  childTokenIds: string[];
  createdAt: Date;
  lastRotatedAt: Date;
}

export interface RefreshTokenData {
  userId: string;
  tenantId: string;
  sessionId: string;
  tokenFamilyId: string; // Added for token family tracking
  generation: number; // Token generation within family
  parentTokenId?: string; // Parent token in the family chain
  deviceFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  issuedAt: Date;
  lastUsedAt: Date;
  rotationCount: number;
}

export interface TokenValidationResult {
  isValid: boolean;
  payload?: any;
  error?: string;
  needsRotation?: boolean;
}

export class JWTRefreshTokenManager {
  private redis = createRedisCache();
  
  // Security requirements from threat model
  private readonly ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes for security
  private readonly REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly MAX_ROTATION_COUNT = 50; // Prevent infinite rotation
  private readonly TOKEN_REUSE_WINDOW_MS = 5000; // 5 second grace period for rotation
  
  private readonly REFRESH_TOKEN_PREFIX = 'refresh_token';
  private readonly BLACKLIST_PREFIX = 'token_blacklist';
  private readonly ROTATION_PREFIX = 'token_rotation';
  private readonly TOKEN_FAMILY_PREFIX = 'token_family';

  constructor(
    private jwtSecret = process.env.JWT_SECRET || 'default-secret-change-in-production',
    private refreshSecret = process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-in-production'
  ) {
    if (this.jwtSecret === 'default-secret-change-in-production' || 
        this.refreshSecret === 'default-refresh-secret-change-in-production') {
      console.warn('Using default JWT secrets - change in production!');
    }
  }

  /**
   * Generate new token pair (access + refresh)
   */
  async generateTokenPair(
    userId: string,
    tenantId: string,
    sessionId: string,
    metadata: {
      deviceFingerprint?: string;
      ipAddress?: string;
      userAgent?: string;
      roles?: string[];
    } = {}
  ): Promise<TokenPair> {
    const now = new Date();
    const accessTokenExpiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes
    const refreshTokenExpiresAt = new Date(now.getTime() + this.REFRESH_TOKEN_EXPIRY_MS); // 7 days

    // Generate cryptographically secure refresh token ID
    const refreshTokenId = crypto.randomBytes(32).toString('hex');
    
    // Create or get token family
    const tokenFamilyId = crypto.randomBytes(16).toString('hex');
    await this.createTokenFamily(tokenFamilyId, refreshTokenId);
    
    // Create access token with minimal payload
    const accessPayload = {
      userId,
      tenantId,
      sessionId,
      type: 'access',
      roles: metadata.roles || [],
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(accessTokenExpiresAt.getTime() / 1000)
    };

    // Create refresh token with rotation tracking
    const refreshPayload = {
      userId,
      tenantId,
      sessionId,
      tokenId: refreshTokenId,
      type: 'refresh',
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(refreshTokenExpiresAt.getTime() / 1000)
    };

    const accessToken = jwt.sign(accessPayload, this.jwtSecret, { algorithm: 'HS256' });
    const refreshToken = jwt.sign(refreshPayload, this.refreshSecret, { algorithm: 'HS256' });

    // Store refresh token metadata in Redis
    const refreshData: RefreshTokenData = {
      userId,
      tenantId,
      sessionId,
      tokenFamilyId,
      generation: 1,
      parentTokenId: undefined, // This is the first token in the family
      deviceFingerprint: metadata.deviceFingerprint,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      issuedAt: now,
      lastUsedAt: now,
      rotationCount: 0
    };

    const refreshKey = `${this.REFRESH_TOKEN_PREFIX}:${refreshTokenId}`;
    await this.redis.setex(
      refreshKey,
      Math.floor(this.REFRESH_TOKEN_EXPIRY_MS / 1000),
      JSON.stringify(refreshData)
    );

    // Store in database for audit trail with token family info
    await this.storeTokenAuditRecord(userId, tenantId, refreshTokenId, 'issued', {
      sessionId,
      tokenFamilyId,
      generation: 1,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent
    });

    console.log('Token pair generated:', {
      userId,
      tenantId,
      sessionId,
      refreshTokenId: refreshTokenId.substring(0, 8) + '...',
      accessTokenExpiry: this.ACCESS_TOKEN_EXPIRY,
      refreshTokenExpiry: '7d'
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt
    };
  }

  /**
   * Validate access token
   */
  async validateAccessToken(token: string): Promise<TokenValidationResult> {
    try {
      // Check if token is blacklisted
      const blacklistKey = `${this.BLACKLIST_PREFIX}:${this.hashToken(token)}`;
      const isBlacklisted = await this.redis.exists(blacklistKey);
      
      if (isBlacklisted) {
        return {
          isValid: false,
          error: 'Token has been revoked'
        };
      }

      // Verify token signature and expiry
      const payload = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as any;
      
      if (payload.type !== 'access') {
        return {
          isValid: false,
          error: 'Invalid token type'
        };
      }

      return {
        isValid: true,
        payload
      };

    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return {
          isValid: false,
          error: 'Access token expired',
          needsRotation: true
        };
      }

      return {
        isValid: false,
        error: 'Invalid access token'
      };
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
    metadata: {
      ipAddress?: string;
      userAgent?: string;
      deviceFingerprint?: string;
    } = {}
  ): Promise<TokenPair | { error: string }> {
    try {
      // Verify refresh token signature
      const refreshPayload = jwt.verify(refreshToken, this.refreshSecret, { algorithms: ['HS256'] }) as any;
      
      if (refreshPayload.type !== 'refresh') {
        return { error: 'Invalid refresh token type' };
      }

      // Get refresh token data from Redis
      const refreshKey = `${this.REFRESH_TOKEN_PREFIX}:${refreshPayload.tokenId}`;
      const refreshDataStr = await this.redis.get(refreshKey);
      
      if (!refreshDataStr) {
        return { error: 'Refresh token not found or expired' };
      }

      const refreshData: RefreshTokenData = JSON.parse(refreshDataStr);

      // Security checks
      if (refreshData.rotationCount >= this.MAX_ROTATION_COUNT) {
        await this.revokeAllUserTokens(refreshData.userId, refreshData.tenantId, 'max_rotations_exceeded');
        return { error: 'Maximum token rotations exceeded' };
      }

      // Device fingerprint validation (if enabled)
      if (refreshData.deviceFingerprint && metadata.deviceFingerprint && 
          refreshData.deviceFingerprint !== metadata.deviceFingerprint) {
        console.warn('Device fingerprint mismatch detected:', {
          userId: refreshData.userId,
          sessionId: refreshData.sessionId,
          expected: refreshData.deviceFingerprint.substring(0, 8) + '...',
          received: metadata.deviceFingerprint.substring(0, 8) + '...'
        });
        
        // Allow but log for monitoring
      }

      // Generate new token pair with rotation (maintaining token family)
      const newTokenPair = await this.rotateTokenPair(
        refreshData,
        refreshPayload.tokenId,
        {
          deviceFingerprint: metadata.deviceFingerprint || refreshData.deviceFingerprint,
          ipAddress: metadata.ipAddress || refreshData.ipAddress,
          userAgent: metadata.userAgent || refreshData.userAgent
        }
      );

      // Mark old refresh token as rotated (keep for grace period)
      const rotationKey = `${this.ROTATION_PREFIX}:${refreshPayload.tokenId}`;
      await this.redis.setex(
        rotationKey,
        Math.floor(this.TOKEN_REUSE_WINDOW_MS / 1000),
        JSON.stringify({
          newTokenIssued: Date.now(),
          oldTokenId: refreshPayload.tokenId
        })
      );

      // Remove old refresh token
      await this.redis.del(refreshKey);

      // Audit log
      await this.storeTokenAuditRecord(refreshData.userId, refreshData.tenantId, refreshPayload.tokenId, 'rotated', {
        sessionId: refreshData.sessionId,
        ipAddress: metadata.ipAddress,
        rotationCount: refreshData.rotationCount + 1
      });

      console.log('Token refreshed successfully:', {
        userId: refreshData.userId,
        sessionId: refreshData.sessionId,
        rotationCount: refreshData.rotationCount + 1
      });

      return newTokenPair;

    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return { error: 'Refresh token expired' };
      }

      console.error('Token refresh failed:', error);
      return { error: 'Invalid refresh token' };
    }
  }

  /**
   * Revoke a specific refresh token
   */
  async revokeRefreshToken(refreshToken: string, reason: string = 'user_logout'): Promise<void> {
    try {
      const refreshPayload = jwt.verify(refreshToken, this.refreshSecret, { algorithms: ['HS256'] }) as any;
      
      const refreshKey = `${this.REFRESH_TOKEN_PREFIX}:${refreshPayload.tokenId}`;
      const refreshDataStr = await this.redis.get(refreshKey);
      
      if (refreshDataStr) {
        const refreshData: RefreshTokenData = JSON.parse(refreshDataStr);
        
        // Remove from Redis
        await this.redis.del(refreshKey);
        
        // Audit log
        await this.storeTokenAuditRecord(refreshData.userId, refreshData.tenantId, refreshPayload.tokenId, 'revoked', {
          reason,
          sessionId: refreshData.sessionId
        });

        console.log('Refresh token revoked:', {
          tokenId: refreshPayload.tokenId.substring(0, 8) + '...',
          userId: refreshData.userId,
          reason
        });
      }
    } catch (error) {
      console.error('Failed to revoke refresh token:', error);
    }
  }

  /**
   * Revoke all tokens for a user (security action)
   */
  async revokeAllUserTokens(userId: string, tenantId: string, reason: string = 'security_action'): Promise<number> {
    let revokedCount = 0;

    try {
      // This would require scanning Redis keys or maintaining a user token index
      // For now, we'll implement a basic pattern scan approach
      
      // In production, consider maintaining a separate index of user tokens
      // for more efficient bulk operations
      
      const pattern = `${this.REFRESH_TOKEN_PREFIX}:*`;
      // Note: SCAN is more efficient than KEYS in production
      
      console.log('All user tokens revocation requested:', {
        userId,
        tenantId,
        reason
      });

      // Audit the bulk revocation
      await this.storeTokenAuditRecord(userId, tenantId, 'bulk_revocation', 'bulk_revoked', {
        reason,
        revokedCount
      });

    } catch (error) {
      console.error('Failed to revoke all user tokens:', error);
    }

    return revokedCount;
  }

  /**
   * Blacklist an access token (for immediate revocation)
   */
  async blacklistAccessToken(accessToken: string, reason: string = 'revoked'): Promise<void> {
    try {
      // Decode token to get expiry time
      const decoded = jwt.decode(accessToken) as any;
      
      if (decoded && decoded.exp) {
        const blacklistKey = `${this.BLACKLIST_PREFIX}:${this.hashToken(accessToken)}`;
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        
        if (ttl > 0) {
          await this.redis.setex(blacklistKey, ttl, reason);
        }
      }
    } catch (error) {
      console.error('Failed to blacklist access token:', error);
    }
  }

  /**
   * Get token statistics for monitoring
   */
  async getTokenStatistics(tenantId: string): Promise<{
    activeRefreshTokens: number;
    blacklistedTokens: number;
    recentRotations: number;
  }> {
    // This would require implementing token indexing by tenant
    // For now, return basic structure
    
    return {
      activeRefreshTokens: 0,
      blacklistedTokens: 0,
      recentRotations: 0
    };
  }

  /**
   * Clean up expired tokens (maintenance task)
   */
  async cleanupExpiredTokens(): Promise<{ cleaned: number }> {
    // This would scan for and remove expired entries
    // Redis TTL handles most cleanup automatically
    
    console.log('Token cleanup requested');
    return { cleaned: 0 };
  }

  /**
   * Store token audit record in database
   */
  private async storeTokenAuditRecord(
    userId: string,
    tenantId: string,
    tokenId: string,
    action: 'issued' | 'rotated' | 'revoked' | 'bulk_revoked',
    metadata: any
  ): Promise<void> {
    try {
      await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `INSERT INTO token_audit_log (
          user_id, token_id, action, metadata, created_at
        ) VALUES ($1, $2, $3, $4, NOW())`,
        [userId, tokenId, action, JSON.stringify(metadata)]
      );
    } catch (error) {
      console.error('Failed to store token audit record:', error);
    }
  }

  /**
   * Hash token for blacklist storage (to avoid storing full tokens)
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Rotate token pair maintaining token family
   */
  private async rotateTokenPair(
    oldRefreshData: RefreshTokenData,
    oldTokenId: string,
    metadata: {
      deviceFingerprint?: string;
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<TokenPair> {
    const now = new Date();
    const accessTokenExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const refreshTokenExpiresAt = new Date(now.getTime() + this.REFRESH_TOKEN_EXPIRY_MS);

    // Generate new refresh token ID
    const refreshTokenId = crypto.randomBytes(32).toString('hex');
    
    // Update token family
    await this.updateTokenFamily(oldRefreshData.tokenFamilyId, oldTokenId, refreshTokenId);

    // Create new access token
    const accessPayload = {
      userId: oldRefreshData.userId,
      tenantId: oldRefreshData.tenantId,
      sessionId: oldRefreshData.sessionId,
      type: 'access',
      roles: [], // Would get from user data
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(accessTokenExpiresAt.getTime() / 1000)
    };

    // Create new refresh token
    const refreshPayload = {
      userId: oldRefreshData.userId,
      tenantId: oldRefreshData.tenantId,
      sessionId: oldRefreshData.sessionId,
      tokenId: refreshTokenId,
      type: 'refresh',
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(refreshTokenExpiresAt.getTime() / 1000)
    };

    const accessToken = jwt.sign(accessPayload, this.jwtSecret, { algorithm: 'HS256' });
    const refreshToken = jwt.sign(refreshPayload, this.refreshSecret, { algorithm: 'HS256' });

    // Store new refresh token data
    const newRefreshData: RefreshTokenData = {
      ...oldRefreshData,
      tokenFamilyId: oldRefreshData.tokenFamilyId,
      generation: oldRefreshData.generation + 1,
      parentTokenId: oldTokenId,
      deviceFingerprint: metadata.deviceFingerprint || oldRefreshData.deviceFingerprint,
      ipAddress: metadata.ipAddress || oldRefreshData.ipAddress,
      userAgent: metadata.userAgent || oldRefreshData.userAgent,
      issuedAt: now,
      lastUsedAt: now,
      rotationCount: oldRefreshData.rotationCount + 1
    };

    const refreshKey = `${this.REFRESH_TOKEN_PREFIX}:${refreshTokenId}`;
    await this.redis.setex(
      refreshKey,
      Math.floor(this.REFRESH_TOKEN_EXPIRY_MS / 1000),
      JSON.stringify(newRefreshData)
    );

    // Audit log with family tracking
    await this.storeTokenAuditRecord(oldRefreshData.userId, oldRefreshData.tenantId, refreshTokenId, 'rotated', {
      sessionId: oldRefreshData.sessionId,
      tokenFamilyId: oldRefreshData.tokenFamilyId,
      generation: newRefreshData.generation,
      parentTokenId: oldTokenId,
      rotationCount: newRefreshData.rotationCount
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt
    };
  }

  /**
   * Create a new token family
   */
  private async createTokenFamily(familyId: string, firstTokenId: string): Promise<void> {
    const tokenFamily: TokenFamily = {
      familyId,
      generation: 1,
      parentTokenId: undefined,
      childTokenIds: [firstTokenId],
      createdAt: new Date(),
      lastRotatedAt: new Date()
    };

    const familyKey = `${this.TOKEN_FAMILY_PREFIX}:${familyId}`;
    await this.redis.setex(familyKey, Math.floor(this.REFRESH_TOKEN_EXPIRY_MS / 1000), JSON.stringify(tokenFamily));
  }

  /**
   * Update token family with new token
   */
  private async updateTokenFamily(familyId: string, oldTokenId: string, newTokenId: string): Promise<void> {
    try {
      const familyKey = `${this.TOKEN_FAMILY_PREFIX}:${familyId}`;
      const familyDataStr = await this.redis.get(familyKey);
      
      if (familyDataStr) {
        const family: TokenFamily = JSON.parse(familyDataStr);
        
        family.generation += 1;
        family.parentTokenId = oldTokenId;
        family.childTokenIds.push(newTokenId);
        family.lastRotatedAt = new Date();

        // Keep only last 10 tokens in family for memory efficiency
        if (family.childTokenIds.length > 10) {
          family.childTokenIds = family.childTokenIds.slice(-10);
        }

        await this.redis.setex(familyKey, Math.floor(this.REFRESH_TOKEN_EXPIRY_MS / 1000), JSON.stringify(family));
      }
    } catch (error) {
      console.error('Failed to update token family:', error);
    }
  }

  /**
   * Revoke entire token family (security action)
   */
  async revokeTokenFamily(familyId: string, reason: string = 'security_breach'): Promise<number> {
    try {
      const familyKey = `${this.TOKEN_FAMILY_PREFIX}:${familyId}`;
      const familyDataStr = await this.redis.get(familyKey);
      
      if (!familyDataStr) {
        return 0;
      }

      const family: TokenFamily = JSON.parse(familyDataStr);
      let revokedCount = 0;

      // Revoke all tokens in the family
      for (const tokenId of family.childTokenIds) {
        const tokenKey = `${this.REFRESH_TOKEN_PREFIX}:${tokenId}`;
        const deleted = await this.redis.del(tokenKey);
        if (deleted) revokedCount++;
      }

      // Remove family
      await this.redis.del(familyKey);

      console.log('Token family revoked:', {
        familyId,
        reason,
        tokensRevoked: revokedCount
      });

      return revokedCount;
    } catch (error) {
      console.error('Failed to revoke token family:', error);
      return 0;
    }
  }

  /**
   * Get token family information
   */
  async getTokenFamily(familyId: string): Promise<TokenFamily | null> {
    try {
      const familyKey = `${this.TOKEN_FAMILY_PREFIX}:${familyId}`;
      const familyDataStr = await this.redis.get(familyKey);
      
      if (!familyDataStr) {
        return null;
      }

      return JSON.parse(familyDataStr);
    } catch (error) {
      console.error('Failed to get token family:', error);
      return null;
    }
  }

  /**
   * Validate device fingerprint consistency
   */
  private validateDeviceFingerprint(
    stored: string | undefined,
    provided: string | undefined
  ): { isValid: boolean; riskLevel: 'low' | 'medium' | 'high' } {
    if (!stored || !provided) {
      return { isValid: true, riskLevel: 'low' };
    }

    if (stored === provided) {
      return { isValid: true, riskLevel: 'low' };
    }

    // Could implement fuzzy matching for browser updates, etc.
    return { isValid: false, riskLevel: 'medium' };
  }
}

// Export singleton instance
export const jwtRefreshTokenManager = new JWTRefreshTokenManager();

// Export function to create instance with custom secrets
export function createJWTRefreshTokenManager(
  jwtSecret: string,
  refreshSecret: string
): JWTRefreshTokenManager {
  return new JWTRefreshTokenManager(jwtSecret, refreshSecret);
}