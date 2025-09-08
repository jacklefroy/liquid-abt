// LIQUID ABT - Security Metrics Dashboard
// Real-time security monitoring and alerting system

import { createRedisCache } from '../cache/redisClient';
import { getMasterPrisma, getTenantPrisma } from '../database/connection';
import { Redis } from 'ioredis';

export interface SecurityMetric {
  id: string;
  tenantId?: string;
  metricType: SecurityMetricType;
  value: number;
  metadata?: Record<string, any>;
  timestamp: Date;
  severity: SecuritySeverity;
  status: 'active' | 'acknowledged' | 'resolved';
}

export enum SecurityMetricType {
  FAILED_LOGIN_ATTEMPTS = 'failed_login_attempts',
  RATE_LIMIT_VIOLATIONS = 'rate_limit_violations',
  SUSPICIOUS_TRANSACTIONS = 'suspicious_transactions',
  PRICE_MANIPULATION_ALERTS = 'price_manipulation_alerts',
  CSRF_TOKEN_VIOLATIONS = 'csrf_token_violations',
  JWT_TOKEN_ANOMALIES = 'jwt_token_anomalies',
  TENANT_ISOLATION_BREACHES = 'tenant_isolation_breaches',
  API_ABUSE_ATTEMPTS = 'api_abuse_attempts',
  UNAUTHORIZED_ACCESS_ATTEMPTS = 'unauthorized_access_attempts',
  EXCHANGE_HEALTH_DEGRADATION = 'exchange_health_degradation',
  COMPLIANCE_THRESHOLD_BREACHES = 'compliance_threshold_breaches',
  BITCOIN_ADDRESS_VIOLATIONS = 'bitcoin_address_violations'
}

export enum SecuritySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface SecurityDashboardStats {
  totalActiveAlerts: number;
  criticalAlerts: number;
  highSeverityAlerts: number;
  resolvedToday: number;
  averageResolutionTime: number;
  topThreats: Array<{
    type: SecurityMetricType;
    count: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  tenantRiskScores: Array<{
    tenantId: string;
    riskScore: number;
    alertCount: number;
  }>;
  systemHealth: {
    authenticationHealth: number;
    apiHealth: number;
    exchangeHealth: number;
    complianceHealth: number;
  };
}

export interface SecurityAlert {
  id: string;
  tenantId?: string;
  alertType: SecurityMetricType;
  severity: SecuritySeverity;
  title: string;
  description: string;
  recommendations: string[];
  affectedResources: string[];
  timestamp: Date;
  status: 'new' | 'investigating' | 'resolved' | 'false_positive';
  assignedTo?: string;
  resolutionNotes?: string;
}

export class SecurityMetricsService {
  private redis: Redis;
  private readonly METRICS_PREFIX = 'security_metrics:';
  private readonly ALERTS_PREFIX = 'security_alerts:';
  private readonly DASHBOARD_CACHE_PREFIX = 'security_dashboard:';

  constructor() {
    this.redis = createRedisCache();
  }

  /**
   * Record a security metric
   */
  async recordMetric(
    metricType: SecurityMetricType,
    value: number,
    tenantId?: string,
    metadata?: Record<string, any>
  ): Promise<SecurityMetric> {
    const metric: SecurityMetric = {
      id: this.generateMetricId(),
      tenantId,
      metricType,
      value,
      metadata,
      timestamp: new Date(),
      severity: this.calculateSeverity(metricType, value, metadata),
      status: 'active'
    };

    // Store metric in Redis for real-time access
    const key = `${this.METRICS_PREFIX}${metricType}:${tenantId || 'global'}`;
    await this.redis.lpush(key, JSON.stringify(metric));
    await this.redis.ltrim(key, 0, 999); // Keep last 1000 metrics

    // Store in database for long-term analysis
    await this.persistMetricToDatabase(metric);

    // Check if this metric should trigger an alert
    await this.evaluateAlertConditions(metric);

    // Update real-time dashboard cache
    await this.updateDashboardCache();

    console.log('Security metric recorded:', {
      type: metricType,
      severity: metric.severity,
      tenantId,
      value
    });

    return metric;
  }

