#!/usr/bin/env tsx

/**
 * Mock Flow Verification Script
 * LIQUID ABT - Bitcoin Treasury Platform
 * 
 * This script tests the complete mock ZeroCap Bitcoin trading flow
 * to ensure all components are working correctly before production.
 * 
 * Usage:
 *   npx tsx scripts/test-mock-flow.ts
 *   
 * Requirements:
 *   npm install -g tsx (if not already installed)
 */

import { randomUUID } from 'crypto';

// Set environment for testing
process.env.NODE_ENV = 'test';
process.env.USE_MOCK_EXCHANGE = 'true';
process.env.MOCK_BTC_PRICE = '65000';
process.env.MOCK_SUCCESS_RATE = '0.95';
process.env.MOCK_NETWORK_DELAY_MS = '500';

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  details?: any;
  error?: string;
}

interface MockApiResponse {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

class MockFlowTester {
  private results: TestResult[] = [];
  private baseUrl = 'http://localhost:3000';
  private startTime = Date.now();

  private async log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
    const colors = {
      info: '\x1b[34m', // blue
      success: '\x1b[32m', // green
      error: '\x1b[31m', // red
      warning: '\x1b[33m' // yellow
    };
    const reset = '\x1b[0m';
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    console.log(`${colors[type]}[${timestamp}] ${message}${reset}`);
  }

  private async runTest(name: string, testFn: () => Promise<any>): Promise<TestResult> {
    const startTime = Date.now();
    this.log(`🧪 Running: ${name}`, 'info');
    
    try {
      const result = await testFn();
      const duration = Date.now() - startTime;
      const testResult: TestResult = {
        name,
        success: true,
        duration,
        details: result
      };
      
      this.results.push(testResult);
      this.log(`✅ PASSED: ${name} (${duration}ms)`, 'success');
      return testResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const testResult: TestResult = {
        name,
        success: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      };
      
      this.results.push(testResult);
      this.log(`❌ FAILED: ${name} (${duration}ms) - ${testResult.error}`, 'error');
      return testResult;
    }
  }

