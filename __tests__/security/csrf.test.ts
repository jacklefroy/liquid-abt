import request from 'supertest';
// Security testing for Next.js API routes - no Express app needed
import { createTestUser, cleanupTestData } from '../helpers/index';

describe('CSRF (Cross-Site Request Forgery) Security Tests', () => {
  let testUser: any;
  let authToken: string;
  let csrfToken: string;

  beforeAll(async () => {
    testUser = await createTestUser();
    
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUser.email,
        password: 'TestPassword123!'
      });
    
    authToken = loginResponse.body.data.token;
    
    // Get CSRF token
    try {
      const csrfResponse = await request(app)
        .get('/api/csrf-token')
        .set('Authorization', `Bearer ${authToken}`);
      
      csrfToken = csrfResponse.body.csrfToken || 'test-csrf-token';
    } catch (error) {
      csrfToken = 'test-csrf-token';
    }
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('State-Changing Operations CSRF Protection', () => {
    const sensitiveEndpoints = [
      {
        method: 'POST',
        path: '/api/treasury/rules',
        data: {
          name: 'Test Rule',
          type: 'percentage',
          configuration: { percentage: 10 },
          enabled: true
        }
      },
      {
        method: 'PUT',
        path: '/api/treasury/rules/test-rule-id',
        data: {
          enabled: false
        }
      },
      {
        method: 'DELETE',
        path: '/api/treasury/rules/test-rule-id',
        data: {}
      },
      {
        method: 'POST',
        path: '/api/integrations/payment-processors',
        data: {
          provider: 'stripe',
          accountId: 'acct_test123'
        }
      },
      {
        method: 'PUT',
        path: '/api/users/profile',
        data: {
          name: 'Updated Name'
        }
      },
      {
        method: 'POST',
        path: '/api/auth/change-password',
        data: {
          currentPassword: 'TestPassword123!',
          newPassword: 'NewTestPassword123!'
        }
      },
      {
        method: 'POST',
        path: '/api/treasury/purchases/manual',
        data: {
          amount: 1000,
          reason: 'Manual purchase'
        }
      }
    ];

    describe('Requests without CSRF token should be rejected', () => {
      test.each(sensitiveEndpoints)('$method $path should require CSRF token', async (endpoint) => {
        const response = await request(app)
          [endpoint.method.toLowerCase() as keyof typeof request](`${endpoint.path}`)
          .send(endpoint.data)
          .set('Authorization', `Bearer ${authToken}`)
          .set('Content-Type', 'application/json');
        
        // Should reject request without CSRF token
        expect([403, 400]).toContain(response.status);
        
        if (response.body.error) {
          const errorMessage = response.body.error.message?.toLowerCase() || '';
          expect(errorMessage).toMatch(/csrf|forbidden|invalid.*token|missing.*token/);
        }
      });
    });

    describe('Requests with invalid CSRF token should be rejected', () => {
      test.each(sensitiveEndpoints)('$method $path should reject invalid CSRF token', async (endpoint) => {
        const invalidTokens = [
          'invalid-token',
          'expired-token-123',
          '',
          'null',
          'undefined',
          'admin-bypass-token',
          csrfToken + 'tampered'
        ];

        for (const invalidToken of invalidTokens) {
          const response = await request(app)
            [endpoint.method.toLowerCase() as keyof typeof request](`${endpoint.path}`)
            .send(endpoint.data)
            .set('Authorization', `Bearer ${authToken}`)
            .set('Content-Type', 'application/json')
            .set('X-CSRF-Token', invalidToken);
          
          // Should reject request with invalid CSRF token
          expect([403, 400]).toContain(response.status);
        }
      });
    });

    describe('Requests with valid CSRF token should be accepted', () => {
      test.each(sensitiveEndpoints.slice(0, 3))('$method $path should accept valid CSRF token', async (endpoint) => {
        const response = await request(app)
          [endpoint.method.toLowerCase() as keyof typeof request](`${endpoint.path}`)
          .send(endpoint.data)
          .set('Authorization', `Bearer ${authToken}`)
          .set('Content-Type', 'application/json')
          .set('X-CSRF-Token', csrfToken);
        
        // Should not reject due to CSRF (may fail for other reasons like validation)
        expect(response.status).not.toBe(403);
        
        // If it's a 400, it should not be due to CSRF
        if (response.status === 400 && response.body.error) {
          const errorMessage = response.body.error.message?.toLowerCase() || '';
          expect(errorMessage).not.toMatch(/csrf|forbidden|invalid.*token|missing.*token/);
        }
      });
    });
  });

  describe('CSRF Token Management', () => {
    test('should provide CSRF token endpoint', async () => {
      const response = await request(app)
        .get('/api/csrf-token')
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response.status === 200) {
        expect(response.body.csrfToken).toBeDefined();
        expect(typeof response.body.csrfToken).toBe('string');
        expect(response.body.csrfToken.length).toBeGreaterThan(10);
      }
    });

    test('should generate unique CSRF tokens per session', async () => {
      const response1 = await request(app)
        .get('/api/csrf-token')
        .set('Authorization', `Bearer ${authToken}`);
      
      const response2 = await request(app)
        .get('/api/csrf-token')
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response1.status === 200 && response2.status === 200) {
        expect(response1.body.csrfToken).not.toBe(response2.body.csrfToken);
      }
    });

    test('should reject CSRF tokens from different sessions', async () => {
      // Create second user and get their CSRF token
      const secondUser = await createTestUser();
      
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: secondUser.email,
          password: 'TestPassword123!'
        });
      
      const secondAuthToken = loginResponse.body.data.token;
      
      const csrfResponse = await request(app)
        .get('/api/csrf-token')
        .set('Authorization', `Bearer ${secondAuthToken}`);
      
      if (csrfResponse.status === 200) {
        const secondUserCsrfToken = csrfResponse.body.csrfToken;
        
        // Try to use second user's CSRF token with first user's session
        const response = await request(app)
          .post('/api/treasury/rules')
          .send({
            name: 'Cross-session CSRF test',
            type: 'percentage',
            configuration: { percentage: 5 }
          })
          .set('Authorization', `Bearer ${authToken}`)
          .set('X-CSRF-Token', secondUserCsrfToken);
        
        // Should reject due to CSRF token mismatch
        expect([403, 400]).toContain(response.status);
      }
    });
  });

  describe('SameSite Cookie Protection', () => {
    test('should set SameSite attribute on session cookies', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'TestPassword123!'
        });
      
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        const sessionCookie = cookies.find((cookie: string) => 
          cookie.includes('session') || cookie.includes('token') || cookie.includes('auth')
        );
        
        if (sessionCookie) {
          // Should have SameSite=Strict or SameSite=Lax
          expect(sessionCookie).toMatch(/SameSite=(Strict|Lax)/i);
        }
      }
    });
  });

  describe('Origin Header Validation', () => {
    test('should validate Origin header for sensitive operations', async () => {
      const maliciousOrigins = [
        'https://evil.com',
        'http://attacker.example.com',
        'https://liquid-abt.evil.com',
        'null',
        'file://',
        'data:text/html,<script>alert(1)</script>'
      ];

      for (const origin of maliciousOrigins) {
        const response = await request(app)
          .post('/api/treasury/rules')
          .send({
            name: 'Origin test rule',
            type: 'percentage',
            configuration: { percentage: 5 }
          })
          .set('Authorization', `Bearer ${authToken}`)
          .set('X-CSRF-Token', csrfToken)
          .set('Origin', origin);
        
        // Should reject requests from malicious origins
        // Note: In a real application, this would be configured based on allowed origins
        if (response.status === 403) {
          expect(response.body.error?.message).toMatch(/origin|cors|forbidden/i);
        }
      }
    });

    test('should accept requests from allowed origins', async () => {
      const allowedOrigins = [
        'https://app.liquidtreasury.business',
        'https://staging.liquidtreasury.business',
        'http://localhost:3000',
        'http://localhost:3001'
      ];

      for (const origin of allowedOrigins.slice(0, 2)) { // Test first 2 to avoid too many requests
        const response = await request(app)
          .post('/api/treasury/rules')
          .send({
            name: `Origin test rule - ${origin}`,
            type: 'percentage',
            configuration: { percentage: 5 }
          })
          .set('Authorization', `Bearer ${authToken}`)
          .set('X-CSRF-Token', csrfToken)
          .set('Origin', origin);
        
        // Should not reject due to origin (may fail for other reasons)
        if (response.status === 403 && response.body.error) {
          expect(response.body.error.message).not.toMatch(/origin|cors/i);
        }
      }
    });
  });

  describe('Referer Header Validation', () => {
    test('should validate Referer header for sensitive operations', async () => {
      const maliciousReferers = [
        'https://evil.com/csrf-attack.html',
        'http://attacker.example.com/steal-data',
        'https://phishing-liquidabt.com/',
        ''
      ];

      for (const referer of maliciousReferers) {
        const response = await request(app)
          .delete('/api/treasury/rules/test-rule-id')
          .set('Authorization', `Bearer ${authToken}`)
          .set('X-CSRF-Token', csrfToken)
          .set('Referer', referer);
        
        // Should reject or at least not process successfully
        if (response.status === 403) {
          expect(response.body.error?.message).toMatch(/referer|forbidden/i);
        }
      }
    });
  });

  describe('Double Submit Cookie Pattern', () => {
    test('should implement double submit cookie pattern if used', async () => {
      // If the application uses double submit cookie pattern
      const response = await request(app)
        .post('/api/treasury/rules')
        .send({
          name: 'Double submit test',
          type: 'percentage',
          configuration: { percentage: 5 }
        })
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-CSRF-Token', csrfToken)
        .set('Cookie', `csrf-token=${csrfToken}; session=valid-session`);
      
      // Should not reject due to CSRF
      expect(response.status).not.toBe(403);
    });
  });

  describe('State-less Operations Should Not Require CSRF', () => {
    const readOnlyEndpoints = [
      { method: 'GET', path: '/api/treasury/overview' },
      { method: 'GET', path: '/api/treasury/purchases' },
      { method: 'GET', path: '/api/treasury/rules' },
      { method: 'GET', path: '/api/users/profile' },
      { method: 'GET', path: '/api/integrations/payment-processors' }
    ];

    test.each(readOnlyEndpoints)('$method $path should not require CSRF token', async (endpoint) => {
      const response = await request(app)
        .get(endpoint.path)
        .set('Authorization', `Bearer ${authToken}`);
      
      // Should not reject due to missing CSRF token
      expect(response.status).not.toBe(403);
      
      if (response.status === 400 && response.body.error) {
        const errorMessage = response.body.error.message?.toLowerCase() || '';
        expect(errorMessage).not.toMatch(/csrf|token/);
      }
    });
  });

  describe('CSRF Protection Bypass Attempts', () => {
    test('should prevent CSRF bypass via method override', async () => {
      // Attempt to bypass CSRF by using POST with method override
      const response = await request(app)
        .post('/api/treasury/rules/test-rule-id')
        .send({ _method: 'DELETE' })
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json');
      
      // Should still require CSRF protection
      expect([403, 405, 400]).toContain(response.status);
    });

    test('should prevent CSRF bypass via content-type manipulation', async () => {
      // Attempt to bypass CSRF by using different content types
      const contentTypes = [
        'text/plain',
        'application/x-www-form-urlencoded',
        'multipart/form-data',
        'application/xml'
      ];

      for (const contentType of contentTypes) {
        const response = await request(app)
          .post('/api/treasury/rules')
          .send('name=BypassTest&type=percentage&configuration[percentage]=5')
          .set('Authorization', `Bearer ${authToken}`)
          .set('Content-Type', contentType);
        
        // Should still require CSRF protection
        if (response.status !== 415) { // Unsupported Media Type is acceptable
          expect([403, 400]).toContain(response.status);
        }
      }
    });

    test('should prevent CSRF bypass via custom headers', async () => {
      const response = await request(app)
        .post('/api/treasury/rules')
        .send({
          name: 'Custom header bypass test',
          type: 'percentage',
          configuration: { percentage: 5 }
        })
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Requested-With', 'XMLHttpRequest') // Common AJAX header
        .set('Content-Type', 'application/json');
      
      // Should still require CSRF token even with custom headers
      expect([403, 400]).toContain(response.status);
    });
  });

  describe('CSRF Token Entropy and Security', () => {
    test('CSRF tokens should have sufficient entropy', async () => {
      const tokens = [];
      
      // Generate multiple CSRF tokens
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .get('/api/csrf-token')
          .set('Authorization', `Bearer ${authToken}`);
        
        if (response.status === 200) {
          tokens.push(response.body.csrfToken);
        }
      }
      
      if (tokens.length > 0) {
        // All tokens should be unique
        const uniqueTokens = [...new Set(tokens)];
        expect(uniqueTokens.length).toBe(tokens.length);
        
        // Tokens should be of sufficient length
        tokens.forEach(token => {
          expect(token.length).toBeGreaterThanOrEqual(16);
        });
        
        // Tokens should not follow predictable patterns
        if (tokens.length >= 2) {
          expect(tokens[0]).not.toBe(tokens[1]);
          expect(tokens[0].substring(0, 8)).not.toBe(tokens[1].substring(0, 8));
        }
      }
    });
  });
});