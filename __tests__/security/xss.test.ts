import request from 'supertest';
// Security testing for Next.js API routes - no Express app needed
import { createTestUser, cleanupTestData } from '../helpers/index';

describe('XSS (Cross-Site Scripting) Security Tests', () => {
  let testUser: any;
  let authToken: string;

  beforeAll(async () => {
    testUser = await createTestUser();
    
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
  });

  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '"><script>alert("XSS")</script>',
    '\'-alert("XSS")-\'',
    '<img src=x onerror=alert("XSS")>',
    '<svg onload=alert("XSS")>',
    'javascript:alert("XSS")',
    '<iframe src="javascript:alert(`XSS`)">',
    '<input type="text" value="" onfocus="alert(\'XSS\')" autofocus>',
    '<body onload=alert("XSS")>',
    '<div onclick="alert(\'XSS\')">Click</div>',
    '&lt;script&gt;alert("XSS")&lt;/script&gt;',
    '%3Cscript%3Ealert("XSS")%3C/script%3E',
    '<ScRiPt>alert("XSS")</ScRiPt>',
    '<script src="data:text/javascript,alert(\'XSS\')"></script>',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(\'XSS\')">',
    '<<SCRIPT>alert("XSS");//<</SCRIPT>',
    '<script>String.fromCharCode(88,83,83)</script>',
    '"><script>alert(String.fromCharCode(88,83,83))</script>',
    '\';alert(String.fromCharCode(88,83,83))//\';',
    '\';alert(String.fromCharCode(88,83,83))//--',
    '</script><script>alert("XSS")</script>',
    '<script type="text/javascript">alert("XSS");</script>',
    '&ltscript&gtalert("XSS")&lt/script&gt'
  ];

  describe('Reflected XSS Tests', () => {
    test.each(xssPayloads)('should prevent reflected XSS in user profile name: %s', async (payload) => {
      const response = await request(app)
        .put('/api/users/profile')
        .send({
          name: payload,
          email: testUser.email
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response.status === 200) {
        const responseText = JSON.stringify(response.body);
        
        // Check that dangerous characters are properly encoded
        if (responseText.includes(payload)) {
          // If the payload is reflected, it should be HTML encoded
          expect(responseText).not.toMatch(/<script[\s\S]*?>[\s\S]*?<\/script>/i);
          expect(responseText).not.toMatch(/on\w+\s*=\s*["']?[^"']*["']?/i);
          expect(responseText).not.toMatch(/javascript:/i);
          
          // Should contain encoded versions
          if (payload.includes('<')) {
            expect(responseText.includes('&lt;') || responseText.includes('\\u003c')).toBe(true);
          }
          if (payload.includes('>')) {
            expect(responseText.includes('&gt;') || responseText.includes('\\u003e')).toBe(true);
          }
          if (payload.includes('"')) {
            expect(responseText.includes('&quot;') || responseText.includes('\\u0022')).toBe(true);
          }
          if (payload.includes("'")) {
            expect(responseText.includes('&#39;') || responseText.includes('\\u0027')).toBe(true);
          }
        }
      }
    });

    test.each(xssPayloads)('should prevent reflected XSS in treasury rule name: %s', async (payload) => {
      const response = await request(app)
        .post('/api/treasury/rules')
        .send({
          name: payload,
          type: 'percentage',
          configuration: { percentage: 10 },
          enabled: true
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response.status === 201) {
        const responseText = JSON.stringify(response.body);
        
        // Ensure no unescaped script tags or event handlers
        expect(responseText).not.toMatch(/<script[\s\S]*?>[\s\S]*?<\/script>/i);
        expect(responseText).not.toMatch(/on\w+\s*=\s*["']?[^"']*["']?/i);
        expect(responseText).not.toMatch(/javascript:/i);
      }
    });

    test.each(xssPayloads)('should prevent reflected XSS in error messages: %s', async (payload) => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: payload,
          password: 'invalidpassword'
        });
      
      const responseText = JSON.stringify(response.body);
      
      // Error messages should not reflect unescaped XSS payloads
      expect(responseText).not.toMatch(/<script[\s\S]*?>[\s\S]*?<\/script>/i);
      expect(responseText).not.toMatch(/on\w+\s*=\s*["']?[^"']*["']?/i);
      expect(responseText).not.toMatch(/javascript:/i);
    });

    test.each(xssPayloads)('should prevent reflected XSS in search parameters: %s', async (payload) => {
      const response = await request(app)
        .get('/api/treasury/rules')
        .query({ search: payload })
        .set('Authorization', `Bearer ${authToken}`);
      
      const responseText = JSON.stringify(response.body);
      
      // Search results should not contain unescaped XSS
      expect(responseText).not.toMatch(/<script[\s\S]*?>[\s\S]*?<\/script>/i);
      expect(responseText).not.toMatch(/on\w+\s*=\s*["']?[^"']*["']?/i);
    });
  });

  describe('Stored XSS Tests', () => {
    test.each(xssPayloads)('should prevent stored XSS via user profile: %s', async (payload) => {
      // First, try to store the XSS payload
      await request(app)
        .put('/api/users/profile')
        .send({
          name: payload,
          email: testUser.email,
          bio: `Bio with payload: ${payload}`
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      // Then retrieve the profile and check if XSS is properly escaped
      const getResponse = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`);
      
      if (getResponse.status === 200) {
        const responseText = JSON.stringify(getResponse.body);
        
        // Should not contain executable script tags
        expect(responseText).not.toMatch(/<script[\s\S]*?>[\s\S]*?<\/script>/i);
        expect(responseText).not.toMatch(/on\w+\s*=\s*["']?[^"']*["']?/i);
        expect(responseText).not.toMatch(/javascript:/i);
        
        // Should not contain unescaped HTML
        expect(responseText).not.toMatch(/<[^>]*>/);
      }
    });

    test.each(xssPayloads)('should prevent stored XSS via treasury rule descriptions: %s', async (payload) => {
      // Create rule with XSS in description
      const createResponse = await request(app)
        .post('/api/treasury/rules')
        .send({
          name: 'Test Rule',
          description: payload,
          type: 'percentage',
          configuration: { percentage: 5 },
          enabled: true
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      if (createResponse.status === 201) {
        const ruleId = createResponse.body.data.id;
        
        // Retrieve the rule and check for XSS
        const getResponse = await request(app)
          .get(`/api/treasury/rules/${ruleId}`)
          .set('Authorization', `Bearer ${authToken}`);
        
        if (getResponse.status === 200) {
          const responseText = JSON.stringify(getResponse.body);
          
          expect(responseText).not.toMatch(/<script[\s\S]*?>[\s\S]*?<\/script>/i);
          expect(responseText).not.toMatch(/on\w+\s*=\s*["']?[^"']*["']?/i);
          expect(responseText).not.toMatch(/javascript:/i);
        }
      }
    });

    test.each(xssPayloads)('should prevent stored XSS in notification messages: %s', async (payload) => {
      const response = await request(app)
        .put('/api/notifications/settings')
        .send({
          email: {
            enabled: true,
            customMessage: payload
          }
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response.status === 200) {
        // Get notification settings back
        const getResponse = await request(app)
          .get('/api/notifications/settings')
          .set('Authorization', `Bearer ${authToken}`);
        
        if (getResponse.status === 200) {
          const responseText = JSON.stringify(getResponse.body);
          
          expect(responseText).not.toMatch(/<script[\s\S]*?>[\s\S]*?<\/script>/i);
          expect(responseText).not.toMatch(/on\w+\s*=\s*["']?[^"']*["']?/i);
        }
      }
    });
  });

  describe('DOM-based XSS Tests', () => {
    test('should not reflect dangerous content in JSON responses', async () => {
      const domPayload = '"><svg onload=alert(document.domain)>';
      
      const response = await request(app)
        .get('/api/treasury/overview')
        .query({ format: domPayload })
        .set('Authorization', `Bearer ${authToken}`);
      
      const responseText = JSON.stringify(response.body);
      
      // Should not contain raw SVG or script content
      expect(responseText).not.toMatch(/<svg[\s\S]*?onload[\s\S]*?>/i);
      expect(responseText).not.toMatch(/document\.domain/i);
    });

    test('should properly escape JSON strings', async () => {
      const jsonPayload = '{"xss": "</script><script>alert(1)</script>"}';
      
      const response = await request(app)
        .put('/api/users/profile')
        .send({
          metadata: jsonPayload
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response.status === 200) {
        const responseText = JSON.stringify(response.body);
        
        // Should not contain unescaped script tags in JSON
        expect(responseText).not.toMatch(/<\/script>/i);
        expect(responseText).not.toMatch(/<script>/i);
      }
    });
  });

  describe('Content-Type Header Tests', () => {
    test('should return correct content-type headers', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`);
      
      // Should return JSON content type
      expect(response.headers['content-type']).toMatch(/application\/json/);
      
      // Should not return HTML content type that could enable XSS
      expect(response.headers['content-type']).not.toMatch(/text\/html/);
    });

    test('should include X-Content-Type-Options header', async () => {
      const response = await request(app)
        .get('/api/health');
      
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('CSP Header Tests', () => {
    test('should include Content Security Policy header', async () => {
      const response = await request(app)
        .get('/api/health');
      
      expect(response.headers['content-security-policy']).toBeDefined();
      
      const csp = response.headers['content-security-policy'];
      
      // Should prevent inline scripts
      expect(csp).toMatch(/script-src[^;]*'self'/);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    });
  });

  describe('URL-based XSS Tests', () => {
    test.each([
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'about:blank',
      'file:///etc/passwd'
    ])('should prevent XSS via URL parameters: %s', async (maliciousUrl) => {
      const response = await request(app)
        .put('/api/users/profile')
        .send({
          website: maliciousUrl,
          avatar: maliciousUrl
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response.status === 200) {
        const responseText = JSON.stringify(response.body);
        
        // Should not contain dangerous URL schemes
        expect(responseText).not.toMatch(/javascript:/i);
        expect(responseText).not.toMatch(/data:text\/html/i);
        expect(responseText).not.toMatch(/vbscript:/i);
      }
    });
  });

  describe('File Upload XSS Tests', () => {
    test('should prevent XSS in file upload responses', async () => {
      const maliciousFilename = '<script>alert("XSS")</script>.jpg';
      
      // Note: This would require multipart/form-data handling
      // For now, testing JSON-based file info
      const response = await request(app)
        .post('/api/users/avatar')
        .send({
          filename: maliciousFilename,
          contentType: 'image/jpeg'
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response.status === 200) {
        const responseText = JSON.stringify(response.body);
        
        // Filename should be properly escaped
        expect(responseText).not.toMatch(/<script[\s\S]*?>[\s\S]*?<\/script>/i);
      }
    });
  });

  describe('Template Injection Tests', () => {
    test.each([
      '{{7*7}}',
      '${7*7}',
      '<%= 7*7 %>',
      '{%raw%}{{7*7}}{%endraw%}',
      '#{7*7}',
      '[[7*7]]'
    ])('should prevent template injection: %s', async (templatePayload) => {
      const response = await request(app)
        .put('/api/users/profile')
        .send({
          name: templatePayload
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      if (response.status === 200) {
        const responseText = JSON.stringify(response.body);
        
        // Should not execute template expressions (would result in "49")
        expect(responseText).not.toContain('49');
        
        // Should contain the original template syntax (properly escaped)
        expect(responseText).toContain(templatePayload.replace(/[{}]/g, ''));
      }
    });
  });
});