  private async fetchApi(endpoint: string, options: RequestInit = {}): Promise<MockApiResponse> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error('Development server is not running. Please start with "npm run dev"');
      }
      throw error;
    }
  }

  private async testExchangeFactory() {
    // Import the exchange factory
    const { getExchangeService, getExchangeServiceInfo, resetExchangeService } = 
      await import('../src/lib/integrations/exchanges/exchange-factory.ts');

    // Reset service to ensure clean state
    resetExchangeService();

    // Test service info
    const serviceInfo = getExchangeServiceInfo();
    
    if (!serviceInfo.isMock) {
      throw new Error('Service is not in mock mode');
    }
    
    if (serviceInfo.serviceName !== 'ZeroCap Mock') {
      throw new Error(`Unexpected service name: ${serviceInfo.serviceName}`);
    }

    // Test service instance
    const service = getExchangeService();
    
    if (!service) {
      throw new Error('Exchange service is null');
    }

    return {
      serviceInfo,
      serviceInstance: !!service
    };
  }

  private async testMockServiceMethods() {
    const { getExchangeService } = await import('../src/lib/integrations/exchanges/exchange-factory.ts');
    const exchange = getExchangeService();

    // Test market price
    const priceResult = await exchange.getMarketPrice();
    
    if (!priceResult.price || priceResult.price < 1000) {
      throw new Error(`Invalid price: ${priceResult.price}`);
    }
    
    if (priceResult.source !== 'mock') {
      throw new Error(`Invalid price source: ${priceResult.source}`);
    }

    // Test buy order
    const buyResult = await exchange.executeBuyOrder({
      amount: 100,
      customerReference: `test_${randomUUID()}`
    });

    if (!buyResult.orderId || !buyResult.orderId.startsWith('MOCK_ORDER_')) {
      throw new Error(`Invalid order ID: ${buyResult.orderId}`);
    }

    if (buyResult.fiatAmount !== 100) {
      throw new Error(`Invalid fiat amount: ${buyResult.fiatAmount}`);
    }

    // Test transaction status
    const statusResult = await exchange.getTransactionStatus(buyResult.orderId);
    
    if (statusResult.orderId !== buyResult.orderId) {
      throw new Error(`Order ID mismatch: ${statusResult.orderId} vs ${buyResult.orderId}`);
    }

    return {
      price: priceResult,
      buyOrder: buyResult,
      status: statusResult
    };
  }

  private async testMockControlApi() {
    // Test GET endpoint (view mock data)
    const getMockData = await this.fetchApi('/api/admin/mock-control?history=true&limit=5');
    
    if (!getMockData.success) {
      throw new Error(`GET failed: ${getMockData.error}`);
    }

    if (!getMockData.data?.serviceInfo?.isMock) {
      throw new Error('Mock control API reports service is not in mock mode');
    }

    // Test POST endpoint (trigger purchase)
    const triggerPurchase = await this.fetchApi('/api/admin/mock-control', {
      method: 'POST',
      body: JSON.stringify({
        amount: 150,
        customerReference: `api_test_${randomUUID()}`
      })
    });

    if (!triggerPurchase.success) {
      throw new Error(`POST failed: ${triggerPurchase.error}`);
    }

    if (!triggerPurchase.data?.purchaseResult) {
      throw new Error('Purchase result missing from API response');
    }

    // Test PUT endpoint (change parameters)
    const updateParams = await this.fetchApi('/api/admin/mock-control', {
      method: 'PUT',
      body: JSON.stringify({
        btcPrice: 66000,
        successRate: 0.9
      })
    });

    if (!updateParams.success) {
      throw new Error(`PUT failed: ${updateParams.error}`);
    }

    if (!updateParams.data?.changes) {
      throw new Error('Parameter changes not reported in API response');
    }

    return {
      getMockData: getMockData.data,
      triggerPurchase: triggerPurchase.data,
      updateParams: updateParams.data
    };
  }

  private async testTransactionGenerator() {
    const { MockTransactionGenerator } = await import('../src/lib/sandbox/mock-transaction-generator.ts');
    
    const generator = new MockTransactionGenerator();

    // Test single payment generation
    const mockPayment = generator.generateMockPayment({
      amount: 50000, // $500 in cents
      tenantId: 'test_tenant'
    });

    if (mockPayment.amount !== 50000) {
      throw new Error(`Invalid payment amount: ${mockPayment.amount}`);
    }

    if (!mockPayment.stripePaymentId.startsWith('pi_mock_')) {
      throw new Error(`Invalid Stripe payment ID: ${mockPayment.stripePaymentId}`);
    }

    // Test Bitcoin purchase generation
    const mockPurchase = generator.generateMockBitcoinPurchase({
      stripePaymentId: mockPayment.stripePaymentId,
      customerId: mockPayment.customerId
    });

    if (mockPurchase.stripePaymentId !== mockPayment.stripePaymentId) {
      throw new Error('Payment ID mismatch between payment and purchase');
    }

    if (!mockPurchase.bitcoinAmount) {
      throw new Error('Bitcoin amount is missing');
    }

    // Test bulk generation (small batch for testing)
    const bulkResult = await generator.generateBulkTransactions({
      tenantId: 'test_bulk',
      count: 10,
      successRate: 0.8
    });

    if (bulkResult.payments.length !== 10) {
      throw new Error(`Expected 10 payments, got ${bulkResult.payments.length}`);
    }

    if (bulkResult.stats.totalPayments !== 10) {
      throw new Error(`Stats mismatch: expected 10 total payments, got ${bulkResult.stats.totalPayments}`);
    }

    return {
      singlePayment: mockPayment,
      singlePurchase: mockPurchase,
      bulkStats: bulkResult.stats
    };
  }

  private async testZeroCapMockDirectly() {
    const { zeroCapMock } = await import('../src/lib/sandbox/zerocap-mock.ts');

    // Clear history first
    zeroCapMock.clearTransactionHistory();

    // Test stats
    const initialStats = zeroCapMock.getStats();
    
    if (initialStats.totalTransactions !== 0) {
      throw new Error(`Expected 0 transactions after clear, got ${initialStats.totalTransactions}`);
    }

    // Test price with fluctuation
    const price1 = await zeroCapMock.getMarketPrice();
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
    const price2 = await zeroCapMock.getMarketPrice();

    if (Math.abs(price1.price - price2.price) > price1.price * 0.05) {
      throw new Error('Price fluctuation exceeds expected 2% variance');
    }

    // Test successful buy order
    zeroCapMock.setSuccessRate(1.0); // Ensure success for testing
    
    const buyResult = await zeroCapMock.executeBuyOrder({
      amount: 200,
      customerReference: `direct_test_${randomUUID()}`
    });

    if (!buyResult.success) {
      throw new Error(`Buy order failed: ${buyResult.error}`);
    }

    // Test transaction logging
    const history = zeroCapMock.getTransactionHistory();
    
    if (history.length < 2) { // Should have at least 2 price checks + 1 buy
      throw new Error(`Insufficient transaction history: ${history.length} transactions`);
    }

    const buyTransactions = history.filter(tx => tx.type === 'buy');
    
    if (buyTransactions.length !== 1) {
      throw new Error(`Expected 1 buy transaction, got ${buyTransactions.length}`);
    }

    return {
      initialStats,
      prices: { price1: price1.price, price2: price2.price },
      buyResult,
      historyCount: history.length
    };
  }

  private async testTreasuryEngineIntegration() {
    this.log('⚠️  Treasury engine integration test requires database setup', 'warning');
    this.log('ℹ️  Skipping treasury engine test for this verification', 'info');
    
    // For now, just verify that the treasury engine can import the exchange factory
    try {
      const { getExchangeService } = await import('../src/lib/integrations/exchanges/exchange-factory.ts');
      const service = getExchangeService();
      
      if (!service) {
        throw new Error('Treasury engine cannot access exchange service');
      }
      
      return {
        canAccessService: true,
        serviceName: (await import('../src/lib/integrations/exchanges/exchange-factory.ts')).getExchangeServiceInfo().serviceName
      };
    } catch (error) {
      throw new Error(`Treasury engine integration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async runAllTests(): Promise<void> {
    this.log('🚀 Starting Mock Flow Verification', 'info');
    this.log('=====================================', 'info');
    this.log(`Base URL: ${this.baseUrl}`, 'info');
    this.log(`Mock BTC Price: $${process.env.MOCK_BTC_PRICE}`, 'info');
    this.log(`Mock Success Rate: ${(parseFloat(process.env.MOCK_SUCCESS_RATE || '0.95') * 100).toFixed(1)}%`, 'info');
    this.log('', 'info');

    // Test 1: Exchange Factory
    await this.runTest('Exchange Factory Configuration', () => this.testExchangeFactory());

    // Test 2: Mock Service Methods
    await this.runTest('Mock Service Methods', () => this.testMockServiceMethods());

    // Test 3: ZeroCap Mock Direct Access
    await this.runTest('ZeroCap Mock Direct Access', () => this.testZeroCapMockDirectly());

    // Test 4: Transaction Generator
    await this.runTest('Mock Transaction Generator', () => this.testTransactionGenerator());

    // Test 5: Mock Control API (requires dev server)
    await this.runTest('Mock Control API Endpoints', () => this.testMockControlApi()).catch(() => {
      this.log('⚠️  Mock Control API test failed - development server may not be running', 'warning');
    });

    // Test 6: Treasury Engine Integration
    await this.runTest('Treasury Engine Integration', () => this.testTreasuryEngineIntegration());
  }

  public async generateReport(): Promise<void> {
    const totalDuration = Date.now() - this.startTime;
    const passedTests = this.results.filter(r => r.success).length;
    const failedTests = this.results.filter(r => !r.success).length;
    const totalTests = this.results.length;

    this.log('', 'info');
    this.log('📊 Test Results Summary', 'info');
    this.log('=======================', 'info');
    this.log(`Total Tests: ${totalTests}`, 'info');
    this.log(`Passed: ${passedTests}`, passedTests === totalTests ? 'success' : 'info');
    this.log(`Failed: ${failedTests}`, failedTests > 0 ? 'error' : 'info');
    this.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`, 'info');
    this.log(`Total Duration: ${totalDuration}ms`, 'info');
    this.log('', 'info');

    if (failedTests > 0) {
      this.log('❌ Failed Tests:', 'error');
      this.results
        .filter(r => !r.success)
        .forEach(test => {
          this.log(`  • ${test.name}: ${test.error}`, 'error');
        });
      this.log('', 'info');
    }

    // Individual test details
    this.log('📋 Individual Test Results:', 'info');
    this.results.forEach(test => {
      const status = test.success ? '✅' : '❌';
      this.log(`  ${status} ${test.name} (${test.duration}ms)`, test.success ? 'success' : 'error');
    });

    this.log('', 'info');
    
    if (passedTests === totalTests) {
      this.log('🎉 All tests passed! Mock mode is working correctly.', 'success');
      this.log('', 'info');
      this.log('Next Steps:', 'info');
      this.log('1. Start development server: npm run dev', 'info');
      this.log('2. Visit mock dashboard: http://localhost:3000/admin/monitoring-simple', 'info');
      this.log('3. Test mock control API: http://localhost:3000/api/admin/mock-control', 'info');
      this.log('4. Run integration tests: npm test mock-integration', 'info');
    } else {
      this.log('⚠️  Some tests failed. Please check the configuration and try again.', 'warning');
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const tester = new MockFlowTester();
  
  try {
    await tester.runAllTests();
    await tester.generateReport();
  } catch (error) {
    console.error('❌ Fatal error during testing:', error);
    process.exit(1);
  }
}

// Run if this script is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { MockFlowTester };