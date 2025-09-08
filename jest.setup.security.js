// LIQUID ABT - Security Testing Setup
// Additional mocks and configurations specifically for security testing

import { jest } from '@jest/globals';

// Security testing environment variables
process.env.SECURITY_TESTING_MODE = 'true';
process.env.DISABLE_RATE_LIMITING = 'false'; // Keep rate limiting active for security tests
process.env.ENABLE_SECURITY_HEADERS = 'true';
process.env.CSRF_PROTECTION_ENABLED = 'true';

// Mock security services for controlled testing
jest.mock('@/lib/security/rateLimiter', () => ({
  rateLimiter: {
    checkLimit: jest.fn().mockImplementation((key, limit = 10) => {
      // Simulate rate limiting behavior
      const mockCount = Math.floor(Math.random() * (limit + 5));
      return Promise.resolve({
        totalHits: mockCount,
        totalTime: 60000, // 1 minute window
        isLimited: mockCount > limit,
        remainingPoints: Math.max(0, limit - mockCount),
        msBeforeNext: mockCount > limit ? 30000 : 0
      });
    }),
    
    reset: jest.fn().mockResolvedValue(true),
    
    // Simulate different rate limit scenarios for security testing
    simulateExceededLimit: jest.fn().mockResolvedValue({
      totalHits: 15,
      totalTime: 60000,
      isLimited: true,
      remainingPoints: 0,
      msBeforeNext: 45000
    })
  }
}));

jest.mock('@/lib/security/csrfProtection', () => ({
  csrfProtection: {
    generateToken: jest.fn().mockImplementation(() => {
      return `csrf_token_${Date.now()}_${Math.random().toString(36)}`;
    }),
    
    validateToken: jest.fn().mockImplementation((token, sessionToken) => {
      // Simulate CSRF validation
      const isValid = token && sessionToken && token.includes('csrf_token_');
      return Promise.resolve({
        isValid,
        error: isValid ? null : 'Invalid CSRF token'
      });
    }),
    
    // For testing CSRF bypass attempts
    simulateInvalidToken: jest.fn().mockResolvedValue({
      isValid: false,
      error: 'CSRF token mismatch or expired'
    })
  }
}));

jest.mock('@/lib/security/encryptionService', () => ({
  encryptionService: {
    encrypt: jest.fn().mockImplementation((data) => {
      // Mock encryption - DO NOT use in production
      const mockEncrypted = Buffer.from(JSON.stringify(data)).toString('base64');
      return Promise.resolve({
        encrypted: `enc_${mockEncrypted}`,
        iv: 'mock_iv_12345678',
        tag: 'mock_tag_87654321'
      });
    }),
    
    decrypt: jest.fn().mockImplementation((encryptedData, iv, tag) => {
      // Mock decryption - DO NOT use in production
      if (!encryptedData.startsWith('enc_')) {
        throw new Error('Invalid encrypted data format');
      }
      const data = encryptedData.replace('enc_', '');
      const decrypted = JSON.parse(Buffer.from(data, 'base64').toString());
      return Promise.resolve(decrypted);
    }),
    
    hash: jest.fn().mockImplementation((data) => {
      // Mock hashing using Node.js crypto for consistency in tests
      return Promise.resolve(`hash_${Buffer.from(data).toString('base64')}`);
    }),
    
    compareHash: jest.fn().mockImplementation((data, hash) => {
      const expectedHash = `hash_${Buffer.from(data).toString('base64')}`;
      return Promise.resolve(hash === expectedHash);
    })
  }
}));

// Mock JWT service with security testing capabilities
jest.mock('@/lib/auth/jwt', () => ({
  validateJWT: jest.fn().mockImplementation((token) => {
    if (!token) {
      return Promise.resolve(null);
    }
    
    // Simulate different JWT scenarios for security testing
    if (token === 'invalid_token') {
      return Promise.resolve(null);
    }
    
    if (token === 'expired_token') {
      return Promise.resolve(null);
    }
    
    if (token === 'malformed_token') {
      return Promise.resolve(null);
    }
    
    // Valid token simulation
    return Promise.resolve({
      userId: 'test_user_123',
      email: 'security.test@example.com.au',
      role: 'USER',
      tenantId: 'test_tenant_456',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    });
  }),
  
  verifyJWT: jest.fn().mockImplementation((token) => {
    // Alias for consistency
    return jest.requireMock('@/lib/auth/jwt').validateJWT(token);
  }),
  
  generateTestToken: jest.fn().mockImplementation((payload) => {
    return Promise.resolve(`test_jwt_${Buffer.from(JSON.stringify(payload)).toString('base64')}`);
  })
}));