  /**
   * Generate security alert based on metric patterns
   */
  async createAlert(
    metricType: SecurityMetricType,
    severity: SecuritySeverity,
    title: string,
    description: string,
    tenantId?: string,
    affectedResources: string[] = [],
    recommendations: string[] = []
  ): Promise<SecurityAlert> {
    const alert: SecurityAlert = {
      id: this.generateAlertId(),
      tenantId,
      alertType: metricType,
      severity,
      title,
      description,
      recommendations,
      affectedResources,
      timestamp: new Date(),
      status: 'new'
    };

    // Store alert in Redis for immediate access
    const key = `${this.ALERTS_PREFIX}${tenantId || 'global'}`;
    await this.redis.lpush(key, JSON.stringify(alert));
    await this.redis.ltrim(key, 0, 499); // Keep last 500 alerts

    // Store in database
    await this.persistAlertToDatabase(alert);

    // Send notifications for high/critical alerts
    if (severity === SecuritySeverity.HIGH || severity === SecuritySeverity.CRITICAL) {
      await this.sendAlertNotifications(alert);
    }

    console.log('Security alert created:', {
      id: alert.id,
      severity,
      type: metricType,
      title
    });

    return alert;
  }

  /**
   * Get real-time security dashboard statistics
   */
  async getDashboardStats(): Promise<SecurityDashboardStats> {
    // Check cache first
    const cacheKey = `${this.DASHBOARD_CACHE_PREFIX}stats`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // Calculate stats
    const stats = await this.calculateDashboardStats();

    // Cache for 1 minute
    await this.redis.setex(cacheKey, 60, JSON.stringify(stats));

    return stats;
  }

  /**
   * Get active security alerts with filtering
   */
  async getActiveAlerts(
    tenantId?: string,
    severity?: SecuritySeverity,
    limit: number = 50
  ): Promise<SecurityAlert[]> {
    const key = tenantId ? `${this.ALERTS_PREFIX}${tenantId}` : `${this.ALERTS_PREFIX}global`;
    const alertsData = await this.redis.lrange(key, 0, limit - 1);

    let alerts: SecurityAlert[] = alertsData
      .map(data => JSON.parse(data))
      .filter(alert => alert.status === 'new' || alert.status === 'investigating');

    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }

    return alerts.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Get security metrics for time period
   */
  async getMetrics(
    metricType: SecurityMetricType,
    tenantId?: string,
    hours: number = 24
  ): Promise<SecurityMetric[]> {
    const key = `${this.METRICS_PREFIX}${metricType}:${tenantId || 'global'}`;
    const metricsData = await this.redis.lrange(key, 0, -1);

    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return metricsData
      .map(data => JSON.parse(data))
      .filter(metric => new Date(metric.timestamp) > cutoffTime)
      .sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }

  /**
   * Update alert status
   */
  async updateAlertStatus(
    alertId: string,
    status: SecurityAlert['status'],
    assignedTo?: string,
    resolutionNotes?: string
  ): Promise<void> {
    // Update in database
    const prisma = getMasterPrisma();
    await prisma.securityAlert.update({
      where: { id: alertId },
      data: {
        status,
        assignedTo,
        resolutionNotes,
        updatedAt: new Date()
      }
    });

    // Invalidate dashboard cache
    await this.redis.del(`${this.DASHBOARD_CACHE_PREFIX}stats`);

    console.log('Alert status updated:', { alertId, status });
  }

