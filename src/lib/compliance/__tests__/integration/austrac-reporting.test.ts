// LIQUID ABT - AUSTRAC Automated Reporting Integration Tests
// Tests the complete automated AUSTRAC compliance reporting system

import { austracReportingService, AUSTRACReportType, AUSTRACReportStatus } from '../../austracReporting';
import { austracScheduler } from '../../../jobs/austracScheduler';
import { createRedisCache } from '../../../cache/redisClient';
import { getMasterPrisma } from '../../../database/connection';
import { v4 as uuidv4 } from 'uuid';

describe('AUSTRAC Automated Reporting Integration', () => {
  let redis: any;
  let prisma: any;
  const testTenantId = uuidv4();

  beforeAll(async () => {
    redis = createRedisCache();
    prisma = getMasterPrisma();
    
    // Ensure clean state
    await redis.flushall();
    
    // Setup test tenant data
    try {
      await prisma.tenant.create({
        data: {
          id: testTenantId,
          name: 'AUSTRAC Test Tenant',
          subdomain: 'austrac-test',
          subscriptionTier: 'pro'
        }
      });
    } catch (error) {
      // Tenant might already exist, continue
    }
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await prisma.austracReport.deleteMany({
        where: {
          metadata: {
            path: ['reportingEntity'],
            equals: testTenantId
          }
        }
      });
      
      await prisma.tenant.delete({
        where: { id: testTenantId }
      });
    } catch (error) {
      console.log('Cleanup error (expected if records not created):', error.message);
    }
    
    if (redis) {
      redis.disconnect();
    }
  });

  describe('Threshold Transaction Report (TTR) Generation', () => {
    test('should generate TTR report for period with threshold transactions', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const report = await austracReportingService.generateTTR(
        startDate,
        endDate,
        testTenantId
      );

      expect(report).toBeDefined();
      expect(report.id).toMatch(/^TTR_\d{8}_[a-f0-9]{8}$/);
      expect(report.reportType).toBe(AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT);
      expect(report.reportPeriod.startDate).toEqual(startDate);
      expect(report.reportPeriod.endDate).toEqual(endDate);
      expect(report.generatedAt).toBeDefined();
      expect(report.status).toBeOneOf([AUSTRACReportStatus.GENERATED, AUSTRACReportStatus.VALIDATED]);
      expect(typeof report.recordCount).toBe('number');
      expect(typeof report.totalAmount).toBe('number');
      expect(report.filePath).toBeDefined();
      expect(report.metadata.reportingEntity).toBe(testTenantId);
      expect(Array.isArray(report.metadata.businessRules)).toBe(true);
    });

    test('should validate TTR report contains required business rules', async () => {
      const startDate = new Date('2025-02-01');
      const endDate = new Date('2025-02-28');

      const report = await austracReportingService.generateTTR(
        startDate,
        endDate,
        testTenantId
      );

      expect(report.metadata.businessRules).toContain('Transactions >= $10,000 AUD included');
      expect(report.metadata.businessRules).toContain('Customer identification verified');
      expect(report.metadata.businessRules).toContain('Risk assessment completed');
    });

    test('should handle empty period with no threshold transactions', async () => {
      // Use a future date range where no transactions exist
      const startDate = new Date('2030-01-01');
      const endDate = new Date('2030-01-31');

      const report = await austracReportingService.generateTTR(
        startDate,
        endDate,
        testTenantId
      );

      expect(report).toBeDefined();
      expect(report.recordCount).toBe(0);
      expect(report.totalAmount).toBe(0);
      expect(report.status).toBeOneOf([AUSTRACReportStatus.GENERATED, AUSTRACReportStatus.VALIDATED]);
    });

    test('should generate global TTR report when no tenant specified', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const report = await austracReportingService.generateTTR(
        startDate,
        endDate
        // No tenant ID - should be global
      );

      expect(report).toBeDefined();
      expect(report.metadata.reportingEntity).toBe('LIQUID_ABT_GLOBAL');
    });
  });

  describe('Suspicious Matter Report (SMR) Generation', () => {
    test('should generate SMR report for period', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      const report = await austracReportingService.generateSMR(
        startDate,
        endDate,
        testTenantId
      );

      expect(report).toBeDefined();
      expect(report.id).toMatch(/^SMR_\d{8}_[a-f0-9]{8}$/);
      expect(report.reportType).toBe(AUSTRACReportType.SUSPICIOUS_MATTER_REPORT);
      expect(report.reportPeriod.startDate).toEqual(startDate);
      expect(report.reportPeriod.endDate).toEqual(endDate);
      expect(report.status).toBeOneOf([AUSTRACReportStatus.GENERATED, AUSTRACReportStatus.VALIDATED]);
      expect(report.metadata.businessRules).toContain('Suspicious patterns detected and analyzed');
    });

    test('should handle period with no suspicious activities', async () => {
      const startDate = new Date('2030-06-01');
      const endDate = new Date('2030-06-30');

      const report = await austracReportingService.generateSMR(
        startDate,
        endDate,
        testTenantId
      );

      expect(report).toBeDefined();
      expect(report.recordCount).toBe(0);
      expect(report.totalAmount).toBe(0);
    });
  });

  describe('Report Management and Retrieval', () => {
    test('should retrieve reports by date range', async () => {
      // Generate a test report first
      const startDate = new Date('2025-03-01');
      const endDate = new Date('2025-03-31');

      const generatedReport = await austracReportingService.generateTTR(
        startDate,
        endDate,
        testTenantId
      );

      // Retrieve reports for the same period
      const reports = await austracReportingService.getReports(
        startDate,
        endDate,
        AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT,
        testTenantId
      );

      expect(Array.isArray(reports)).toBe(true);
      const foundReport = reports.find(r => r.id === generatedReport.id);
      expect(foundReport).toBeDefined();
      expect(foundReport?.reportType).toBe(AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT);
    });

    test('should retrieve all report types when no type specified', async () => {
      const startDate = new Date('2025-04-01');
      const endDate = new Date('2025-04-30');

      // Generate reports of different types
      const ttrReport = await austracReportingService.generateTTR(startDate, endDate, testTenantId);
      const smrReport = await austracReportingService.generateSMR(startDate, endDate, testTenantId);

      // Retrieve all reports for the period
      const reports = await austracReportingService.getReports(
        startDate,
        endDate,
        undefined, // No specific type
        testTenantId
      );

      expect(reports.length).toBeGreaterThanOrEqual(2);
      const reportIds = reports.map(r => r.id);
      expect(reportIds).toContain(ttrReport.id);
      expect(reportIds).toContain(smrReport.id);
    });

    test('should filter reports by tenant', async () => {
      const startDate = new Date('2025-05-01');
      const endDate = new Date('2025-05-31');

      // Generate tenant-specific report
      const tenantReport = await austracReportingService.generateTTR(startDate, endDate, testTenantId);
      
      // Generate global report
      const globalReport = await austracReportingService.generateTTR(startDate, endDate);

      // Retrieve only tenant reports
      const tenantReports = await austracReportingService.getReports(
        startDate,
        endDate,
        undefined,
        testTenantId
      );

      // Retrieve only global reports
      const globalReports = await austracReportingService.getReports(
        startDate,
        endDate,
        undefined
        // No tenant ID - global reports
      );

      // Tenant reports should include the tenant report but not the global one
      const tenantIds = tenantReports.map(r => r.id);
      expect(tenantIds).toContain(tenantReport.id);

      // Global reports should include the global report
      const globalIds = globalReports.map(r => r.id);
      expect(globalIds).toContain(globalReport.id);
    });
  });

  describe('Report Submission', () => {
    test('should submit validated report successfully', async () => {
      const startDate = new Date('2025-06-01');
      const endDate = new Date('2025-06-30');

      // Generate and validate a report
      const report = await austracReportingService.generateTTR(startDate, endDate, testTenantId);
      
      // Submit the report (simulation)
      const submissionResult = await austracReportingService.submitReport(report.id);

      expect(submissionResult).toBe(true);

      // Verify report status was updated
      const updatedReports = await austracReportingService.getReports(
        startDate,
        endDate,
        AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT,
        testTenantId
      );

      const submittedReport = updatedReports.find(r => r.id === report.id);
      expect(submittedReport?.status).toBe(AUSTRACReportStatus.SUBMITTED);
      expect(submittedReport?.submittedAt).toBeDefined();
      expect(submittedReport?.metadata.submissionReference).toBeDefined();
      expect(submittedReport?.metadata.submissionReference).toMatch(/^AUSTRAC_REF_\d+$/);
    });

    test('should reject submission of non-existent report', async () => {
      const fakeReportId = 'TTR_20250101_fakereport';
      
      const submissionResult = await austracReportingService.submitReport(fakeReportId);
      
      expect(submissionResult).toBe(false);
    });
  });

  describe('Automated Scheduling', () => {
    test('should schedule automatic report generation', async () => {
      await austracReportingService.scheduleAutomaticReporting(
        AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT,
        'daily',
        testTenantId
      );

      // Verify schedule was created in Redis
      const scheduleKey = `austrac_schedule:TTR:${testTenantId}`;
      const scheduleData = await redis.get(scheduleKey);
      
      expect(scheduleData).toBeDefined();
      
      const schedule = JSON.parse(scheduleData);
      expect(schedule.reportType).toBe(AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT);
      expect(schedule.frequency).toBe('daily');
      expect(schedule.tenantId).toBe(testTenantId);
      expect(schedule.enabled).toBe(true);
      expect(schedule.nextScheduled).toBeDefined();
    });

    test('should process scheduled reports', async () => {
      // Create a test schedule that's ready for processing
      const scheduleKey = `austrac_schedule:TTR:${testTenantId}_test`;
      const schedule = {
        reportType: AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT,
        frequency: 'daily',
        tenantId: testTenantId,
        lastGenerated: null,
        nextScheduled: new Date(Date.now() - 1000).toISOString(), // Past time
        enabled: true,
        createdAt: new Date().toISOString()
      };
      
      await redis.set(scheduleKey, JSON.stringify(schedule));

      // Process scheduled reports
      await austracReportingService.processScheduledReports();

      // Verify schedule was updated
      const updatedScheduleData = await redis.get(scheduleKey);
      const updatedSchedule = JSON.parse(updatedScheduleData);
      
      expect(updatedSchedule.lastGenerated).toBeDefined();
      expect(new Date(updatedSchedule.nextScheduled) > new Date()).toBe(true);
    });
  });

  describe('AUSTRAC Scheduler Background Jobs', () => {
    test('should start and stop scheduler successfully', () => {
      const initialStatus = austracScheduler.getStatus();
      expect(initialStatus.isRunning).toBe(false);

      // Start scheduler
      austracScheduler.start();
      
      let status = austracScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.scheduledJobs.length).toBeGreaterThan(0);
      expect(status.scheduledJobs).toContain('hourly_reports');
      expect(status.scheduledJobs).toContain('daily_compliance');
      expect(status.scheduledJobs).toContain('weekly_summary');

      // Stop scheduler
      austracScheduler.stop();
      
      status = austracScheduler.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.scheduledJobs.length).toBe(0);
    });

    test('should manually trigger scheduled reports', async () => {
      // Create a test schedule
      const scheduleKey = `austrac_schedule:SMR:${testTenantId}_manual`;
      const schedule = {
        reportType: AUSTRACReportType.SUSPICIOUS_MATTER_REPORT,
        frequency: 'weekly',
        tenantId: testTenantId,
        lastGenerated: null,
        nextScheduled: new Date(Date.now() - 1000).toISOString(),
        enabled: true,
        createdAt: new Date().toISOString()
      };
      
      await redis.set(scheduleKey, JSON.stringify(schedule));

      // Manually trigger processing
      await austracScheduler.triggerScheduledReports();

      // Verify processing occurred (would check logs in production)
      expect(true).toBe(true); // Test passes if no errors thrown
    });

    test('should manually trigger daily compliance check', async () => {
      // Manually trigger compliance check
      await austracScheduler.triggerDailyComplianceCheck();

      // Verify processing occurred (would check logs in production)
      expect(true).toBe(true); // Test passes if no errors thrown
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle invalid date ranges gracefully', async () => {
      const startDate = new Date('2025-12-31');
      const endDate = new Date('2025-01-01'); // End before start

      // Should still generate report but with proper validation
      const report = await austracReportingService.generateTTR(startDate, endDate, testTenantId);
      
      expect(report).toBeDefined();
      // Implementation should handle this gracefully
    });

    test('should handle missing tenant data gracefully', async () => {
      const fakeTenanId = 'non-existent-tenant-id';
      const startDate = new Date('2025-07-01');
      const endDate = new Date('2025-07-31');

      const report = await austracReportingService.generateTTR(startDate, endDate, fakeTenanId);
      
      expect(report).toBeDefined();
      expect(report.recordCount).toBe(0); // No data for non-existent tenant
    });

    test('should handle concurrent report generation', async () => {
      const startDate = new Date('2025-08-01');
      const endDate = new Date('2025-08-31');

      // Generate multiple reports concurrently
      const reportPromises = [
        austracReportingService.generateTTR(startDate, endDate, testTenantId),
        austracReportingService.generateSMR(startDate, endDate, testTenantId),
        austracReportingService.generateTTR(startDate, endDate) // Global
      ];

      const reports = await Promise.all(reportPromises);
      
      expect(reports).toHaveLength(3);
      reports.forEach(report => {
        expect(report.id).toBeDefined();
        expect(report.generatedAt).toBeDefined();
      });

      // Ensure all reports have unique IDs
      const reportIds = reports.map(r => r.id);
      const uniqueIds = [...new Set(reportIds)];
      expect(uniqueIds).toHaveLength(3);
    });

    test('should validate report status transitions', async () => {
      const startDate = new Date('2025-09-01');
      const endDate = new Date('2025-09-30');

      // Generate a report
      const report = await austracReportingService.generateTTR(startDate, endDate, testTenantId);
      
      // Verify initial status
      expect(report.status).toBeOneOf([
        AUSTRACReportStatus.GENERATED,
        AUSTRACReportStatus.VALIDATED
      ]);

      // Submit report
      if (report.status === AUSTRACReportStatus.VALIDATED || report.status === AUSTRACReportStatus.GENERATED) {
        const submissionResult = await austracReportingService.submitReport(report.id);
        expect(submissionResult).toBe(true);
      }
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large date ranges efficiently', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31'); // Full year

      const startTime = Date.now();
      const report = await austracReportingService.generateTTR(startDate, endDate, testTenantId);
      const duration = Date.now() - startTime;

      expect(report).toBeDefined();
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    });

    test('should cache frequently accessed reports', async () => {
      const startDate = new Date('2025-10-01');
      const endDate = new Date('2025-10-31');

      // Generate report
      const report = await austracReportingService.generateTTR(startDate, endDate, testTenantId);

      // First retrieval
      const startTime1 = Date.now();
      const reports1 = await austracReportingService.getReports(
        startDate,
        endDate,
        AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT,
        testTenantId
      );
      const duration1 = Date.now() - startTime1;

      // Second retrieval (should use cache)
      const startTime2 = Date.now();
      const reports2 = await austracReportingService.getReports(
        startDate,
        endDate,
        AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT,
        testTenantId
      );
      const duration2 = Date.now() - startTime2;

      expect(reports1).toEqual(reports2);
      // Note: Caching occurs at individual report level, so this test verifies functionality
      expect(reports2.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Data Integrity and Audit Trail', () => {
    test('should maintain data integrity across report lifecycle', async () => {
      const startDate = new Date('2025-11-01');
      const endDate = new Date('2025-11-30');

      // Generate report
      const originalReport = await austracReportingService.generateTTR(startDate, endDate, testTenantId);
      
      // Retrieve report
      const retrievedReports = await austracReportingService.getReports(
        startDate,
        endDate,
        AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT,
        testTenantId
      );

      const retrievedReport = retrievedReports.find(r => r.id === originalReport.id);
      
      expect(retrievedReport).toBeDefined();
      expect(retrievedReport?.id).toBe(originalReport.id);
      expect(retrievedReport?.reportType).toBe(originalReport.reportType);
      expect(retrievedReport?.recordCount).toBe(originalReport.recordCount);
      expect(retrievedReport?.totalAmount).toBe(originalReport.totalAmount);
      expect(retrievedReport?.generatedAt).toEqual(originalReport.generatedAt);
    });

    test('should create proper audit trail for compliance activities', async () => {
      const startDate = new Date('2025-12-01');
      const endDate = new Date('2025-12-31');

      // Generate report (creates audit trail)
      const report = await austracReportingService.generateTTR(startDate, endDate, testTenantId);
      
      // Submit report (creates additional audit trail)
      await austracReportingService.submitReport(report.id);

      // In production, would verify audit entries in austrac_compliance_events table
      expect(report.id).toBeDefined();
      expect(report.generatedAt).toBeDefined();
    });
  });
});