// LIQUID ABT - Integrated Authentication Security Middleware
// Combines all security components into unified auth system

import { Request, Response, NextFunction } from 'express';
import { jwtRefreshTokenManager } from '../auth/jwtRefreshToken';
import { accountLockoutManager } from '../auth/accountLockout';
import { sessionTimeoutManager } from '../auth/sessionTimeout';
import { twoFactorAuthManager } from '../auth/twoFactorAuth';
import { passwordManager } from '../auth/argon2Password';
import { createRateLimit } from './rateLimiter';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    sessionId: string;
    roles: string[];
    requiresMFA?: boolean;
    sessionStatus?: any;
  };
  deviceFingerprint?: string;
  realIP?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  totpToken?: string;
  deviceFingerprint?: string;
}

export interface LoginResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  requiresMFA?: boolean;
  error?: string;
  lockoutStatus?: any;
}

export class IntegratedAuthSecurity {
  /**
   * Complete login flow with all security checks
   */
  async authenticateUser(
    credentials: LoginCredentials,
    ipAddress: string,
    userAgent: string
  ): Promise<LoginResult> {
    const { email, password, totpToken, deviceFingerprint } = credentials;

    try {
      // 1. Check account lockout status
      const lockoutStatus = await accountLockoutManager.getLockoutStatus(email);
      if (lockoutStatus.isLocked) {
        return {
          success: false,
          error: `Account locked. Try again in ${Math.ceil(lockoutStatus.remainingTime! / 60000)} minutes.`,
          lockoutStatus
        };
      }

      // 2. Check IP-based lockout
      const ipLockoutStatus = await accountLockoutManager.getLockoutStatus(`ip:${ipAddress}`);
      if (ipLockoutStatus.isLocked) {
        return {
          success: false,
          error: 'Too many failed attempts from this IP address',
          lockoutStatus: ipLockoutStatus
        };
      }

      // 3. Get user from database (implement based on your user model)
      const user = await this.getUserByEmail(email);
      if (!user) {
        // Record failed attempt even for non-existent users
        await accountLockoutManager.recordFailedAttempt({
          identifier: email,
          timestamp: new Date(),
          ipAddress,
          userAgent
        });
        return {
          success: false,
          error: 'Invalid credentials'
        };
      }

      // 4. Verify password with Argon2
      const passwordResult = await passwordManager.verifyPassword(password, user.passwordHash);
      if (!passwordResult.isValid) {
        // Record failed attempt
        await Promise.all([
          accountLockoutManager.recordFailedAttempt({
            identifier: email,
            timestamp: new Date(),
            ipAddress,
            userAgent
          }),
          accountLockoutManager.recordIPAttempt(ipAddress, email)
        ]);

        return {
          success: false,
          error: 'Invalid credentials'
        };
      }

      // 5. Check if 2FA is enabled
      const requires2FA = await twoFactorAuthManager.isTwoFactorEnabled(user.id, user.tenantId);
      
      if (requires2FA) {
        if (!totpToken) {
          return {
            success: false,
            requiresMFA: true,
            error: 'Two-factor authentication required'
          };
        }

        // Verify TOTP token
        const totpResult = await twoFactorAuthManager.verifyTOTPToken(user.id, user.tenantId, totpToken);
        if (!totpResult.isValid) {
          // Record failed attempt for 2FA failure
          await accountLockoutManager.recordFailedAttempt({
            identifier: email,
            timestamp: new Date(),
            ipAddress,
            userAgent
          });

          return {
            success: false,
            requiresMFA: true,
            error: 'Invalid two-factor authentication code'
          };
        }
      }

      // 6. Create session and generate tokens
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Initialize session timeout management
      await sessionTimeoutManager.initializeSession(
        sessionId,
        user.id,
        user.tenantId,
        {
          maxIdleTimeMs: 30 * 60 * 1000, // 30 minutes
          absoluteTimeoutMs: 8 * 60 * 60 * 1000, // 8 hours
          warningTimeMs: 5 * 60 * 1000, // 5 minutes
          extendOnActivity: true
        }
      );

      // Generate JWT token pair
      const tokenPair = await jwtRefreshTokenManager.generateTokenPair(
        user.id,
        user.tenantId,
        sessionId,
        {
          deviceFingerprint,
          ipAddress,
          userAgent,
          roles: user.roles || []
        }
      );

      // 7. Clear failed attempts on successful login
      await accountLockoutManager.recordSuccessfulLogin(email);

      // 8. Check if password needs rehashing (Argon2 upgrade)
      if (passwordResult.needsRehash) {
        // Queue background job to rehash password
        console.log('Password needs rehashing for user:', user.id);
        // Implement background job queuing here
      }

      console.log('User authenticated successfully:', {
        userId: user.id,
        tenantId: user.tenantId,
        sessionId,
        requires2FA,
        ipAddress
      });

      return {
        success: true,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken
      };

    } catch (error) {
      console.error('Authentication error:', error);
      return {
        success: false,
        error: 'Authentication failed'
      };
    }
  }

