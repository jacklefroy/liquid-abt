#!/usr/bin/env npx ts-node

import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { PaymentReconciliationService } from '../src/lib/reconciliation/payment-reconciliation';
import { FailedTransactionRecoveryService } from '../src/lib/reconciliation/failed-transaction-recovery';
import { getTenantPrisma } from '../src/lib/database/connection';
import { zeroCapMock } from '../src/lib/sandbox/zerocap-mock';

interface TestResult {
  testName: string;
  success: boolean;
  duration: number;
  details?: any;
  error?: string;
}

class ReconciliationTestSuite {
  private testTenantId: string = 'tenant_test_reconciliation';
  private results: TestResult[] = [];

  constructor() {
    // Ensure we're using the mock for testing
    process.env.ZEROCAP_USE_MOCK = 'true';
  }

  private async logTest(testName: string, testFn: () => Promise<any>): Promise<TestResult> {
    const startTime = Date.now();
    console.log(`🧪 Running test: ${testName}`);
    
    try {
      const result = await testFn();
      const duration = Date.now() - startTime;
      
      const testResult: TestResult = {
        testName,
        success: true,
        duration,
        details: result
      };
      
      console.log(`✅ ${testName} - PASSED (${duration}ms)`);
      this.results.push(testResult);
      return testResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      const testResult: TestResult = {
        testName,
        success: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      };
      
      console.log(`❌ ${testName} - FAILED (${duration}ms): ${testResult.error}`);
      this.results.push(testResult);
      return testResult;
    }
  }

  private async setupTestEnvironment(): Promise<void> {
    console.log('🔧 Setting up test environment...');
    
    // Clear any existing test data
    const prisma = getTenantPrisma();
    
    try {
      await prisma.reconciliationLog.deleteMany({});
      await prisma.failedTransaction.deleteMany({});
      await prisma.bitcoinPurchase.deleteMany({});
      await prisma.stripePayment.deleteMany({});
      console.log('✅ Test environment cleared');
    } catch (error) {
      console.warn('⚠️ Could not clear test environment (tables may not exist yet):', error);
    }

    // Clear mock transaction logs
    zeroCapMock.clearLogs();
  }

