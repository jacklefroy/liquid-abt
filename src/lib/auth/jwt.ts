// LIQUID ABT - JWT Authentication with Tenant Context

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { UserRole } from '@/types/database';

export interface JWTPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: UserRole;
  subdomain: string;
  iat?: number;
  exp?: number;
}

export interface TokenValidationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
}

export class AuthenticationService {
  private jwtSecret: string;
  private jwtExpiresIn: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET!;
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';

    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  /**
   * Hash a password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify a password against its hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a JWT token with tenant context
   */
  generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
      issuer: 'liquid-abt',
      audience: 'liquid-abt-users'
    });
  }

  /**
   * Verify and decode a JWT token
   */
  verifyToken(token: string): TokenValidationResult {
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        issuer: 'liquid-abt',
        audience: 'liquid-abt-users'
      }) as JWTPayload;

      return {
        valid: true,
        payload
      };
    } catch (error) {
      let errorMessage = 'Invalid token';
      
      if (error instanceof jwt.TokenExpiredError) {
        errorMessage = 'Token expired';
      } else if (error instanceof jwt.JsonWebTokenError) {
        errorMessage = 'Invalid token format';
      } else if (error instanceof jwt.NotBeforeError) {
        errorMessage = 'Token not active yet';
      }

      return {
        valid: false,
        error: errorMessage
      };
    }
  }

  /**
   * Extract tenant information from subdomain
   */
  extractTenantFromSubdomain(hostname: string): string | null {
    const masterDomain = process.env.MASTER_DOMAIN || 'liquidtreasury.business';
    
    if (hostname === masterDomain || hostname === `www.${masterDomain}`) {
      return null; // Main domain, not a tenant
    }

    if (hostname.endsWith(`.${masterDomain}`)) {
      const subdomain = hostname.replace(`.${masterDomain}`, '');
      return subdomain;
    }

    // Handle localhost development
    if (hostname.includes('localhost') && hostname.includes('.')) {
      const parts = hostname.split('.');
      if (parts.length > 1 && parts[0] !== 'www') {
        return parts[0];
      }
    }

    return null;
  }

  /**
   * Generate a secure random token (for password resets, etc.)
   */
  generateSecureToken(): string {
    return jwt.sign(
      { type: 'secure_token', timestamp: Date.now() },
      this.jwtSecret,
      { expiresIn: '1h' }
    );
  }

  /**
   * Verify a secure random token
   */
  verifySecureToken(token: string): boolean {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as any;
      return payload.type === 'secure_token';
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const authService = new AuthenticationService();

// Helper functions for role-based access control
export function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
  const roleHierarchy = {
    [UserRole.VIEWER]: 1,
    [UserRole.USER]: 2,
    [UserRole.ADMIN]: 3,
    [UserRole.OWNER]: 4
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

export function canAccessFeature(userRole: UserRole, feature: string): boolean {
  const featurePermissions = {
    'view_dashboard': [UserRole.VIEWER, UserRole.USER, UserRole.ADMIN, UserRole.OWNER],
    'view_transactions': [UserRole.VIEWER, UserRole.USER, UserRole.ADMIN, UserRole.OWNER],
    'create_treasury_rules': [UserRole.ADMIN, UserRole.OWNER],
    'modify_treasury_rules': [UserRole.ADMIN, UserRole.OWNER],
    'manage_integrations': [UserRole.ADMIN, UserRole.OWNER],
    'view_billing': [UserRole.OWNER],
    'manage_users': [UserRole.OWNER],
    'manage_subscription': [UserRole.OWNER]
  };

  const allowedRoles = featurePermissions[feature];
  return allowedRoles ? allowedRoles.includes(userRole) : false;
}

// Helper functions for testing and API usage
export async function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
  return authService.generateToken(payload);
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  const result = authService.verifyToken(token);
  if (!result.valid || !result.payload) {
    throw new Error(result.error || 'Invalid token');
  }
  return result.payload;
}

// Alias for API route consistency
export const validateJWT = verifyJWT;