  /**
   * Middleware for protected routes
   */
  authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access token required' });
      }

      const token = authHeader.substring(7);
      
      // Validate access token
      const tokenResult = await jwtRefreshTokenManager.validateAccessToken(token);
      if (!tokenResult.isValid) {
        if (tokenResult.needsRotation) {
          return res.status(401).json({ 
            error: 'Token expired',
            requiresRefresh: true 
          });
        }
        return res.status(401).json({ error: tokenResult.error });
      }

      const { payload } = tokenResult;
      
      // Check session timeout
      const sessionStatus = await sessionTimeoutManager.getSessionStatus(payload.sessionId);
      if (!sessionStatus.isActive) {
        return res.status(401).json({ 
          error: 'Session expired',
          requiresLogin: true 
        });
      }

      // Update session activity
      await sessionTimeoutManager.updateActivity(payload.sessionId, 'api_call');

      // Attach user info to request
      req.user = {
        userId: payload.userId,
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        roles: payload.roles || [],
        sessionStatus
      };

      // Extract device fingerprint and real IP
      req.deviceFingerprint = req.headers['x-device-fingerprint'] as string;
      req.realIP = this.extractRealIP(req);

      next();

    } catch (error) {
      console.error('Token authentication error:', error);
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  /**
   * Refresh token endpoint
   */
  async refreshToken(
    refreshToken: string,
    ipAddress: string,
    userAgent: string,
    deviceFingerprint?: string
  ): Promise<LoginResult> {
    try {
      const result = await jwtRefreshTokenManager.refreshAccessToken(refreshToken, {
        ipAddress,
        userAgent,
        deviceFingerprint
      });

      if ('error' in result) {
        return {
          success: false,
          error: result.error
        };
      }

      return {
        success: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
      };

    } catch (error) {
      console.error('Token refresh error:', error);
      return {
        success: false,
        error: 'Token refresh failed'
      };
    }
  }

  /**
   * Logout with token cleanup
   */
  async logout(
    accessToken: string,
    refreshToken: string,
    sessionId: string,
    reason: string = 'user_logout'
  ): Promise<void> {
    try {
      await Promise.all([
        // Blacklist access token
        jwtRefreshTokenManager.blacklistAccessToken(accessToken, reason),
        // Revoke refresh token
        jwtRefreshTokenManager.revokeRefreshToken(refreshToken, reason),
        // Expire session
        sessionTimeoutManager.expireSession(sessionId, reason)
      ]);

      console.log('User logged out:', { sessionId, reason });
    } catch (error) {
      console.error('Logout error:', error);
    }
  }

  /**
   * Security action: revoke all user sessions
   */
  async revokeAllUserSessions(
    userId: string,
    tenantId: string,
    reason: string = 'security_action'
  ): Promise<void> {
    try {
      await Promise.all([
        jwtRefreshTokenManager.revokeAllUserTokens(userId, tenantId, reason),
        sessionTimeoutManager.terminateAllUserSessions(userId, reason)
      ]);

      console.log('All user sessions revoked:', { userId, tenantId, reason });
    } catch (error) {
      console.error('Session revocation error:', error);
    }
  }

  /**
   * Rate limiting middleware for auth endpoints
   */
  authRateLimit = createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    keyGenerator: (req: Request) => {
      const email = req.body?.email;
      const ip = this.extractRealIP(req);
      return `auth:${email || ip}`;
    },
    onLimitReached: async (req: Request) => {
      const email = req.body?.email;
      const ip = this.extractRealIP(req);
      
      if (email) {
        await accountLockoutManager.recordFailedAttempt({
          identifier: email,
          timestamp: new Date(),
          ipAddress: ip,
          userAgent: req.headers['user-agent']
        });
      }
    }
  });

  /**
   * Extract real IP address from request
   */
  private extractRealIP(req: Request): string {
    return (
      req.headers['x-forwarded-for'] as string ||
      req.headers['x-real-ip'] as string ||
      req.connection.remoteAddress ||
      req.ip ||
      'unknown'
    ).split(',')[0].trim();
  }

  /**
   * Get user by email (implement based on your user model)
   */
  private async getUserByEmail(email: string): Promise<{
    id: string;
    tenantId: string;
    email: string;
    passwordHash: string;
    roles: string[];
  } | null> {
    try {
      const { getMasterPrisma } = await import('@/lib/database/connection');
      const prisma = getMasterPrisma();
      
      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          tenant: {
            select: {
              isActive: true
            }
          }
        }
      });

      if (!user || !user.isActive || !user.tenant.isActive) {
        return null;
      }

      return {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        passwordHash: user.passwordHash,
        roles: [user.role] // Convert single role to array
      };
    } catch (error) {
      console.error('getUserByEmail error:', error);
      return null;
    }
  }
}

// Export singleton instance
export const integratedAuthSecurity = new IntegratedAuthSecurity();

// Export middleware functions
export const authenticateToken = integratedAuthSecurity.authenticateToken;
export const authRateLimit = integratedAuthSecurity.authRateLimit;