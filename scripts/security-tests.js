#!/usr/bin/env node
/**
 * LIQUID ABT - Comprehensive Security Testing Suite
 * Tests for SQL Injection, XSS, CSRF, Authentication Bypass, and other security vulnerabilities
 */

const axios = require('axios');
const crypto = require('crypto');

class SecurityTester {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.results = {
      passed: 0,
      failed: 0,
      warnings: 0,
      tests: []
    };
    this.validToken = null;
    this.csrfToken = null;
  }

  log(level, message, details = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, details };
    
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
    if (Object.keys(details).length > 0) {
      console.log('  Details:', JSON.stringify(details, null, 2));
    }
    
    this.results.tests.push(logEntry);
  }

  async test(description, testFn) {
    try {
      console.log(`\n🔍 Testing: ${description}`);
      const result = await testFn();
      
      if (result.passed) {
        this.results.passed++;
        this.log('pass', description, result.details);
      } else {
        this.results.failed++;
        this.log('fail', description, result.details);
      }
      
      return result;
    } catch (error) {
      this.results.failed++;
      this.log('error', `${description} - Unexpected error`, { error: error.message });
      return { passed: false, error: error.message };
    }
  }

  async warn(description, details = {}) {
    this.results.warnings++;
    this.log('warn', description, details);
  }

  // Authentication helper
  async authenticate() {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/login`, {
        email: 'test@example.com',
        password: 'TestPassword123!'
      });
      
      this.validToken = response.data.data.token;
      return this.validToken;
    } catch (error) {
      console.log('Note: Authentication failed - some tests may be limited');
      return null;
    }
  }

  // Get CSRF token
  async getCsrfToken() {
    try {
      const response = await axios.get(`${this.baseURL}/api/csrf-token`);
      this.csrfToken = response.data.csrfToken;
      return this.csrfToken;
    } catch (error) {
      console.log('Note: CSRF token endpoint not found - testing with manual token');
      return 'test-csrf-token';
    }
  }

  // SQL Injection Tests
  async testSqlInjection() {
    const sqlPayloads = [
      "' OR '1'='1",
      "'; DROP TABLE users; --",
      "' UNION SELECT * FROM users --",
      "admin'; --",
      "1' OR 1=1 --",
      "' OR 1=1 #",
      "'; INSERT INTO users (email) VALUES ('hacker@evil.com'); --",
      "' OR EXISTS(SELECT * FROM users WHERE email='admin@example.com') --"
    ];

    const endpoints = [
      { path: '/api/users', param: 'email' },
      { path: '/api/treasury/purchases', param: 'tenantId' },
      { path: '/api/auth/login', param: 'email' },
      { path: '/api/treasury/rules', param: 'ruleId' },
      { path: '/api/integrations/payment-processors', param: 'provider' }
    ];

    let vulnerableEndpoints = [];
    let totalTests = 0;

    for (const endpoint of endpoints) {
      for (const payload of sqlPayloads) {
        totalTests++;
        
        try {
          // Test GET parameter injection
          const getResponse = await axios.get(`${this.baseURL}${endpoint.path}?${endpoint.param}=${encodeURIComponent(payload)}`, {
            headers: this.validToken ? { Authorization: `Bearer ${this.validToken}` } : {},
            timeout: 5000,
            validateStatus: () => true // Don't throw on error status codes
          });

          // Check for SQL error messages in response
          const responseText = JSON.stringify(getResponse.data).toLowerCase();
          const sqlErrors = [
            'syntax error', 'sql error', 'mysql error', 'postgresql error',
            'ora-', 'microsoft ole db', 'odbc', 'sqlite_error',
            'column', 'table', 'database', 'relation does not exist'
          ];

          const foundSqlError = sqlErrors.some(error => responseText.includes(error));
          
          if (foundSqlError || getResponse.status === 500) {
            vulnerableEndpoints.push({
              endpoint: endpoint.path,
              parameter: endpoint.param,
              payload: payload,
              response: getResponse.status,
              method: 'GET'
            });
          }

          // Test POST body injection
          if (['POST', 'PUT', 'PATCH'].includes('POST')) {
            const postData = {};
            postData[endpoint.param] = payload;

            const postResponse = await axios.post(`${this.baseURL}${endpoint.path}`, postData, {
              headers: {
                'Content-Type': 'application/json',
                ...(this.validToken ? { Authorization: `Bearer ${this.validToken}` } : {})
              },
              timeout: 5000,
              validateStatus: () => true
            });

            const postResponseText = JSON.stringify(postResponse.data).toLowerCase();
            const foundPostSqlError = sqlErrors.some(error => postResponseText.includes(error));
            
            if (foundPostSqlError || postResponse.status === 500) {
              vulnerableEndpoints.push({
                endpoint: endpoint.path,
                parameter: endpoint.param,
                payload: payload,
                response: postResponse.status,
                method: 'POST'
              });
            }
          }

        } catch (error) {
          // Timeout or network errors don't indicate SQL injection
          continue;
        }
      }
    }

    return {
      passed: vulnerableEndpoints.length === 0,
      details: {
        totalTests,
        vulnerableEndpoints,
        message: vulnerableEndpoints.length === 0 
          ? 'No SQL injection vulnerabilities found'
          : `Found ${vulnerableEndpoints.length} potentially vulnerable endpoints`
      }
    };
  }

  // XSS Tests
  async testXss() {
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
      '<div onclick="alert(\'XSS\')">Click</div>'
    ];

    const endpoints = [
      { path: '/api/users/profile', param: 'name' },
      { path: '/api/treasury/rules', param: 'name' },
      { path: '/api/notifications/settings', param: 'email' },
      { path: '/api/integrations/payment-processors', param: 'description' }
    ];

    let vulnerableEndpoints = [];
    let totalTests = 0;

    for (const endpoint of endpoints) {
      for (const payload of xssPayloads) {
        totalTests++;

        try {
          const response = await axios.post(`${this.baseURL}${endpoint.path}`, {
            [endpoint.param]: payload
          }, {
            headers: {
              'Content-Type': 'application/json',
              ...(this.validToken ? { Authorization: `Bearer ${this.validToken}` } : {})
            },
            timeout: 5000,
            validateStatus: () => true
          });

          // Check if payload is reflected in response without encoding
          const responseText = JSON.stringify(response.data);
          if (responseText.includes(payload) && !responseText.includes('&lt;') && !responseText.includes('&amp;')) {
            vulnerableEndpoints.push({
              endpoint: endpoint.path,
              parameter: endpoint.param,
              payload: payload,
              reflected: true
            });
          }

        } catch (error) {
          continue;
        }
      }
    }

    return {
      passed: vulnerableEndpoints.length === 0,
      details: {
        totalTests,
        vulnerableEndpoints,
        message: vulnerableEndpoints.length === 0 
          ? 'No XSS vulnerabilities found'
          : `Found ${vulnerableEndpoints.length} potentially vulnerable endpoints`
      }
    };
  }

  // CSRF Tests
  async testCsrf() {
    const sensitiveEndpoints = [
      { path: '/api/treasury/rules', method: 'POST' },
      { path: '/api/treasury/rules/rule-123', method: 'DELETE' },
      { path: '/api/users/profile', method: 'PUT' },
      { path: '/api/integrations/payment-processors', method: 'POST' },
      { path: '/api/auth/change-password', method: 'POST' }
    ];

    let vulnerableEndpoints = [];
    let totalTests = 0;

    for (const endpoint of sensitiveEndpoints) {
      totalTests++;

      try {
        // Test without CSRF token
        const response = await axios({
          method: endpoint.method,
          url: `${this.baseURL}${endpoint.path}`,
          data: { test: 'csrf-test' },
          headers: {
            'Content-Type': 'application/json',
            ...(this.validToken ? { Authorization: `Bearer ${this.validToken}` } : {})
            // Intentionally omitting CSRF token
          },
          timeout: 5000,
          validateStatus: () => true
        });

        // If request succeeds without CSRF token, it's vulnerable
        if (response.status < 400) {
          vulnerableEndpoints.push({
            endpoint: endpoint.path,
            method: endpoint.method,
            status: response.status,
            vulnerable: 'No CSRF protection'
          });
        }

        // Test with invalid CSRF token
        const invalidResponse = await axios({
          method: endpoint.method,
          url: `${this.baseURL}${endpoint.path}`,
          data: { test: 'csrf-test' },
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'invalid-token',
            ...(this.validToken ? { Authorization: `Bearer ${this.validToken}` } : {})
          },
          timeout: 5000,
          validateStatus: () => true
        });

        if (invalidResponse.status < 400) {
          vulnerableEndpoints.push({
            endpoint: endpoint.path,
            method: endpoint.method,
            status: invalidResponse.status,
            vulnerable: 'Invalid CSRF token accepted'
          });
        }

      } catch (error) {
        continue;
      }
    }

    return {
      passed: vulnerableEndpoints.length === 0,
      details: {
        totalTests,
        vulnerableEndpoints,
        message: vulnerableEndpoints.length === 0 
          ? 'CSRF protection appears to be implemented'
          : `Found ${vulnerableEndpoints.length} endpoints without proper CSRF protection`
      }
    };
  }

  // Authentication Bypass Tests
  async testAuthBypass() {
    const protectedEndpoints = [
      '/api/treasury/overview',
      '/api/treasury/purchases',
      '/api/treasury/rules',
      '/api/users/profile',
      '/api/integrations/payment-processors'
    ];

    const bypassAttempts = [
      { name: 'No token', headers: {} },
      { name: 'Empty token', headers: { Authorization: 'Bearer ' } },
      { name: 'Invalid token', headers: { Authorization: 'Bearer invalid-token-here' } },
      { name: 'Malformed token', headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.invalid' } },
      { name: 'SQL injection in token', headers: { Authorization: "Bearer ' OR '1'='1" } },
      { name: 'Admin impersonation', headers: { Authorization: 'Bearer', 'X-User-Role': 'admin' } },
      { name: 'Tenant bypass', headers: { Authorization: 'Bearer fake', 'X-Tenant-ID': 'admin' } }
    ];

    let vulnerableEndpoints = [];
    let totalTests = 0;

    for (const endpoint of protectedEndpoints) {
      for (const attempt of bypassAttempts) {
        totalTests++;

        try {
          const response = await axios.get(`${this.baseURL}${endpoint}`, {
            headers: attempt.headers,
            timeout: 5000,
            validateStatus: () => true
          });

          // If we get a 200 OK instead of 401/403, it might be vulnerable
          if (response.status === 200) {
            vulnerableEndpoints.push({
              endpoint,
              attempt: attempt.name,
              status: response.status,
              concern: 'Protected endpoint accessible without valid authentication'
            });
          }

        } catch (error) {
          continue;
        }
      }
    }

    return {
      passed: vulnerableEndpoints.length === 0,
      details: {
        totalTests,
        vulnerableEndpoints,
        message: vulnerableEndpoints.length === 0 
          ? 'Authentication appears to be properly enforced'
          : `Found ${vulnerableEndpoints.length} potential authentication bypass issues`
      }
    };
  }

  // Session Management Tests
  async testSessionManagement() {
    let issues = [];

    // Test 1: Session fixation
    try {
      const loginResponse = await axios.post(`${this.baseURL}/api/auth/login`, {
        email: 'test@example.com',
        password: 'TestPassword123!'
      }, {
        timeout: 5000,
        validateStatus: () => true
      });

      if (loginResponse.status === 200) {
        const token = loginResponse.data.data?.token;
        if (token) {
          // Test token structure
          const tokenParts = token.split('.');
          if (tokenParts.length !== 3) {
            issues.push('Token is not a proper JWT format');
          }

          // Test token expiration (decode without verification)
          try {
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            const now = Math.floor(Date.now() / 1000);
            
            if (!payload.exp) {
              issues.push('Token does not have expiration time');
            } else if (payload.exp - now > 86400) {
              issues.push('Token has very long expiration time (> 24 hours)');
            }

            if (!payload.iat) {
              issues.push('Token does not have issued at time');
            }

          } catch (error) {
            issues.push('Cannot decode token payload');
          }
        }
      }
    } catch (error) {
      issues.push('Cannot test session management - login endpoint unavailable');
    }

    // Test 2: Session timeout
    if (this.validToken) {
      try {
        // Test using an old/expired token
        const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';
        const response = await axios.get(`${this.baseURL}/api/treasury/overview`, {
          headers: { Authorization: `Bearer ${expiredToken}` },
          timeout: 5000,
          validateStatus: () => true
        });

        if (response.status !== 401) {
          issues.push('Expired tokens may not be properly rejected');
        }
      } catch (error) {
        // Expected behavior
      }
    }

    return {
      passed: issues.length === 0,
      details: {
        issues,
        message: issues.length === 0 
          ? 'Session management appears secure'
          : `Found ${issues.length} session management concerns`
      }
    };
  }

  // Rate Limiting Tests
  async testRateLimiting() {
    const endpoints = [
      '/api/auth/login',
      '/api/auth/register', 
      '/api/treasury/purchases',
      '/api/webhooks/stripe'
    ];

    let rateLimitResults = [];

    for (const endpoint of endpoints) {
      console.log(`  Testing rate limiting on ${endpoint}...`);
      
      let requestCount = 0;
      let rateLimited = false;
      let startTime = Date.now();
      
      // Send rapid requests
      const requests = Array.from({ length: 20 }, async (_, i) => {
        try {
          const response = await axios.post(`${this.baseURL}${endpoint}`, {
            test: `rate-limit-test-${i}`,
            timestamp: Date.now()
          }, {
            timeout: 2000,
            validateStatus: () => true
          });

          requestCount++;
          
          if (response.status === 429) {
            rateLimited = true;
            return { rateLimited: true, requestNumber: i + 1 };
          }
          
          return { rateLimited: false, status: response.status };
        } catch (error) {
          return { error: error.code };
        }
      });

      const results = await Promise.all(requests);
      const duration = Date.now() - startTime;
      
      const rateLimitedCount = results.filter(r => r.rateLimited).length;
      
      rateLimitResults.push({
        endpoint,
        requestsMade: requestCount,
        rateLimitedResponses: rateLimitedCount,
        duration,
        hasRateLimit: rateLimitedCount > 0,
        firstRateLimitAt: results.find(r => r.rateLimited)?.requestNumber || null
      });
    }

    const endpointsWithoutRateLimit = rateLimitResults.filter(r => !r.hasRateLimit);

    return {
      passed: endpointsWithoutRateLimit.length === 0,
      details: {
        results: rateLimitResults,
        endpointsWithoutRateLimit: endpointsWithoutRateLimit.map(r => r.endpoint),
        message: endpointsWithoutRateLimit.length === 0 
          ? 'Rate limiting is implemented on all tested endpoints'
          : `${endpointsWithoutRateLimit.length} endpoints may lack rate limiting`
      }
    };
  }

  // Header Security Tests
  async testSecurityHeaders() {
    try {
      const response = await axios.get(`${this.baseURL}/api/health`, {
        timeout: 5000,
        validateStatus: () => true
      });

      const headers = response.headers;
      const securityIssues = [];

      // Check for security headers
      const requiredHeaders = {
        'x-content-type-options': 'nosniff',
        'x-frame-options': ['DENY', 'SAMEORIGIN'],
        'x-xss-protection': '1; mode=block',
        'strict-transport-security': true, // Just check presence
        'content-security-policy': true,
        'referrer-policy': true
      };

      Object.entries(requiredHeaders).forEach(([header, expectedValue]) => {
        const headerValue = headers[header];
        
        if (!headerValue) {
          securityIssues.push(`Missing security header: ${header}`);
        } else if (expectedValue !== true) {
          if (Array.isArray(expectedValue)) {
            if (!expectedValue.includes(headerValue)) {
              securityIssues.push(`Header ${header} has value '${headerValue}', expected one of: ${expectedValue.join(', ')}`);
            }
          } else if (headerValue !== expectedValue) {
            securityIssues.push(`Header ${header} has value '${headerValue}', expected '${expectedValue}'`);
          }
        }
      });

      // Check for information disclosure headers
      const badHeaders = ['server', 'x-powered-by', 'x-aspnet-version'];
      badHeaders.forEach(header => {
        if (headers[header]) {
          securityIssues.push(`Information disclosure header present: ${header}: ${headers[header]}`);
        }
      });

      return {
        passed: securityIssues.length === 0,
        details: {
          securityIssues,
          headers: headers,
          message: securityIssues.length === 0 
            ? 'Security headers are properly configured'
            : `Found ${securityIssues.length} security header issues`
        }
      };
    } catch (error) {
      return {
        passed: false,
        details: {
          error: error.message,
          message: 'Could not test security headers - endpoint unavailable'
        }
      };
    }
  }

  // Run all security tests
  async runAllTests() {
    console.log('🛡️  LIQUID ABT Security Testing Suite');
    console.log('=====================================\n');
    
    console.log(`Testing against: ${this.baseURL}`);
    
    // Setup
    await this.authenticate();
    await this.getCsrfToken();
    
    console.log('\n🔐 Starting Security Tests...\n');

    // Run all tests
    await this.test('SQL Injection Vulnerabilities', () => this.testSqlInjection());
    await this.test('Cross-Site Scripting (XSS)', () => this.testXss());
    await this.test('Cross-Site Request Forgery (CSRF)', () => this.testCsrf());
    await this.test('Authentication Bypass', () => this.testAuthBypass());
    await this.test('Session Management', () => this.testSessionManagement());
    await this.test('Rate Limiting', () => this.testRateLimiting());
    await this.test('Security Headers', () => this.testSecurityHeaders());

    // Generate report
    this.generateReport();
  }

  generateReport() {
    console.log('\n' + '='.repeat(50));
    console.log('🛡️  SECURITY TEST RESULTS');
    console.log('='.repeat(50));
    
    console.log(`\n✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⚠️  Warnings: ${this.results.warnings}`);
    console.log(`📊 Total Tests: ${this.results.passed + this.results.failed}`);

    const overallStatus = this.results.failed === 0 ? '✅ SECURE' : '❌ VULNERABILITIES FOUND';
    console.log(`\n🔒 Overall Security Status: ${overallStatus}`);

    if (this.results.failed > 0) {
      console.log('\n🚨 CRITICAL: Please address all failed tests before deploying to production!');
    }

    if (this.results.warnings > 0) {
      console.log(`\n⚠️  Please review ${this.results.warnings} warnings for potential improvements.`);
    }

    // Generate detailed JSON report
    const reportPath = './security-test-results.json';
    require('fs').writeFileSync(reportPath, JSON.stringify({
      summary: {
        passed: this.results.passed,
        failed: this.results.failed,
        warnings: this.results.warnings,
        overallStatus: this.results.failed === 0 ? 'SECURE' : 'VULNERABILITIES_FOUND'
      },
      timestamp: new Date().toISOString(),
      baseURL: this.baseURL,
      detailedResults: this.results.tests
    }, null, 2));

    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }
}

// Run tests if called directly
if (require.main === module) {
  const baseURL = process.argv[2] || 'http://localhost:3000';
  const tester = new SecurityTester(baseURL);
  tester.runAllTests().catch(console.error);
}

module.exports = SecurityTester;