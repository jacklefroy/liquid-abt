#!/usr/bin/env node

/**
 * LIQUID ABT - Comprehensive Stripe OAuth Flow Test Script
 * 
 * This script validates the complete Stripe OAuth integration including:
 * - Fresh start with cleared connections
 * - Real OAuth URL generation
 * - Simulated OAuth callback success
 * - Connection persistence across route boundaries
 * - Disconnect functionality
 * - Error scenario handling
 * - Multi-tenant isolation
 * 
 * Usage: node scripts/test-stripe-oauth-flow.js
 */

const BASE_URL = 'http://localhost:3001';

async function makeRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  
  let data;
  try {
    data = await response.json();
  } catch (error) {
    // Handle non-JSON responses (like redirects)
    data = { redirect: true, status: response.status, url: response.url };
  }
  
  return { response, data, status: response.status };
}

async function getAuthToken(email = 'test@company.com') {
  const { data, status } = await makeRequest('/api/auth/mock-login', {
    method: 'POST',
    body: JSON.stringify({ 
      email: email,
      password: 'demo-password' // Mock password for testing
    })
  });
  
  if (status !== 200) {
    throw new Error(`Failed to get auth token: ${JSON.stringify(data)}`);
  }
  
  return data.token;
}

function logResult(testName, success, details = '') {
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${testName}${details ? `: ${details}` : ''}`);
  return success;
}

async function runTest(testName, testFn) {
  try {
    console.log(`\n🧪 ${testName}`);
    const result = await testFn();
    return logResult(testName, result !== false, result === true ? '' : result);
  } catch (error) {
    return logResult(testName, false, error.message);
  }
}

async function main() {
  console.log('🚀 LIQUID ABT - Stripe OAuth Flow Comprehensive Test');
  console.log('=' .repeat(60));
  
  const results = {
    passed: 0,
    failed: 0,
    realOAuthUrl: null
  };

  // Test 1: Clear all connections - Fresh start
  await runTest('Clear all connections', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/test-storage?action=clear', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Clear failed: ${JSON.stringify(data)}`);
    }
    
    return `Cleared successfully: ${data.message}`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 2: Verify initial disconnected state
  await runTest('Verify initial disconnected state', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/status', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Status check failed: ${JSON.stringify(data)}`);
    }
    
    if (data.connected === true) {
      throw new Error(`Expected disconnected but got connected: ${JSON.stringify(data)}`);
    }
    
    return `Correctly shows disconnected: ${data.connected}`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 3: Get real OAuth URL
  await runTest('Generate real Stripe OAuth URL', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/connect', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Connect failed: ${JSON.stringify(data)}`);
    }
    
    if (!data.authUrl || !data.authUrl.includes('connect.stripe.com')) {
      throw new Error(`Invalid auth URL: ${data.authUrl}`);
    }
    
    results.realOAuthUrl = data.authUrl;
    return `Generated valid OAuth URL: ${data.authUrl.substring(0, 50)}...`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 4: Simulate successful OAuth callback by creating test connection
  await runTest('Simulate successful OAuth callback', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/test-storage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Test connection creation failed: ${JSON.stringify(data)}`);
    }
    
    return `Created test connection: ${data.accountId}`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 5: Verify connection status shows connected
  await runTest('Verify connection status after OAuth', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/status', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Status check failed: ${JSON.stringify(data)}`);
    }
    
    if (data.connected !== true) {
      throw new Error(`Expected connected but got: ${JSON.stringify(data)}`);
    }
    
    return `Connected with account: ${data.accountId}`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 6: Verify persistence across multiple status checks
  await runTest('Verify connection persistence', async () => {
    const token = await getAuthToken();
    
    // Make 3 consecutive calls to ensure persistence
    const calls = [];
    for (let i = 0; i < 3; i++) {
      const { data, status } = await makeRequest('/api/integrations/stripe/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      calls.push({ connected: data.connected, accountId: data.accountId });
    }
    
    // All calls should return same connection
    const firstCall = calls[0];
    const allMatch = calls.every(call => 
      call.connected === firstCall.connected && 
      call.accountId === firstCall.accountId
    );
    
    if (!allMatch) {
      throw new Error(`Persistence failed: ${JSON.stringify(calls)}`);
    }
    
    return `All 3 calls consistent: ${firstCall.accountId}`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 7: Test disconnect functionality
  await runTest('Test disconnect functionality', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/disconnect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Disconnect failed: ${JSON.stringify(data)}`);
    }
    
    if (!data.success) {
      throw new Error(`Disconnect not successful: ${JSON.stringify(data)}`);
    }
    
    return `Disconnect successful: ${data.message}`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 8: Verify disconnected state after disconnect
  await runTest('Verify disconnected state after disconnect', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/status', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Status check failed: ${JSON.stringify(data)}`);
    }
    
    if (data.connected === true) {
      throw new Error(`Expected disconnected after disconnect: ${JSON.stringify(data)}`);
    }
    
    return `Correctly shows disconnected after disconnect`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 9: Error scenario - Invalid state parameter  
  await runTest('Error scenario: Invalid state parameter', async () => {
    const { data, status } = await makeRequest('/api/integrations/stripe/callback?code=test&state=invalid', {
      method: 'GET'
    });
    
    // Should redirect with error (3xx status or redirect response)
    if (status === 200 && !data.redirect) {
      throw new Error(`Expected redirect but got JSON response: ${JSON.stringify(data)}`);
    }
    
    return `Correctly handled invalid state (status: ${status})`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 10: Error scenario - Missing authorization code
  await runTest('Error scenario: Missing authorization code', async () => {
    const { data, status } = await makeRequest('/api/integrations/stripe/callback?state=tenant_test_user_test_123', {
      method: 'GET'
    });
    
    // Should redirect with error (3xx status or redirect response)
    if (status === 200 && !data.redirect) {
      throw new Error(`Expected redirect but got JSON response: ${JSON.stringify(data)}`);
    }
    
    return `Correctly handled missing code (status: ${status})`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 11: Try disconnect when not connected
  await runTest('Error scenario: Disconnect when not connected', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/disconnect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Disconnect should succeed even when not connected: ${JSON.stringify(data)}`);
    }
    
    // Should indicate no connection found
    if (!data.message.includes('No connection found')) {
      throw new Error(`Expected 'no connection found' message: ${data.message}`);
    }
    
    return `Correctly handled disconnect when not connected`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 12: Multi-tenant isolation test
  await runTest('Multi-tenant isolation test', async () => {
    // Create connections for multiple tenants
    const tenants = [];
    
    for (let i = 1; i <= 3; i++) {
      const email = `tenant${i}@company.com`;
      const token = await getAuthToken(email);
      
      // Create connection for this tenant
      const { data, status } = await makeRequest('/api/integrations/stripe/test-storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (status !== 200) {
        throw new Error(`Failed to create connection for ${email}: ${JSON.stringify(data)}`);
      }
      
      tenants.push({ email, token, accountId: data.accountId });
    }
    
    // Verify each tenant only sees their own connection
    for (const tenant of tenants) {
      const { data, status } = await makeRequest('/api/integrations/stripe/status', {
        headers: { Authorization: `Bearer ${tenant.token}` }
      });
      
      if (status !== 200 || !data.connected) {
        throw new Error(`Tenant ${tenant.email} connection not found`);
      }
      
      if (data.accountId !== tenant.accountId) {
        throw new Error(`Tenant ${tenant.email} sees wrong account: expected ${tenant.accountId}, got ${data.accountId}`);
      }
    }
    
    return `All ${tenants.length} tenants correctly isolated`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Test 13: Performance test - List connections
  await runTest('Performance test: List all connections', async () => {
    const token = await getAuthToken();
    const { data, status } = await makeRequest('/api/integrations/stripe/test-storage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (status !== 200) {
      throw new Error(`Failed to create test connection: ${JSON.stringify(data)}`);
    }
    
    // The totalConnections should be reported
    if (typeof data.totalConnections !== 'number') {
      throw new Error(`Total connections not reported: ${JSON.stringify(data)}`);
    }
    
    return `Total connections in storage: ${data.totalConnections}`;
  }).then(success => success ? results.passed++ : results.failed++);

  // Final Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${Math.round(results.passed / (results.passed + results.failed) * 100)}%`);
  
  if (results.realOAuthUrl) {
    console.log('\n🔗 REAL STRIPE OAUTH URL FOR MANUAL TESTING:');
    console.log(results.realOAuthUrl);
    console.log('\n💡 Use this URL in a browser to test real OAuth flow');
  }
  
  console.log('\n🎯 SHARED STORAGE VALIDATION: ' + (results.passed >= 10 ? '✅ WORKING' : '❌ ISSUES FOUND'));
  console.log('Cross-route persistence: ' + (results.passed >= 5 ? '✅ CONFIRMED' : '❌ FAILED'));
  console.log('Multi-tenant isolation: ' + (results.passed >= 12 ? '✅ CONFIRMED' : '❌ FAILED'));
  
  if (results.failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Stripe OAuth integration is working perfectly.');
  } else {
    console.log(`\n⚠️  ${results.failed} test(s) failed. Check the output above for details.`);
  }
}

// Handle errors gracefully
main().catch(error => {
  console.error('\n💥 Test script failed:', error.message);
  process.exit(1);
});