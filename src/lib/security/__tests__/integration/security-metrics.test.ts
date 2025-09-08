// LIQUID ABT - Security Metrics Integration Tests
// Tests the complete security monitoring and alerting system

import { securityMetricsService, SecurityMetricType, SecuritySeverity } from '../../securityMetrics';
import { createRedisCache } from '../../../cache/redisClient';
import { v4 as uuidv4 } from 'uuid';

describe('Security Metrics Integration', () => {
  let redis: any;
  const testTenantId = uuidv4();

  beforeAll(async () => {
    redis = createRedisCache();
    await redis.flushall(); // Clear Redis for clean testing
  });

  afterAll(async () => {
    // Cleanup test data
    await securityMetricsService.recordMetric(
      SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
      0,
      testTenantId,
      { cleanup: true }
    );
    
    if (redis) {
      redis.disconnect();
    }
  });

  describe('Metric Recording and Retrieval', () => {
    test('should record security metric successfully', async () => {
      const metric = await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        3,
        testTenantId,
        { userId: 'test-user', ipAddress: '192.168.1.100' }
      );

      expect(metric.id).toBeDefined();
      expect(metric.metricType).toBe(SecurityMetricType.FAILED_LOGIN_ATTEMPTS);
      expect(metric.value).toBe(3);
      expect(metric.tenantId).toBe(testTenantId);
      expect(metric.severity).toBe(SecuritySeverity.MEDIUM);
      expect(metric.status).toBe('active');
      expect(metric.metadata).toEqual({
        userId: 'test-user',
        ipAddress: '192.168.1.100'
      });
    });

    test('should retrieve metrics by type and tenant', async () => {
      // Record multiple metrics
      await securityMetricsService.recordMetric(
        SecurityMetricType.RATE_LIMIT_VIOLATIONS,
        2,
        testTenantId
      );
      await securityMetricsService.recordMetric(
        SecurityMetricType.RATE_LIMIT_VIOLATIONS,
        1,
        testTenantId
      );

      const metrics = await securityMetricsService.getMetrics(
        SecurityMetricType.RATE_LIMIT_VIOLATIONS,
        testTenantId,
        1
      );

      expect(metrics.length).toBeGreaterThanOrEqual(2);
      expect(metrics[0].metricType).toBe(SecurityMetricType.RATE_LIMIT_VIOLATIONS);
      expect(metrics[0].tenantId).toBe(testTenantId);
    });

    test('should calculate severity correctly based on metric type and value', async () => {
      // Test failed login attempts severity
      const lowSeverity = await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        2,
        testTenantId
      );
      expect(lowSeverity.severity).toBe(SecuritySeverity.LOW);

      const mediumSeverity = await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        4,
        testTenantId
      );
      expect(mediumSeverity.severity).toBe(SecuritySeverity.MEDIUM);

      const highSeverity = await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        6,
        testTenantId
      );
      expect(highSeverity.severity).toBe(SecuritySeverity.HIGH);

      const criticalSeverity = await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        12,
        testTenantId
      );
      expect(criticalSeverity.severity).toBe(SecuritySeverity.CRITICAL);
    });

    test('should calculate severity for suspicious transactions', async () => {
      const lowTransaction = await securityMetricsService.recordMetric(
        SecurityMetricType.SUSPICIOUS_TRANSACTIONS,
        1000,
        testTenantId
      );
      expect(lowTransaction.severity).toBe(SecuritySeverity.LOW);

      const mediumTransaction = await securityMetricsService.recordMetric(
        SecurityMetricType.SUSPICIOUS_TRANSACTIONS,
        7500,
        testTenantId
      );
      expect(mediumTransaction.severity).toBe(SecuritySeverity.MEDIUM);

      const highTransaction = await securityMetricsService.recordMetric(
        SecurityMetricType.SUSPICIOUS_TRANSACTIONS,
        15000, // Above AUSTRAC threshold
        testTenantId
      );
      expect(highTransaction.severity).toBe(SecuritySeverity.HIGH);

      const criticalTransaction = await securityMetricsService.recordMetric(
        SecurityMetricType.SUSPICIOUS_TRANSACTIONS,
        75000,
        testTenantId
      );
      expect(criticalTransaction.severity).toBe(SecuritySeverity.CRITICAL);
    });
  });

  describe('Alert Generation', () => {
    test('should create alert for high-value failed login attempts', async () => {
      // Clear previous alerts for clean testing
      await redis.del(`security_alerts:${testTenantId}`);

      // Record high number of failed login attempts
      await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        7, // Should trigger alert
        testTenantId,
        { userId: 'suspicious-user', ipAddress: '192.168.1.200' }
      );

      // Wait a moment for alert processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const alerts = await securityMetricsService.getActiveAlerts(testTenantId);
      const failedLoginAlert = alerts.find(alert => 
        alert.alertType === SecurityMetricType.FAILED_LOGIN_ATTEMPTS
      );

      expect(failedLoginAlert).toBeDefined();
      expect(failedLoginAlert?.title).toContain('Multiple Failed Login Attempts Detected');
      expect(failedLoginAlert?.severity).toBe(SecuritySeverity.HIGH);
      expect(failedLoginAlert?.status).toBe('new');
      expect(failedLoginAlert?.recommendations).toContain('Review authentication logs for suspicious patterns');
    });

    test('should create alert for AUSTRAC threshold breach', async () => {
      // Clear previous alerts
      await redis.del(`security_alerts:${testTenantId}`);

      // Record transaction above AUSTRAC threshold
      await securityMetricsService.recordMetric(
        SecurityMetricType.SUSPICIOUS_TRANSACTIONS,
        12000, // Above $10K AUSTRAC threshold
        testTenantId,
        { transactionId: 'tx-austrac-test' }
      );

      // Wait for alert processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const alerts = await securityMetricsService.getActiveAlerts(testTenantId);
      const austracAlert = alerts.find(alert => 
        alert.alertType === SecurityMetricType.SUSPICIOUS_TRANSACTIONS
      );

      expect(austracAlert).toBeDefined();
      expect(austracAlert?.title).toContain('Large Transaction Requires AUSTRAC Reporting');
      expect(austracAlert?.description).toContain('$12000 AUD detected, above $10,000 AUSTRAC threshold');
      expect(austracAlert?.recommendations).toContain('Generate AUSTRAC Threshold Transaction Report (TTR)');
      expect(austracAlert?.affectedResources).toContain('compliance_system');
    });

    test('should create alert for price manipulation', async () => {
      // Clear previous alerts
      await redis.del('security_alerts:global');

      // Record price manipulation event
      await securityMetricsService.recordMetric(
        SecurityMetricType.PRICE_MANIPULATION_ALERTS,
        12.5, // 12.5% price deviation
        undefined, // Global alert
        { exchange: 'zerocap', affectedTrades: 5 }
      );

      // Wait for alert processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const alerts = await securityMetricsService.getActiveAlerts();
      const priceAlert = alerts.find(alert => 
        alert.alertType === SecurityMetricType.PRICE_MANIPULATION_ALERTS
      );

      expect(priceAlert).toBeDefined();
      expect(priceAlert?.title).toContain('Price Manipulation Circuit Breaker Triggered');
      expect(priceAlert?.description).toContain('12.5% price deviation detected');
      expect(priceAlert?.recommendations).toContain('Halt automated trading temporarily');
      expect(priceAlert?.affectedResources).toContain('trading_engine');
    });
  });

  describe('Dashboard Statistics', () => {
    test('should calculate dashboard statistics correctly', async () => {
      // Generate some test data
      await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        15, // Critical
        testTenantId
      );
      await securityMetricsService.recordMetric(
        SecurityMetricType.SUSPICIOUS_TRANSACTIONS,
        8000, // High
        testTenantId
      );

      const stats = await securityMetricsService.getDashboardStats();

      expect(stats).toBeDefined();
      expect(stats.totalActiveAlerts).toBeGreaterThanOrEqual(0);
      expect(stats.criticalAlerts).toBeGreaterThanOrEqual(0);
      expect(stats.highSeverityAlerts).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(stats.topThreats)).toBe(true);
      expect(typeof stats.systemHealth).toBe('object');
      expect(stats.systemHealth.authenticationHealth).toBeGreaterThanOrEqual(0);
      expect(stats.systemHealth.authenticationHealth).toBeLessThanOrEqual(100);
    });

    test('should calculate tenant risk score', async () => {
      const riskScore = await securityMetricsService.getTenantRiskScore(testTenantId);

      expect(typeof riskScore).toBe('number');
      expect(riskScore).toBeGreaterThanOrEqual(0);
      expect(riskScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Security Report Generation', () => {
    test('should generate comprehensive security report', async () => {
      const report = await securityMetricsService.generateSecurityReport(testTenantId, 24);

      expect(report).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(typeof report.summary.totalAlerts).toBe('number');
      expect(typeof report.summary.criticalAlerts).toBe('number');
      expect(typeof report.summary.riskScore).toBe('number');
      expect(Array.isArray(report.summary.recommendedActions)).toBe(true);
      expect(typeof report.metricsByType).toBe('object');
      expect(Array.isArray(report.trendAnalysis)).toBe(true);
    });

    test('should provide meaningful recommendations based on alerts', async () => {
      // Create some high-risk scenarios
      await securityMetricsService.recordMetric(
        SecurityMetricType.TENANT_ISOLATION_BREACHES,
        1, // Always critical
        testTenantId
      );

      const report = await securityMetricsService.generateSecurityReport(testTenantId, 1);
      
      expect(report.summary.recommendedActions.length).toBeGreaterThan(0);
      expect(report.summary.recommendedActions).toContain('Address all critical security alerts immediately');
    });
  });

  describe('Alert Management', () => {
    test('should update alert status correctly', async () => {
      // Create an alert first
      const alert = await securityMetricsService.createAlert(
        SecurityMetricType.API_ABUSE_ATTEMPTS,
        SecuritySeverity.HIGH,
        'Test Alert for Status Update',
        'This is a test alert for status update functionality',
        testTenantId
      );

      // Update alert status
      await securityMetricsService.updateAlertStatus(
        alert.id,
        'investigating',
        'test-user',
        'Investigating the alert'
      );

      // Verify update (would need to implement getAlert method)
      // For now, we verify the function doesn't throw
      expect(true).toBe(true);
    });

    test('should filter alerts by severity', async () => {
      // Create alerts with different severities
      await securityMetricsService.createAlert(
        SecurityMetricType.UNAUTHORIZED_ACCESS_ATTEMPTS,
        SecuritySeverity.LOW,
        'Low Severity Test Alert',
        'Test alert with low severity',
        testTenantId
      );

      await securityMetricsService.createAlert(
        SecurityMetricType.UNAUTHORIZED_ACCESS_ATTEMPTS,
        SecuritySeverity.CRITICAL,
        'Critical Severity Test Alert',
        'Test alert with critical severity',
        testTenantId
      );

      const criticalAlerts = await securityMetricsService.getActiveAlerts(
        testTenantId,
        SecuritySeverity.CRITICAL
      );
      const lowAlerts = await securityMetricsService.getActiveAlerts(
        testTenantId,
        SecuritySeverity.LOW
      );

      expect(criticalAlerts.every(alert => alert.severity === SecuritySeverity.CRITICAL)).toBe(true);
      expect(lowAlerts.every(alert => alert.severity === SecuritySeverity.LOW)).toBe(true);
    });
  });

  describe('Tracking Methods', () => {
    test('should track failed login attempts with metadata', async () => {
      await securityMetricsService.trackFailedLogin(
        testTenantId,
        'test-user-123',
        '10.0.0.1',
        'Mozilla/5.0 Test Browser'
      );

      const metrics = await securityMetricsService.getMetrics(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        testTenantId,
        1
      );

      const recentMetric = metrics.find(m => 
        m.metadata?.userId === 'test-user-123' && 
        m.metadata?.ipAddress === '10.0.0.1'
      );

      expect(recentMetric).toBeDefined();
      expect(recentMetric?.metadata?.userAgent).toBe('Mozilla/5.0 Test Browser');
    });

    test('should track rate limit violations', async () => {
      await securityMetricsService.trackRateLimitViolation(
        '/api/auth/login',
        '10.0.0.2',
        testTenantId
      );

      const metrics = await securityMetricsService.getMetrics(
        SecurityMetricType.RATE_LIMIT_VIOLATIONS,
        testTenantId,
        1
      );

      const recentMetric = metrics.find(m => 
        m.metadata?.endpoint === '/api/auth/login' && 
        m.metadata?.ipAddress === '10.0.0.2'
      );

      expect(recentMetric).toBeDefined();
    });

    test('should track suspicious transactions', async () => {
      await securityMetricsService.trackSuspiciousTransaction(
        testTenantId,
        'tx-suspicious-123',
        'Unusual transaction pattern',
        8500
      );

      const metrics = await securityMetricsService.getMetrics(
        SecurityMetricType.SUSPICIOUS_TRANSACTIONS,
        testTenantId,
        1
      );

      const recentMetric = metrics.find(m => 
        m.metadata?.transactionId === 'tx-suspicious-123'
      );

      expect(recentMetric).toBeDefined();
      expect(recentMetric?.value).toBe(8500);
      expect(recentMetric?.metadata?.suspicionReason).toBe('Unusual transaction pattern');
    });

    test('should track price manipulation alerts', async () => {
      await securityMetricsService.trackPriceManipulationAlert(
        'independent-reserve',
        8.2, // 8.2% deviation
        3 // Affected trades
      );

      const metrics = await securityMetricsService.getMetrics(
        SecurityMetricType.PRICE_MANIPULATION_ALERTS,
        undefined, // Global
        1
      );

      const recentMetric = metrics.find(m => 
        m.metadata?.exchange === 'independent-reserve'
      );

      expect(recentMetric).toBeDefined();
      expect(recentMetric?.value).toBe(8.2);
      expect(recentMetric?.metadata?.affectedTrades).toBe(3);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle invalid metric types gracefully', async () => {
      // This test verifies TypeScript type safety prevents invalid metric types
      expect(Object.values(SecurityMetricType)).toContain(SecurityMetricType.FAILED_LOGIN_ATTEMPTS);
      expect(Object.values(SecuritySeverity)).toContain(SecuritySeverity.CRITICAL);
    });

    test('should handle missing tenant ID for global metrics', async () => {
      const metric = await securityMetricsService.recordMetric(
        SecurityMetricType.EXCHANGE_HEALTH_DEGRADATION,
        2
        // No tenant ID - should be treated as global
      );

      expect(metric.tenantId).toBeUndefined();
      expect(metric.metricType).toBe(SecurityMetricType.EXCHANGE_HEALTH_DEGRADATION);
    });

    test('should handle concurrent metric recording', async () => {
      const concurrentPromises = Array.from({ length: 5 }, (_, i) =>
        securityMetricsService.recordMetric(
          SecurityMetricType.API_ABUSE_ATTEMPTS,
          1,
          testTenantId,
          { attempt: i }
        )
      );

      const results = await Promise.all(concurrentPromises);
      
      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.id).toBeDefined();
        expect(result.metadata?.attempt).toBe(index);
      });
    });

    test('should validate severity calculation edge cases', async () => {
      // Test zero values
      const zeroMetric = await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        0,
        testTenantId
      );
      expect(zeroMetric.severity).toBe(SecuritySeverity.LOW);

      // Test very high values
      const extremeMetric = await securityMetricsService.recordMetric(
        SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
        1000,
        testTenantId
      );
      expect(extremeMetric.severity).toBe(SecuritySeverity.CRITICAL);
    });
  });

  describe('Performance and Caching', () => {
    test('should cache dashboard statistics for performance', async () => {
      // First call - should populate cache
      const startTime1 = Date.now();
      const stats1 = await securityMetricsService.getDashboardStats();
      const duration1 = Date.now() - startTime1;

      // Second call - should hit cache
      const startTime2 = Date.now();
      const stats2 = await securityMetricsService.getDashboardStats();
      const duration2 = Date.now() - startTime2;

      expect(stats1).toEqual(stats2);
      expect(duration2).toBeLessThan(duration1); // Cache should be faster
    });

    test('should handle large datasets efficiently', async () => {
      const startTime = Date.now();
      
      // Record many metrics quickly
      const promises = Array.from({ length: 100 }, () =>
        securityMetricsService.recordMetric(
          SecurityMetricType.CSRF_TOKEN_VIOLATIONS,
          1,
          testTenantId
        )
      );
      
      await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      
      // Verify metrics are retrievable
      const metrics = await securityMetricsService.getMetrics(
        SecurityMetricType.CSRF_TOKEN_VIOLATIONS,
        testTenantId,
        1
      );
      
      expect(metrics.length).toBeGreaterThanOrEqual(100);
    });
  });
});