  /**
   * Get tenant risk score based on recent security metrics
   */
  async getTenantRiskScore(tenantId: string): Promise<number> {
    const metrics = await this.getMetrics(SecurityMetricType.FAILED_LOGIN_ATTEMPTS, tenantId, 24);
    const suspiciousTransactions = await this.getMetrics(SecurityMetricType.SUSPICIOUS_TRANSACTIONS, tenantId, 24);
    const rateLimitViolations = await this.getMetrics(SecurityMetricType.RATE_LIMIT_VIOLATIONS, tenantId, 24);

    let riskScore = 0;

    // Failed login attempts (0-30 points)
    riskScore += Math.min(metrics.length * 2, 30);

    // Suspicious transactions (0-40 points)
    riskScore += Math.min(suspiciousTransactions.length * 5, 40);

    // Rate limit violations (0-20 points)
    riskScore += Math.min(rateLimitViolations.length * 3, 20);

    // Critical alerts (0-10 points)
    const criticalAlerts = await this.getActiveAlerts(tenantId, SecuritySeverity.CRITICAL);
    riskScore += Math.min(criticalAlerts.length * 10, 10);

    return Math.min(riskScore, 100); // Cap at 100
  }

  /**
   * Generate comprehensive security report
   */
  async generateSecurityReport(
    tenantId?: string,
    hours: number = 24
  ): Promise<{
    summary: {
      totalAlerts: number;
      criticalAlerts: number;
      riskScore: number;
      recommendedActions: string[];
    };
    metricsByType: Record<SecurityMetricType, SecurityMetric[]>;
    trendAnalysis: {
      type: SecurityMetricType;
      trend: 'increasing' | 'decreasing' | 'stable';
      percentageChange: number;
    }[];
  }> {
    const allMetricTypes = Object.values(SecurityMetricType);
    const metricsByType: Record<SecurityMetricType, SecurityMetric[]> = {} as any;

    // Collect metrics for each type
    for (const metricType of allMetricTypes) {
      metricsByType[metricType] = await this.getMetrics(metricType, tenantId, hours);
    }

    const alerts = await this.getActiveAlerts(tenantId);
    const criticalAlerts = alerts.filter(alert => alert.severity === SecuritySeverity.CRITICAL);
    const riskScore = tenantId ? await this.getTenantRiskScore(tenantId) : 0;

    // Calculate trends
    const trendAnalysis = await this.calculateTrends(metricsByType, hours);

    // Generate recommendations
    const recommendedActions = this.generateRecommendations(criticalAlerts, riskScore, trendAnalysis);

    return {
      summary: {
        totalAlerts: alerts.length,
        criticalAlerts: criticalAlerts.length,
        riskScore,
        recommendedActions
      },
      metricsByType,
      trendAnalysis
    };
  }

  /**
   * Track failed login attempts
   */
  async trackFailedLogin(
    tenantId: string,
    userId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    await this.recordMetric(
      SecurityMetricType.FAILED_LOGIN_ATTEMPTS,
      1,
      tenantId,
      { userId, ipAddress, userAgent }
    );
  }

  /**
   * Track rate limit violations
   */
  async trackRateLimitViolation(
    endpoint: string,
    ipAddress: string,
    tenantId?: string
  ): Promise<void> {
    await this.recordMetric(
      SecurityMetricType.RATE_LIMIT_VIOLATIONS,
      1,
      tenantId,
      { endpoint, ipAddress }
    );
  }

  /**
   * Track suspicious transaction patterns
   */
  async trackSuspiciousTransaction(
    tenantId: string,
    transactionId: string,
    suspicionReason: string,
    amount: number
  ): Promise<void> {
    await this.recordMetric(
      SecurityMetricType.SUSPICIOUS_TRANSACTIONS,
      amount,
      tenantId,
      { transactionId, suspicionReason }
    );
  }

  /**
   * Track price manipulation alerts
   */
  async trackPriceManipulationAlert(
    exchange: string,
    priceDeviation: number,
    affectedTrades: number
  ): Promise<void> {
    await this.recordMetric(
      SecurityMetricType.PRICE_MANIPULATION_ALERTS,
      priceDeviation,
      undefined,
      { exchange, affectedTrades }
    );
  }

