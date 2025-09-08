// LIQUID ABT - JWT Authentication Service Unit Tests

import { 
  AuthenticationService, 
  authService,
  signJWT,
  verifyJWT,
  hasPermission,
  canAccessFeature,
  JWTPayload,
  TokenValidationResult
} from '../../jwt';
import { UserRole } from '@/types/database';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Mock environment variables
const originalEnv = process.env;
beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    JWT_SECRET: 'test-secret-key-32-chars-long!!',
    JWT_EXPIRES_IN: '1h',
    MASTER_DOMAIN: 'liquidtreasury.business'
  };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('AuthenticationService', () => {
  let authService: AuthenticationService;
  
  beforeEach(() => {
    authService = new AuthenticationService();
  });

  describe('Constructor', () => {
    it('should initialize with environment variables', () => {
      expect(authService).toBeInstanceOf(AuthenticationService);
    });

    it('should throw error when JWT_SECRET is missing', () => {
      delete process.env.JWT_SECRET;
      expect(() => new AuthenticationService()).toThrow('JWT_SECRET environment variable is required');
    });

    it('should use default JWT_EXPIRES_IN when not provided', () => {
      delete process.env.JWT_EXPIRES_IN;
      const service = new AuthenticationService();
      expect(service).toBeInstanceOf(AuthenticationService);
    });
  });

  describe('Password Hashing', () => {
    it('should hash passwords securely', async () => {
      const password = 'testPassword123!';
      const hash = await authService.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50); // bcrypt hashes are typically 60 chars
    });

    it('should verify correct passwords', async () => {
      const password = 'testPassword123!';
      const hash = await authService.hashPassword(password);
      const isValid = await authService.verifyPassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    it('should reject incorrect passwords', async () => {
      const password = 'testPassword123!';
      const wrongPassword = 'wrongPassword123!';
      const hash = await authService.hashPassword(password);
      const isValid = await authService.verifyPassword(wrongPassword, hash);
      
      expect(isValid).toBe(false);
    });

    it('should handle empty passwords gracefully', async () => {
      const hash = await authService.hashPassword('');
      const isValid = await authService.verifyPassword('', hash);
      
      expect(isValid).toBe(true);
    });
  });

  describe('JWT Token Generation', () => {
    const mockPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: 'user-123',
      tenantId: 'tenant-456',
      email: 'test@example.com',
      role: UserRole.USER,
      subdomain: 'test-company'
    };

    it('should generate valid JWT tokens', () => {
      const token = authService.generateToken(mockPayload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    it('should include correct issuer and audience', () => {
      const token = authService.generateToken(mockPayload);
      const decoded = jwt.decode(token) as any;
      
      expect(decoded.iss).toBe('liquid-abt');
      expect(decoded.aud).toBe('liquid-abt-users');
    });

    it('should include all payload data', () => {
      const token = authService.generateToken(mockPayload);
      const decoded = jwt.decode(token) as any;
      
      expect(decoded.userId).toBe(mockPayload.userId);
      expect(decoded.tenantId).toBe(mockPayload.tenantId);
      expect(decoded.email).toBe(mockPayload.email);
      expect(decoded.role).toBe(mockPayload.role);
      expect(decoded.subdomain).toBe(mockPayload.subdomain);
    });

    it('should generate tokens with expiration', () => {
      const token = authService.generateToken(mockPayload);
      const decoded = jwt.decode(token) as any;
      
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
    });
  });

  describe('JWT Token Verification', () => {
    const mockPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: 'user-123',
      tenantId: 'tenant-456',
      email: 'test@example.com',
      role: UserRole.USER,
      subdomain: 'test-company'
    };

    it('should verify valid tokens', () => {
      const token = authService.generateToken(mockPayload);
      const result = authService.verifyToken(token);
      
      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.userId).toBe(mockPayload.userId);
      expect(result.payload!.tenantId).toBe(mockPayload.tenantId);
      expect(result.error).toBeUndefined();
    });

    it('should reject tokens with wrong signature', () => {
      const token = authService.generateToken(mockPayload);
      const tamperedToken = token.slice(0, -5) + 'XXXXX';
      const result = authService.verifyToken(tamperedToken);
      
      expect(result.valid).toBe(false);
      expect(result.payload).toBeUndefined();
      expect(result.error).toBe('Invalid token format');
    });

    it('should reject malformed tokens', () => {
      const malformedToken = 'not.a.valid.jwt.token';
      const result = authService.verifyToken(malformedToken);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should reject expired tokens', () => {
      // Create a token that expires immediately
      const expiredToken = jwt.sign(
        mockPayload,
        process.env.JWT_SECRET!,
        { expiresIn: '0s', issuer: 'liquid-abt', audience: 'liquid-abt-users' }
      );
      
      // Wait a moment to ensure expiration
      setTimeout(() => {
        const result = authService.verifyToken(expiredToken);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Token expired');
      }, 10);
    });

    it('should reject tokens with wrong issuer', () => {
      const wrongIssuerToken = jwt.sign(
        mockPayload,
        process.env.JWT_SECRET!,
        { issuer: 'wrong-issuer', audience: 'liquid-abt-users' }
      );
      
      const result = authService.verifyToken(wrongIssuerToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should reject tokens with wrong audience', () => {
      const wrongAudienceToken = jwt.sign(
        mockPayload,
        process.env.JWT_SECRET!,
        { issuer: 'liquid-abt', audience: 'wrong-audience' }
      );
      
      const result = authService.verifyToken(wrongAudienceToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should handle empty token gracefully', () => {
      const result = authService.verifyToken('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });
  });

  describe('Subdomain Extraction', () => {
    it('should extract subdomain from valid tenant domain', () => {
      const subdomain = authService.extractTenantFromSubdomain('acme.liquidtreasury.business');
      expect(subdomain).toBe('acme');
    });

    it('should return null for master domain', () => {
      const subdomain = authService.extractTenantFromSubdomain('liquidtreasury.business');
      expect(subdomain).toBeNull();
    });

    it('should return null for www master domain', () => {
      const subdomain = authService.extractTenantFromSubdomain('www.liquidtreasury.business');
      expect(subdomain).toBeNull();
    });

    it('should extract subdomain from localhost development', () => {
      const subdomain = authService.extractTenantFromSubdomain('test-company.localhost:3000');
      expect(subdomain).toBe('test-company');
    });

    it('should return null for www localhost', () => {
      const subdomain = authService.extractTenantFromSubdomain('www.localhost:3000');
      expect(subdomain).toBeNull();
    });

    it('should return null for plain localhost', () => {
      const subdomain = authService.extractTenantFromSubdomain('localhost:3000');
      expect(subdomain).toBeNull();
    });

    it('should return null for unrelated domains', () => {
      const subdomain = authService.extractTenantFromSubdomain('example.com');
      expect(subdomain).toBeNull();
    });

    it('should handle custom master domain', () => {
      process.env.MASTER_DOMAIN = 'custom-domain.com';
      const service = new AuthenticationService();
      
      const subdomain = service.extractTenantFromSubdomain('tenant.custom-domain.com');
      expect(subdomain).toBe('tenant');
    });
  });

  describe('Secure Token Generation', () => {
    it('should generate secure tokens', () => {
      const token = authService.generateSecureToken();
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should verify valid secure tokens', () => {
      const token = authService.generateSecureToken();
      const isValid = authService.verifySecureToken(token);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid secure tokens', () => {
      const isValid = authService.verifySecureToken('invalid-token');
      expect(isValid).toBe(false);
    });

    it('should reject tokens with wrong type', () => {
      const wrongTypeToken = jwt.sign(
        { type: 'wrong_type', timestamp: Date.now() },
        process.env.JWT_SECRET!
      );
      
      const isValid = authService.verifySecureToken(wrongTypeToken);
      expect(isValid).toBe(false);
    });

    it('should generate unique secure tokens', async () => {
      const token1 = authService.generateSecureToken();
      // Add small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1));
      const token2 = authService.generateSecureToken();
      
      expect(token1).not.toBe(token2);
    });
  });
});

describe('Helper Functions', () => {
  describe('hasPermission', () => {
    it('should allow equal roles', () => {
      expect(hasPermission(UserRole.USER, UserRole.USER)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, UserRole.ADMIN)).toBe(true);
    });

    it('should allow higher roles', () => {
      expect(hasPermission(UserRole.ADMIN, UserRole.USER)).toBe(true);
      expect(hasPermission(UserRole.OWNER, UserRole.ADMIN)).toBe(true);
      expect(hasPermission(UserRole.OWNER, UserRole.VIEWER)).toBe(true);
    });

    it('should deny lower roles', () => {
      expect(hasPermission(UserRole.USER, UserRole.ADMIN)).toBe(false);
      expect(hasPermission(UserRole.VIEWER, UserRole.USER)).toBe(false);
    });

    it('should handle role hierarchy correctly', () => {
      expect(hasPermission(UserRole.OWNER, UserRole.VIEWER)).toBe(true);
      expect(hasPermission(UserRole.OWNER, UserRole.USER)).toBe(true);
      expect(hasPermission(UserRole.OWNER, UserRole.ADMIN)).toBe(true);
      expect(hasPermission(UserRole.VIEWER, UserRole.OWNER)).toBe(false);
    });
  });

  describe('canAccessFeature', () => {
    it('should allow viewers to view dashboard', () => {
      expect(canAccessFeature(UserRole.VIEWER, 'view_dashboard')).toBe(true);
      expect(canAccessFeature(UserRole.USER, 'view_dashboard')).toBe(true);
      expect(canAccessFeature(UserRole.ADMIN, 'view_dashboard')).toBe(true);
      expect(canAccessFeature(UserRole.OWNER, 'view_dashboard')).toBe(true);
    });

    it('should restrict treasury rule creation to admin+', () => {
      expect(canAccessFeature(UserRole.VIEWER, 'create_treasury_rules')).toBe(false);
      expect(canAccessFeature(UserRole.USER, 'create_treasury_rules')).toBe(false);
      expect(canAccessFeature(UserRole.ADMIN, 'create_treasury_rules')).toBe(true);
      expect(canAccessFeature(UserRole.OWNER, 'create_treasury_rules')).toBe(true);
    });

    it('should restrict billing to owners only', () => {
      expect(canAccessFeature(UserRole.VIEWER, 'view_billing')).toBe(false);
      expect(canAccessFeature(UserRole.USER, 'view_billing')).toBe(false);
      expect(canAccessFeature(UserRole.ADMIN, 'view_billing')).toBe(false);
      expect(canAccessFeature(UserRole.OWNER, 'view_billing')).toBe(true);
    });

    it('should restrict user management to owners only', () => {
      expect(canAccessFeature(UserRole.ADMIN, 'manage_users')).toBe(false);
      expect(canAccessFeature(UserRole.OWNER, 'manage_users')).toBe(true);
    });

    it('should return false for unknown features', () => {
      expect(canAccessFeature(UserRole.OWNER, 'unknown_feature')).toBe(false);
    });

    it('should handle integration management permissions', () => {
      expect(canAccessFeature(UserRole.USER, 'manage_integrations')).toBe(false);
      expect(canAccessFeature(UserRole.ADMIN, 'manage_integrations')).toBe(true);
      expect(canAccessFeature(UserRole.OWNER, 'manage_integrations')).toBe(true);
    });
  });

  describe('signJWT helper', () => {
    const mockPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: 'user-123',
      tenantId: 'tenant-456',
      email: 'test@example.com',
      role: UserRole.USER,
      subdomain: 'test-company'
    };

    it('should generate JWT tokens', async () => {
      const token = await signJWT(mockPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should generate valid tokens that can be verified', async () => {
      const token = await signJWT(mockPayload);
      const payload = await verifyJWT(token);
      
      expect(payload.userId).toBe(mockPayload.userId);
      expect(payload.tenantId).toBe(mockPayload.tenantId);
    });
  });

  describe('verifyJWT helper', () => {
    const mockPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: 'user-123',
      tenantId: 'tenant-456',
      email: 'test@example.com',
      role: UserRole.USER,
      subdomain: 'test-company'
    };

    it('should verify valid tokens', async () => {
      const token = await signJWT(mockPayload);
      const payload = await verifyJWT(token);
      
      expect(payload).toBeDefined();
      expect(payload.userId).toBe(mockPayload.userId);
    });

    it('should throw error for invalid tokens', async () => {
      await expect(verifyJWT('invalid-token')).rejects.toThrow();
    });

    it('should throw error with custom message', async () => {
      await expect(verifyJWT('')).rejects.toThrow('Invalid token');
    });
  });
});