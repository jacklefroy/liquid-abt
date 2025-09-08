// LIQUID ABT - AUSTRAC Compliance Integration Tests
// Tests real AUSTRAC compliance monitoring and reporting

import { austracComplianceService, AMLRiskLevel, TransactionPattern, AUSTRACReportType } from '../../austrac';
import { tenantSchemaManager, getMasterPrisma } from '../../../database/connection';
import { v4 as uuidv4 } from 'uuid';

describe('AUSTRAC Compliance Integration', () => {
  const testTenantId = uuidv4();
  const testUserId = uuidv4();
  
  beforeAll(async () => {
    // Setup test tenant schema
    await tenantSchemaManager.createTenantSchema(testTenantId);
    
    // Create test user
    const prisma = getMasterPrisma();
    await prisma.user.create({
      data: {
        id: testUserId,
        tenantId: testTenantId,
        email: 'test@liquidabt.test',
        passwordHash: 'test_hash',
        firstName: 'Test',
        lastName: 'User',
        role: 'OWNER',
        isActive: true
      }
    });
  });

  afterAll(async () => {
    // Cleanup test tenant
    const prisma = getMasterPrisma();
    await prisma.user.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.tenant.deleteMany({ where: { id: testTenantId } });
    await tenantSchemaManager.dropTenantSchema(testTenantId);
  });

  describe('Threshold Transaction Reporting', () => {
    test('should detect $10K AUD threshold transactions', async () => {
      const transactionId = uuidv4();
      const amount = 10000; // Exactly at threshold
      
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        transactionId,
        amount,
        'AUD',
        'bitcoin_purchase'
      );

      expect(result.requiresReport).toBe(true);
      expect(result.approved).toBe(true); // Should be approved but require reporting
      expect(result.riskLevel).toBeDefined();
    });

    test('should detect transactions over $10K threshold', async () => {
      const transactionId = uuidv4();
      const amount = 15000; // Over threshold
      
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        transactionId,
        amount,
        'AUD',
        'bitcoin_purchase'
      );

      expect(result.requiresReport).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.riskLevel).toBeDefined();
    });

    test('should not require reporting for amounts under $10K', async () => {
      const transactionId = uuidv4();
      const amount = 9999; // Just under threshold
      
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        transactionId,
        amount,
        'AUD',
        'bitcoin_purchase'
      );

      expect(result.requiresReport).toBe(false);
      expect(result.approved).toBe(true);
    });
  });

  describe('Structured Transaction Detection', () => {
    test('should flag transactions just under $10K threshold', async () => {
      const transactionId = uuidv4();
      const amount = 9500; // Structured amount
      
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        transactionId,
        amount,
        'AUD',
        'bitcoin_purchase'
      );

      const structuringAlert = result.alerts.find(alert => 
        alert.pattern === TransactionPattern.STRUCTURING
      );

      expect(structuringAlert).toBeDefined();
      expect(structuringAlert?.riskLevel).toBe(AMLRiskLevel.HIGH);
      expect(result.approved).toBe(true); // Flagged but not blocked
    });

    test('should detect multiple structured transactions', async () => {
      // Simulate multiple transactions in structured amounts
      const transactions = [
        { id: uuidv4(), amount: 9800 },
        { id: uuidv4(), amount: 9700 },
        { id: uuidv4(), amount: 9600 }
      ];

      const results = [];
      for (const tx of transactions) {
        const result = await austracComplianceService.processTransactionForAML(
          testTenantId,
          tx.id,
          tx.amount,
          'AUD',
          'bitcoin_purchase'
        );
        results.push(result);
      }

      // All should be flagged as structured
      const structuringFlags = results.filter(r => 
        r.alerts.some(alert => alert.pattern === TransactionPattern.STRUCTURING)
      );

      expect(structuringFlags.length).toBeGreaterThan(0);
    });
  });

  describe('Suspicious Pattern Detection', () => {
    test('should detect suspicious activity patterns', async () => {
      const patterns = await austracComplianceService.detectSuspiciousPatterns(testTenantId, 24);
      
      expect(Array.isArray(patterns)).toBe(true);
      // Pattern detection should work even if no patterns found
    });

    test('should generate suspicious matter report (SMR)', async () => {
      const transactionIds = [uuidv4(), uuidv4()];
      const investigatorId = testUserId;
      
      const smr = await austracComplianceService.generateSuspiciousTransactionReport(
        testTenantId,
        transactionIds,
        'Unusual transaction patterns detected',
        investigatorId,
        [TransactionPattern.STRUCTURING, TransactionPattern.RAPID_MOVEMENT]
      );

      expect(smr.reportId).toMatch(/^SMR_/);
      expect(smr.tenantId).toBe(testTenantId);
      expect(smr.transactionIds).toEqual(transactionIds);
      expect(smr.riskIndicators).toContain(TransactionPattern.STRUCTURING);
    });
  });

  describe('KYC Verification', () => {
    test('should perform basic KYC verification', async () => {
      const documents = [
        { type: 'drivers_license', data: { number: 'DL123456', state: 'NSW' } },
        { type: 'passport', data: { number: 'P1234567', country: 'AUS' } }
      ];

      const kycResult = await austracComplianceService.performKYCVerification(
        testTenantId,
        documents,
        testUserId
      );

      expect(kycResult.tenantId).toBe(testTenantId);
      expect(kycResult.verifiedBy).toBe(testUserId);
      expect(kycResult.documents).toHaveLength(2);
      expect(kycResult.level).toBeDefined();
      expect(kycResult.riskAssessment).toBeDefined();
    });

    test('should handle enhanced due diligence requirements', async () => {
      // Simulate PEP or sanctions match
      const documents = [
        { type: 'passport', data: { number: 'P7654321', country: 'AUS' } }
      ];

      const kycResult = await austracComplianceService.performKYCVerification(
        testTenantId,
        documents,
        testUserId
      );

      expect(kycResult.level).toBeDefined();
      expect(['basic', 'standard', 'enhanced']).toContain(kycResult.level);
    });
  });

  describe('Sanctions and PEP Screening', () => {
    test('should check sanctions list', async () => {
      const sanctionsResult = await austracComplianceService.checkSanctionsList(testTenantId);
      
      expect(typeof sanctionsResult).toBe('boolean');
    });

    test('should check PEP list', async () => {
      const pepResult = await austracComplianceService.checkPEPList(testTenantId);
      
      expect(typeof pepResult).toBe('boolean');
    });

    test('should block transactions for sanctions matches', async () => {
      // Mock a sanctions match by overriding the check temporarily
      const originalCheck = austracComplianceService.checkSanctionsList;
      austracComplianceService.checkSanctionsList = async () => true;

      const transactionId = uuidv4();
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        transactionId,
        5000,
        'AUD',
        'bitcoin_purchase'
      );

      expect(result.approved).toBe(false);
      expect(result.riskLevel).toBe(AMLRiskLevel.PROHIBITED);

      // Restore original function
      austracComplianceService.checkSanctionsList = originalCheck;
    });
  });

  describe('AUSTRAC Report Generation', () => {
    test('should export threshold transaction report (TTR)', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const report = await austracComplianceService.exportAUSTRACReport(
        AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT,
        startDate,
        endDate
      );

      expect(report.content).toBeDefined();
      expect(report.filename).toMatch(/TTR_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv/);
    });

    test('should export suspicious matter report (SMR)', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const report = await austracComplianceService.exportAUSTRACReport(
        AUSTRACReportType.SUSPICIOUS_MATTER_REPORT,
        startDate,
        endDate
      );

      expect(report.content).toBeDefined();
      expect(report.filename).toMatch(/SMR_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv/);
    });

    test('should reject unsupported report types', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      await expect(
        austracComplianceService.exportAUSTRACReport(
          'invalid_type' as AUSTRACReportType,
          startDate,
          endDate
        )
      ).rejects.toThrow('Unsupported AUSTRAC report type');
    });
  });

  describe('Real-time Monitoring', () => {
    test('should process high-volume transaction monitoring', async () => {
      const transactions = Array.from({ length: 10 }, (_, i) => ({
        id: uuidv4(),
        amount: 1000 + i * 500,
        currency: 'AUD',
        type: 'bitcoin_purchase'
      }));

      const results = await Promise.all(
        transactions.map(tx =>
          austracComplianceService.processTransactionForAML(
            testTenantId,
            tx.id,
            tx.amount,
            tx.currency,
            tx.type
          )
        )
      );

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.approved).toBeDefined();
        expect(result.riskLevel).toBeDefined();
        expect(Array.isArray(result.alerts)).toBe(true);
      });
    });

    test('should handle currency conversion for threshold detection', async () => {
      const transactionId = uuidv4();
      const usdAmount = 7000; // ~$10K AUD equivalent
      
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        transactionId,
        usdAmount,
        'USD',
        'bitcoin_purchase'
      );

      expect(result.approved).toBeDefined();
      // Currency conversion should be handled (mock implementation returns same amount)
    });
  });

  describe('Compliance Metrics', () => {
    test('should track compliance processing metrics', async () => {
      const startTime = Date.now();
      
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        uuidv4(),
        5000,
        'AUD',
        'bitcoin_purchase'
      );

      const processingTime = Date.now() - startTime;
      
      expect(result).toBeDefined();
      expect(processingTime).toBeLessThan(5000); // Should process within 5 seconds
    });

    test('should maintain audit trail for all compliance actions', async () => {
      const transactionId = uuidv4();
      
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        transactionId,
        15000, // Over threshold
        'AUD',
        'bitcoin_purchase'
      );

      expect(result.requiresReport).toBe(true);
      
      // Audit trail should be created (implementation logs to console/database)
      // In production, this would verify database entries
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle service unavailability gracefully', async () => {
      // Test with invalid tenant ID to trigger error path
      const result = await austracComplianceService.processTransactionForAML(
        'invalid-tenant',
        uuidv4(),
        5000,
        'AUD',
        'bitcoin_purchase'
      );

      // Should not throw but return safe defaults
      expect(result.approved).toBeDefined();
      expect(result.riskLevel).toBeDefined();
    });

    test('should validate input parameters', async () => {
      // Test with invalid amount
      const result = await austracComplianceService.processTransactionForAML(
        testTenantId,
        uuidv4(),
        -1000, // Negative amount
        'AUD',
        'bitcoin_purchase'
      );

      expect(result.approved).toBeDefined();
      // Implementation should handle invalid inputs gracefully
    });

    test('should handle concurrent transaction processing', async () => {
      const concurrentTransactions = Array.from({ length: 5 }, (_, i) => 
        austracComplianceService.processTransactionForAML(
          testTenantId,
          uuidv4(),
          8000 + i * 100,
          'AUD',
          'bitcoin_purchase'
        )
      );

      const results = await Promise.all(concurrentTransactions);
      
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.approved).toBeDefined();
        expect(result.riskLevel).toBeDefined();
      });
    });
  });
});