  private generateMetricId(): string {
    return `metric_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private calculateSeverity(
    metricType: SecurityMetricType,
    value: number,
    metadata?: Record<string, any>
  ): SecuritySeverity {
    switch (metricType) {
      case SecurityMetricType.FAILED_LOGIN_ATTEMPTS:
        if (value >= 10) return SecuritySeverity.CRITICAL;
        if (value >= 5) return SecuritySeverity.HIGH;
        if (value >= 3) return SecuritySeverity.MEDIUM;
        return SecuritySeverity.LOW;

      case SecurityMetricType.SUSPICIOUS_TRANSACTIONS:
        if (value >= 50000) return SecuritySeverity.CRITICAL; // $50K+ AUD
        if (value >= 10000) return SecuritySeverity.HIGH; // AUSTRAC threshold
        if (value >= 5000) return SecuritySeverity.MEDIUM;
        return SecuritySeverity.LOW;

      case SecurityMetricType.PRICE_MANIPULATION_ALERTS:
        if (value >= 15) return SecuritySeverity.CRITICAL; // 15%+ deviation
        if (value >= 10) return SecuritySeverity.HIGH; // 10%+ deviation
        if (value >= 5) return SecuritySeverity.MEDIUM;
        return SecuritySeverity.LOW;

      case SecurityMetricType.TENANT_ISOLATION_BREACHES:
        return SecuritySeverity.CRITICAL; // Always critical

      case SecurityMetricType.JWT_TOKEN_ANOMALIES:
        if (value >= 5) return SecuritySeverity.HIGH;
        if (value >= 3) return SecuritySeverity.MEDIUM;
        return SecuritySeverity.LOW;

      default:
        if (value >= 10) return SecuritySeverity.HIGH;
        if (value >= 5) return SecuritySeverity.MEDIUM;
        return SecuritySeverity.LOW;
    }
  }

  private async evaluateAlertConditions(metric: SecurityMetric): Promise<void> {
    const { metricType, value, tenantId, severity } = metric;

    // Check for alert conditions
    switch (metricType) {
      case SecurityMetricType.FAILED_LOGIN_ATTEMPTS:
        if (value >= 5) {
          await this.createAlert(
            metricType,
            severity,
            'Multiple Failed Login Attempts Detected',
            `${value} failed login attempts detected${tenantId ? ` for tenant ${tenantId}` : ''}`,
            tenantId,
            ['authentication_system'],
            [
              'Review authentication logs for suspicious patterns',
              'Consider implementing additional security measures',
              'Monitor for potential brute force attacks'
            ]
          );
        }
        break;

      case SecurityMetricType.SUSPICIOUS_TRANSACTIONS:
        if (value >= 10000) { // AUSTRAC threshold
          await this.createAlert(
            metricType,
            severity,
            'Large Transaction Requires AUSTRAC Reporting',
            `Transaction of $${value} AUD detected, above $10,000 AUSTRAC threshold`,
            tenantId,
            ['compliance_system', 'transaction_monitoring'],
            [
              'Generate AUSTRAC Threshold Transaction Report (TTR)',
              'Verify customer identification details',
              'Review transaction for suspicious activity patterns'
            ]
          );
        }
        break;

      case SecurityMetricType.PRICE_MANIPULATION_ALERTS:
        if (value >= 10) {
          await this.createAlert(
            metricType,
            severity,
            'Price Manipulation Circuit Breaker Triggered',
            `${value}% price deviation detected, circuit breaker activated`,
            tenantId,
            ['trading_engine', 'price_feeds'],
            [
              'Halt automated trading temporarily',
              'Verify price feeds from multiple sources',
              'Investigate potential market manipulation'
            ]
          );
        }
        break;
    }
  }

  private async persistMetricToDatabase(metric: SecurityMetric): Promise<void> {
    try {
      const prisma = getMasterPrisma();
      await prisma.securityMetric.create({
        data: {
          id: metric.id,
          tenantId: metric.tenantId,
          metricType: metric.metricType,
          value: metric.value,
          metadata: metric.metadata as any,
          severity: metric.severity,
          status: metric.status,
          timestamp: metric.timestamp
        }
      });
    } catch (error) {
      console.error('Failed to persist security metric to database:', error);
    }
  }

  private async persistAlertToDatabase(alert: SecurityAlert): Promise<void> {
    try {
      const prisma = getMasterPrisma();
      await prisma.securityAlert.create({
        data: {
          id: alert.id,
          tenantId: alert.tenantId,
          alertType: alert.alertType,
          severity: alert.severity,
          title: alert.title,
          description: alert.description,
          recommendations: alert.recommendations as any,
          affectedResources: alert.affectedResources as any,
          status: alert.status,
          timestamp: alert.timestamp,
          assignedTo: alert.assignedTo,
          resolutionNotes: alert.resolutionNotes
        }
      });
    } catch (error) {
      console.error('Failed to persist security alert to database:', error);
    }
  }

  private async calculateDashboardStats(): Promise<SecurityDashboardStats> {
    const activeAlerts = await this.getActiveAlerts();
    const criticalAlerts = activeAlerts.filter(alert => alert.severity === SecuritySeverity.CRITICAL);
    const highSeverityAlerts = activeAlerts.filter(alert => alert.severity === SecuritySeverity.HIGH);

    // Calculate resolved alerts today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get top threats (simplified)
    const topThreats = await this.calculateTopThreats();

    // Calculate system health scores
    const systemHealth = await this.calculateSystemHealth();

    return {
      totalActiveAlerts: activeAlerts.length,
      criticalAlerts: criticalAlerts.length,
      highSeverityAlerts: highSeverityAlerts.length,
      resolvedToday: 0, // Would calculate from database
      averageResolutionTime: 0, // Would calculate from database
      topThreats,
      tenantRiskScores: [], // Would calculate for all tenants
      systemHealth
    };
  }

  private async calculateTopThreats(): Promise<SecurityDashboardStats['topThreats']> {
    const threats: Record<SecurityMetricType, number> = {} as any;
    
    for (const metricType of Object.values(SecurityMetricType)) {
      const metrics = await this.getMetrics(metricType, undefined, 24);
      threats[metricType] = metrics.length;
    }

    return Object.entries(threats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({
        type: type as SecurityMetricType,
        count,
        trend: 'stable' as const // Would calculate actual trend
      }));
  }

  private async calculateSystemHealth(): Promise<SecurityDashboardStats['systemHealth']> {
    return {
      authenticationHealth: 95, // Would calculate based on metrics
      apiHealth: 98,
      exchangeHealth: 92,
      complianceHealth: 99
    };
  }

  private async updateDashboardCache(): Promise<void> {
    await this.redis.del(`${this.DASHBOARD_CACHE_PREFIX}stats`);
  }

  private async sendAlertNotifications(alert: SecurityAlert): Promise<void> {
    // Implementation would send notifications via email, SMS, Slack, etc.
    console.log('Alert notification sent:', {
      id: alert.id,
      severity: alert.severity,
      title: alert.title
    });
  }

  private async calculateTrends(
    metricsByType: Record<SecurityMetricType, SecurityMetric[]>,
    hours: number
  ): Promise<Array<{
    type: SecurityMetricType;
    trend: 'increasing' | 'decreasing' | 'stable';
    percentageChange: number;
  }>> {
    // Simplified trend calculation
    return Object.entries(metricsByType).map(([type, metrics]) => ({
      type: type as SecurityMetricType,
      trend: 'stable' as const,
      percentageChange: 0
    }));
  }

  private generateRecommendations(
    criticalAlerts: SecurityAlert[],
    riskScore: number,
    trendAnalysis: any[]
  ): string[] {
    const recommendations: string[] = [];

    if (criticalAlerts.length > 0) {
      recommendations.push('Address all critical security alerts immediately');
    }

    if (riskScore > 70) {
      recommendations.push('Tenant risk score is high - implement additional monitoring');
    }

    if (riskScore > 50) {
      recommendations.push('Review and strengthen authentication policies');
    }

    return recommendations;
  }
}

// Export singleton instance
export const securityMetricsService = new SecurityMetricsService();