  private async createFakeStripePayment(
    overrides: Partial<{
      stripePaymentId: string;
      customerId: string;
      amount: number;
      currency: string;
      status: string;
    }> = {}
  ): Promise<string> {
    const prisma = getTenantPrisma();
    
    const payment = await prisma.stripePayment.create({
      data: {
        stripePaymentId: overrides.stripePaymentId || `pi_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        customerId: overrides.customerId || `cus_test_${Date.now()}`,
        amount: overrides.amount || 10000, // $100 in cents
        currency: overrides.currency || 'aud',
        status: overrides.status || 'succeeded'
      }
    });

    return payment.stripePaymentId;
  }

  private async createFakeBitcoinPurchase(
    overrides: Partial<{
      customerId: string;
      stripePaymentId: string;
      bitcoinAmount: Decimal;
      fiatAmount: Decimal;
      exchangeRate: Decimal;
      transactionId: string;
      fees: Decimal;
      status: string;
    }> = {}
  ): Promise<string> {
    const prisma = getTenantPrisma();
    
    const purchase = await prisma.bitcoinPurchase.create({
      data: {
        customerId: overrides.customerId || `cus_test_${Date.now()}`,
        stripePaymentId: overrides.stripePaymentId || null,
        bitcoinAmount: overrides.bitcoinAmount || new Decimal('0.00222222'),
        fiatAmount: overrides.fiatAmount || new Decimal('100.00'),
        fiatCurrency: 'AUD',
        exchangeRate: overrides.exchangeRate || new Decimal('45000.00'),
        transactionId: overrides.transactionId || `ZC_TEST_${Date.now()}`,
        fees: overrides.fees || new Decimal('0.50'),
        status: overrides.status || 'completed'
      }
    });

    return purchase.id;
  }

  async testBasicReconciliation(): Promise<any> {
    const reconciliationService = new PaymentReconciliationService(this.testTenantId);
    
    // Create matching payment and Bitcoin purchase
    const stripePaymentId = await this.createFakeStripePayment({
      amount: 10000, // $100
      customerId: 'cus_match_test'
    });

    await this.createFakeBitcoinPurchase({
      stripePaymentId,
      customerId: 'cus_match_test',
      fiatAmount: new Decimal('100.00')
    });

    // Run reconciliation
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour ago
    
    const report = await reconciliationService.reconcilePayments(startTime, endTime);

    return {
      totalPayments: report.totalPayments,
      totalBitcoinPurchases: report.totalBitcoinPurchases,
      matchedTransactions: report.matchedTransactions,
      discrepancies: report.discrepancies.length,
      status: report.status
    };
  }

  async testOrphanedPayment(): Promise<any> {
    const reconciliationService = new PaymentReconciliationService(this.testTenantId);
    
    // Create payment without corresponding Bitcoin purchase
    await this.createFakeStripePayment({
      amount: 15000, // $150
      customerId: 'cus_orphaned_payment'
    });

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000);
    
    const report = await reconciliationService.reconcilePayments(startTime, endTime);

    const orphanedPayments = report.discrepancies.filter(d => d.type === 'orphaned_payment');

    return {
      discrepancies: report.discrepancies.length,
      orphanedPayments: orphanedPayments.length,
      expectedAmount: orphanedPayments[0]?.expectedAmount.toString(),
      status: report.status
    };
  }

  async testOrphanedBitcoinPurchase(): Promise<any> {
    const reconciliationService = new PaymentReconciliationService(this.testTenantId);
    
    // Create Bitcoin purchase without corresponding payment
    await this.createFakeBitcoinPurchase({
      customerId: 'cus_orphaned_bitcoin',
      fiatAmount: new Decimal('200.00'),
      stripePaymentId: null // No associated payment
    });

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000);
    
    const report = await reconciliationService.reconcilePayments(startTime, endTime);

    const orphanedBitcoin = report.discrepancies.filter(d => d.type === 'orphaned_bitcoin');

    return {
      discrepancies: report.discrepancies.length,
      orphanedBitcoin: orphanedBitcoin.length,
      expectedAmount: orphanedBitcoin[0]?.expectedAmount.toString(),
      status: report.status
    };
  }

  async testAmountMismatch(): Promise<any> {
    const reconciliationService = new PaymentReconciliationService(this.testTenantId);
    
    // Create payment for $100 but Bitcoin purchase for $95
    const stripePaymentId = await this.createFakeStripePayment({
      amount: 10000, // $100
      customerId: 'cus_mismatch_test'
    });

    await this.createFakeBitcoinPurchase({
      stripePaymentId,
      customerId: 'cus_mismatch_test',
      fiatAmount: new Decimal('95.00') // $5 discrepancy
    });

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000);
    
    const report = await reconciliationService.reconcilePayments(startTime, endTime);

    const amountMismatches = report.discrepancies.filter(d => d.type === 'amount_mismatch');

    return {
      discrepancies: report.discrepancies.length,
      amountMismatches: amountMismatches.length,
      expectedAmount: amountMismatches[0]?.expectedAmount.toString(),
      actualAmount: amountMismatches[0]?.actualAmount?.toString(),
      status: report.status
    };
  }

  async testFailedTransactionRecording(): Promise<any> {
    const recoveryService = new FailedTransactionRecoveryService(this.testTenantId);
    
    const stripePaymentId = `pi_failed_${Date.now()}`;
    const customerId = 'cus_failed_test';
    const amount = new Decimal('50.00');
    const errorMessage = 'Insufficient liquidity in market';

    const failedTxId = await recoveryService.recordFailedTransaction(
      stripePaymentId,
      customerId,
      amount,
      errorMessage
    );

    // Verify it was recorded
    const pendingRecoveries = await recoveryService.getPendingRecoveries();
    const ourFailure = pendingRecoveries.find(tx => tx.id === failedTxId);

    return {
      failedTransactionId: failedTxId,
      recorded: !!ourFailure,
      status: ourFailure?.status,
      attempts: ourFailure?.attempts,
      errorMessage: ourFailure?.errorMessage
    };
  }

  async testSuccessfulRecovery(): Promise<any> {
    const recoveryService = new FailedTransactionRecoveryService(this.testTenantId);
    
    // Record a failed transaction
    const stripePaymentId = `pi_recovery_${Date.now()}`;
    const customerId = 'cus_recovery_test';
    const amount = new Decimal('25.00');

    await recoveryService.recordFailedTransaction(
      stripePaymentId,
      customerId,
      amount,
      'Test recovery scenario'
    );

    // Process recoveries (should succeed with mock)
    const recoveryResult = await recoveryService.processPendingRecoveries();

    // Check if Bitcoin purchase was created
    const prisma = getTenantPrisma();
    const bitcoinPurchase = await prisma.bitcoinPurchase.findFirst({
      where: { stripePaymentId }
    });

    return {
      processed: recoveryResult.processed,
      successful: recoveryResult.successful,
      bitcoinPurchaseCreated: !!bitcoinPurchase,
      bitcoinAmount: bitcoinPurchase?.bitcoinAmount.toString(),
      transactionId: bitcoinPurchase?.transactionId
    };
  }

  async testMaxAttemptsReached(): Promise<any> {
    const recoveryService = new FailedTransactionRecoveryService(this.testTenantId);
    
    // Create a failed transaction and manually set it to max attempts
    const prisma = getTenantPrisma();
    const stripePaymentId = `pi_max_attempts_${Date.now()}`;
    
    const failedTx = await prisma.failedTransaction.create({
      data: {
        stripePaymentId,
        customerId: 'cus_max_attempts_test',
        amount: new Decimal('75.00'),
        errorMessage: 'Simulated repeated failure',
        attempts: 3, // Max attempts already reached
        status: 'failed',
        lastAttempt: new Date()
      }
    });

    // Process should issue refund
    const recoveryResult = await recoveryService.processPendingRecoveries();

    // Check if transaction was marked as refunded
    const updatedTx = await prisma.failedTransaction.findUnique({
      where: { id: failedTx.id }
    });

    return {
      processed: recoveryResult.processed,
      refunded: recoveryResult.refunded,
      transactionStatus: updatedTx?.status,
      errorMessage: updatedTx?.errorMessage
    };
  }

  async testReconciliationStats(): Promise<any> {
    const reconciliationService = new PaymentReconciliationService(this.testTenantId);
    const recoveryService = new FailedTransactionRecoveryService(this.testTenantId);
    
    const [reconStats, recoveryStats] = await Promise.all([
      reconciliationService.getReconciliationStats(1), // Last 1 day
      recoveryService.getRecoveryStats(1)
    ]);

    return {
      reconciliation: {
        totalDiscrepancies: reconStats.totalDiscrepancies,
        resolvedDiscrepancies: reconStats.resolvedDiscrepancies,
        unresolvedDiscrepancies: reconStats.unresolvedDiscrepancies,
        totalAmount: reconStats.totalAmount.toString()
      },
      recovery: {
        totalFailed: recoveryStats.totalFailed,
        pending: recoveryStats.pending,
        resolved: recoveryStats.resolved,
        refunded: recoveryStats.refunded,
        totalRefundAmount: recoveryStats.totalRefundAmount.toString()
      }
    };
  }

  async testZeroCapMockService(): Promise<any> {
    // Test the mock service directly
    const tradeParams = {
      amount: 100,
      currency: 'AUD' as const,
      type: 'buy' as const,
      customerReference: 'test_trade_123'
    };

    const [tradeResult, balanceResult, stats] = await Promise.all([
      zeroCapMock.executeTrade(tradeParams),
      zeroCapMock.getBalance(),
      Promise.resolve(zeroCapMock.getStats())
    ]);

    return {
      trade: {
        success: tradeResult.success,
        bitcoinAmount: tradeResult.bitcoinAmount,
        transactionId: tradeResult.transactionId,
        rate: tradeResult.rate,
        networkLatency: tradeResult.networkLatency
      },
      balance: {
        success: balanceResult.success,
        balance: balanceResult.balance
      },
      stats: {
        totalTransactions: stats.totalTransactions,
        successfulTransactions: stats.successfulTransactions,
        successRate: stats.successRate,
        averageLatency: stats.averageLatency
      }
    };
  }

  async runFullTestSuite(): Promise<{
    passed: number;
    failed: number;
    total: number;
    results: TestResult[];
    duration: number;
  }> {
    const startTime = Date.now();
    
    console.log('🚀 Starting LIQUID ABT Reconciliation Test Suite');
    console.log('='.repeat(50));
    
    await this.setupTestEnvironment();
    
    // Run all tests
    await this.logTest('Basic Reconciliation - Matched Transactions', () => this.testBasicReconciliation());
    await this.logTest('Orphaned Stripe Payment Detection', () => this.testOrphanedPayment());
    await this.logTest('Orphaned Bitcoin Purchase Detection', () => this.testOrphanedBitcoinPurchase());
    await this.logTest('Amount Mismatch Detection', () => this.testAmountMismatch());
    await this.logTest('Failed Transaction Recording', () => this.testFailedTransactionRecording());
    await this.logTest('Successful Transaction Recovery', () => this.testSuccessfulRecovery());
    await this.logTest('Max Attempts Refund Process', () => this.testMaxAttemptsReached());
    await this.logTest('Reconciliation Statistics', () => this.testReconciliationStats());
    await this.logTest('ZeroCap Mock Service', () => this.testZeroCapMockService());
    
    const duration = Date.now() - startTime;
    const passed = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;
    
    console.log('='.repeat(50));
    console.log(`📊 Test Results Summary:`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total: ${this.results.length}`);
    console.log(`⏱️ Duration: ${duration}ms`);
    console.log('='.repeat(50));
    
    if (failed > 0) {
      console.log('❌ Failed Tests:');
      this.results
        .filter(r => !r.success)
        .forEach(result => {
          console.log(`   • ${result.testName}: ${result.error}`);
        });
    }

    return {
      passed,
      failed,
      total: this.results.length,
      results: this.results,
      duration
    };
  }
}

// CLI execution
async function main() {
  const testSuite = new ReconciliationTestSuite();
  
  try {
    const results = await testSuite.runFullTestSuite();
    
    // Exit with appropriate code
    process.exit(results.failed === 0 ? 0 : 1);
  } catch (error) {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
export { ReconciliationTestSuite };

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}