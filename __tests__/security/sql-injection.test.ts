import request from 'supertest';
// Security testing for Next.js API routes - no Express app needed
import { createConnectionPool } from '../../src/lib/database/connectionPool';
import { createTestUser, cleanupTestData } from '../helpers/index';

describe('SQL Injection Security Tests', () => {
  let pool: any;
  let testUser: any;
  let authToken: string;

  beforeAll(async () => {
    pool = createConnectionPool();
    testUser = await createTestUser();
    
    // Get auth token for authenticated endpoint tests
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUser.email,
        password: 'TestPassword123!'
      });
    
    authToken = loginResponse.body.data.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    await pool.close();
  });

  const sqlInjectionPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "' UNION SELECT * FROM users --",
    "admin'; --",
    "1' OR 1=1 --",
    "' OR 1=1 #",
    "'; INSERT INTO users (email) VALUES ('hacker@evil.com'); --",
    "' OR EXISTS(SELECT * FROM users WHERE email='admin@example.com') --",
    "' AND (SELECT COUNT(*) FROM users) > 0 --",
    "'; UPDATE users SET email='hacked@evil.com' WHERE id=1; --"
  ];

  describe('GET endpoint SQL injection tests', () => {
    test.each(sqlInjectionPayloads)('should prevent SQL injection in user lookup: %s', async (payload) => {
      const response = await request(app)
        .get(`/api/users/profile`)
        .query({ email: payload })
        .set('Authorization', `Bearer ${authToken}`)
        .expect((res) => {
          // Should not return 500 internal server error (which might indicate SQL error)
          expect(res.status).not.toBe(500);
          
          // Should not contain SQL error messages
          const responseText = JSON.stringify(res.body).toLowerCase();
          const sqlErrorPatterns = [
            'syntax error',
            'sql error',
            'mysql error',
            'postgresql error',
            'ora-',
            'microsoft ole db',
            'odbc',
            'sqlite_error',
            'column',
            'table does not exist',
            'relation does not exist'
          ];
          
          sqlErrorPatterns.forEach(pattern => {
            expect(responseText).not.toContain(pattern);
          });
        });
    });

    test.each(sqlInjectionPayloads)('should prevent SQL injection in treasury rules: %s', async (payload) => {
      const response = await request(app)
        .get('/api/treasury/rules')
        .query({ ruleId: payload })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).not.toBe(500);
      
      const responseText = JSON.stringify(response.body).toLowerCase();
      expect(responseText).not.toContain('syntax error');
      expect(responseText).not.toContain('sql error');
    });

    test.each(sqlInjectionPayloads)('should prevent SQL injection in purchase history: %s', async (payload) => {
      const response = await request(app)
        .get('/api/treasury/purchases')
        .query({ tenantId: payload })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).not.toBe(500);
    });
  });

  describe('POST endpoint SQL injection tests', () => {
    test.each(sqlInjectionPayloads)('should prevent SQL injection in user creation: %s', async (payload) => {
      const response = await request(app)
        .post('/api/users')
        .send({
          email: payload,
          name: 'Test User',
          role: 'user'
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).not.toBe(500);
      
      // Should not have created a user with SQL injection payload
      if (response.status === 201) {
        expect(response.body.data.email).not.toContain('OR');
        expect(response.body.data.email).not.toContain('SELECT');
      }
    });

    test.each(sqlInjectionPayloads)('should prevent SQL injection in treasury rule creation: %s', async (payload) => {
      const response = await request(app)
        .post('/api/treasury/rules')
        .send({
          name: payload,
          type: 'percentage',
          configuration: { percentage: 10 },
          enabled: true
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).not.toBe(500);
    });

    test.each(sqlInjectionPayloads)('should prevent SQL injection in login: %s', async (payload) => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: payload,
          password: 'anypassword'
        });
      
      // Should not result in internal server error
      expect(response.status).not.toBe(500);
      
      // Should not successfully authenticate with SQL injection
      expect(response.status).not.toBe(200);
    });
  });

  describe('PUT endpoint SQL injection tests', () => {
    test.each(sqlInjectionPayloads)('should prevent SQL injection in user updates: %s', async (payload) => {
      const response = await request(app)
        .put('/api/users/profile')
        .send({
          name: payload,
          email: 'test@example.com'
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).not.toBe(500);
    });
  });

  describe('Parameterized query verification', () => {
    test('should use parameterized queries for user lookup', async () => {
      // Test with a legitimate single quote in data
      const nameWithQuote = "O'Reilly";
      
      const response = await request(app)
        .put('/api/users/profile')
        .send({
          name: nameWithQuote,
          email: testUser.email
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      // Should handle single quotes properly without SQL errors
      if (response.status === 200) {
        expect(response.body.data.name).toBe(nameWithQuote);
      } else {
        // Should at least not crash with 500
        expect(response.status).not.toBe(500);
      }
    });

    test('should handle Unicode characters safely', async () => {
      const unicodeName = '测试用户 🚀';
      
      const response = await request(app)
        .put('/api/users/profile')
        .send({
          name: unicodeName,
          email: testUser.email
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).not.toBe(500);
    });
  });

  describe('Tenant isolation SQL injection tests', () => {
    test.each(sqlInjectionPayloads)('should prevent cross-tenant data access via SQL injection: %s', async (payload) => {
      const response = await request(app)
        .get('/api/treasury/purchases')
        .query({ 
          tenantId: payload,
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).not.toBe(500);
      
      // Should not return data from other tenants
      if (response.status === 200 && response.body.data) {
        response.body.data.forEach((purchase: any) => {
          expect(purchase.tenantId).toBe(testUser.tenantId);
        });
      }
    });
  });

  describe('Blind SQL injection tests', () => {
    test('should prevent time-based blind SQL injection', async () => {
      const timeBasedPayload = "'; WAITFOR DELAY '00:00:05'; --";
      
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/users/profile')
        .query({ email: timeBasedPayload })
        .set('Authorization', `Bearer ${authToken}`);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should not cause significant delay (more than 1 second)
      expect(duration).toBeLessThan(1000);
      expect(response.status).not.toBe(500);
    });

    test('should prevent boolean-based blind SQL injection', async () => {
      const booleanPayloads = [
        "' AND 1=1 --",
        "' AND 1=2 --"
      ];
      
      const responses = [];
      
      for (const payload of booleanPayloads) {
        const response = await request(app)
          .get('/api/treasury/rules')
          .query({ search: payload })
          .set('Authorization', `Bearer ${authToken}`);
        
        responses.push({
          payload,
          status: response.status,
          data: response.body
        });
      }
      
      // Both payloads should return the same response
      // (indicating the injection didn't affect query logic)
      expect(responses[0].status).toBe(responses[1].status);
      
      if (responses[0].status === 200 && responses[1].status === 200) {
        expect(JSON.stringify(responses[0].data)).toBe(JSON.stringify(responses[1].data));
      }
    });
  });

  describe('NoSQL injection tests (if applicable)', () => {
    test.each([
      '{"$ne": null}',
      '{"$gt": ""}',
      '{"$where": "this.email.length > 0"}',
      '{"$regex": ".*"}',
      '{"$or": [{"email": "admin@example.com"}]}'
    ])('should prevent NoSQL injection: %s', async (payload) => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: payload,
          password: 'anypassword'
        });
      
      expect(response.status).not.toBe(500);
      expect(response.status).not.toBe(200); // Should not authenticate
    });
  });
});