// Mock audit logging for security events
jest.mock('@/lib/audit/auditLogger', () => ({
  auditLogger: {
    logSecurityEvent: jest.fn().mockImplementation((eventType, severity, details) => {
      return Promise.resolve({
        eventId: `sec_event_${Date.now()}`,
        eventType,
        severity,
        details,
        timestamp: new Date(),
        logged: true
      });
    }),
    
    logFailedLogin: jest.fn().mockResolvedValue({
      eventId: `failed_login_${Date.now()}`,
      eventType: 'failed_login',
      severity: 'medium',
      logged: true
    }),
    
    logSuspiciousActivity: jest.fn().mockResolvedValue({
      eventId: `suspicious_${Date.now()}`,
      eventType: 'suspicious_activity',
      severity: 'high',
      logged: true
    }),
    
    logSecurityViolation: jest.fn().mockResolvedValue({
      eventId: `violation_${Date.now()}`,
      eventType: 'security_violation',
      severity: 'critical',
      logged: true
    })
  }
}));

// Mock database with security-focused queries
jest.mock('@/lib/database/securityQueries', () => ({
  securityQueries: {
    checkUserBruteForce: jest.fn().mockImplementation((email) => {
      return Promise.resolve({
        attemptCount: Math.floor(Math.random() * 5),
        lastAttempt: new Date(),
        isBlocked: false,
        blockExpiresAt: null
      });
    }),
    
    logFailedLogin: jest.fn().mockResolvedValue({
      id: `log_${Date.now()}`,
      logged: true
    }),
    
    checkSuspiciousIP: jest.fn().mockImplementation((ipAddress) => {
      return Promise.resolve({
        isSuspicious: ipAddress === '192.168.1.999', // Mock suspicious IP
        riskScore: Math.random() * 100,
        lastSeen: new Date()
      });
    }),
    
    getTenantSecurityMetrics: jest.fn().mockImplementation((tenantId) => {
      return Promise.resolve({
        tenantId,
        failedLogins24h: Math.floor(Math.random() * 10),
        suspiciousTransactions24h: 0,
        rateLimitViolations24h: Math.floor(Math.random() * 5),
        lastSecurityEvent: new Date()
      });
    })
  }
}));

// Security testing utilities
global.securityTestUtils = {
  // SQL Injection test payloads
  sqlInjectionPayloads: [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "'; SELECT * FROM users WHERE '1'='1",
    "' UNION SELECT * FROM admin_users --",
    "'; INSERT INTO users (email) VALUES ('hacker@evil.com'); --"
  ],
  
  // XSS test payloads
  xssPayloads: [
    "<script>alert('XSS')</script>",
    "<img src=x onerror=alert('XSS')>",
    "javascript:alert('XSS')",
    "<svg onload=alert('XSS')>",
    "';alert('XSS');//"
  ],
  
  // CSRF test scenarios
  csrfScenarios: [
    { name: 'missing_token', token: null },
    { name: 'invalid_token', token: 'invalid_csrf_token' },
    { name: 'expired_token', token: 'expired_csrf_token_123' },
    { name: 'malformed_token', token: 'malformed<>token' }
  ],
  
  // JWT test scenarios
  jwtScenarios: [
    { name: 'valid_token', token: 'valid_jwt_token', shouldPass: true },
    { name: 'invalid_token', token: 'invalid_token', shouldPass: false },
    { name: 'expired_token', token: 'expired_token', shouldPass: false },
    { name: 'malformed_token', token: 'malformed_token', shouldPass: false },
    { name: 'no_token', token: null, shouldPass: false }
  ],
  
  // Generate test IP addresses for security testing
  generateTestIP: (type = 'safe') => {
    const safeIPs = ['127.0.0.1', '192.168.1.100', '10.0.0.50'];
    const suspiciousIPs = ['192.168.1.999', '999.999.999.999', '0.0.0.0'];
    
    return type === 'suspicious' 
      ? suspiciousIPs[Math.floor(Math.random() * suspiciousIPs.length)]
      : safeIPs[Math.floor(Math.random() * safeIPs.length)];
  },
  
  // Generate test headers for security testing
  generateTestHeaders: (type = 'safe') => {
    const baseHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'Jest Security Test Suite',
      'X-Forwarded-For': global.securityTestUtils.generateTestIP(type)
    };
    
    if (type === 'malicious') {
      return {
        ...baseHeaders,
        'X-Forwarded-For': '192.168.1.999',
        'User-Agent': '<script>alert("XSS")</script>',
        'X-Custom-Header': "'; DROP TABLE users; --"
      };
    }
    
    return baseHeaders;
  },
  
  // Simulate rate limit violations
  simulateRateLimitViolation: async (endpoint, count = 15) => {
    const violations = [];
    for (let i = 0; i < count; i++) {
      violations.push({
        timestamp: new Date(),
        endpoint,
        ipAddress: global.securityTestUtils.generateTestIP('suspicious'),
        userAgent: 'Automated Attack Tool'
      });
    }
    return violations;
  }
};

// Increase timeout for security tests (they may involve multiple attack attempts)
jest.setTimeout(60000);

// Security test lifecycle hooks
beforeEach(() => {
  // Reset all mocks before each security test
  jest.clearAllMocks();
  
  // Ensure security testing mode is enabled
  process.env.SECURITY_TESTING_MODE = 'true';
});

afterEach(() => {
  // Clean up any security test artifacts
  jest.clearAllMocks();
});

// Global error handling for security tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in Security Test:', reason);
  // Don't exit process in tests, but log for debugging
});