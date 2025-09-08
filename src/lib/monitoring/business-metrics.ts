// LIQUID ABT - Business Metrics and KPI Tracking
// Custom metrics for business events, Bitcoin purchases, and operational monitoring

import { metricsCollector } from './metrics';
import { appLogger, LogCategory } from '../logging/logger';
import { LiquidSentry } from '../../sentry.server.config';

// Business KPI thresholds
const KPI_THRESHOLDS = {
  bitcoin_purchase_success_rate: 0.95, // 95% minimum
  api_response_time_p95: 2000, // 2 seconds
  daily_transaction_volume: 10000, // $10K AUD minimum
  customer_satisfaction_score: 4.0, // Out of 5
  system_uptime: 0.999, // 99.9%
};

// Business event types
export enum BusinessEvent {
  USER_REGISTRATION = 'user_registration',
  FIRST_PURCHASE = 'first_purchase',
  LARGE_PURCHASE = 'large_purchase', // >$10K
  TREASURY_RULE_CREATED = 'treasury_rule_created',
  TREASURY_RULE_TRIGGERED = 'treasury_rule_triggered',
  WEBHOOK_INTEGRATION = 'webhook_integration',
  COMPLIANCE_ALERT = 'compliance_alert',
  CUSTOMER_SUPPORT_TICKET = 'customer_support_ticket',
  SUBSCRIPTION_UPGRADE = 'subscription_upgrade',
  SUBSCRIPTION_DOWNGRADE = 'subscription_downgrade',
  CHURN_EVENT = 'churn_event'
}

// Business metrics interface
export interface BusinessMetrics {
  // Revenue metrics
  totalRevenueAUD: number;
  monthlyRecurringRevenue: number;
  averageRevenuePerUser: number;
  
  // Bitcoin metrics
  totalBitcoinPurchased: number;
  averagePurchaseSize: number;
  bitcoinPurchaseSuccessRate: number;
  
  // Customer metrics
  totalActiveCustomers: number;
  newCustomersThisMonth: number;
  customerRetentionRate: number;
  
  // Operational metrics
  systemUptime: number;
  averageApiResponseTime: number;
  errorRate: number;
}

export class BusinessMetricsCollector {
  private static instance: BusinessMetricsCollector;
  private dailyMetrics: Map<string, any> = new Map();
  private weeklyMetrics: Map<string, any> = new Map();
  private monthlyMetrics: Map<string, any> = new Map();

  private constructor() {
    // Initialize periodic metric calculation
    this.startPeriodicCalculations();
  }

  public static getInstance(): BusinessMetricsCollector {
    if (!BusinessMetricsCollector.instance) {
      BusinessMetricsCollector.instance = new BusinessMetricsCollector();
    }
    return BusinessMetricsCollector.instance;
  }

  /**
   * Record business event
   */
  recordBusinessEvent(
    event: BusinessEvent,
    tenantId?: string,
    metadata?: Record<string, any>
  ): void {
    const timestamp = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // Log the business event
    appLogger.info(`Business event: ${event}`, {
      category: LogCategory.SYSTEM,
      action: 'business_event',
      tenantId,
      metadata: {
        event,
        timestamp,
        ...metadata
      }
    });

    // Record in daily metrics
    const dailyKey = `${today}_${event}`;
    const currentCount = this.dailyMetrics.get(dailyKey) || 0;
    this.dailyMetrics.set(dailyKey, currentCount + 1);

    // Record specific event metrics
    this.recordSpecificEventMetrics(event, tenantId, metadata);
  }

  /**
   * Record Bitcoin purchase success/failure
   */
  recordBitcoinPurchaseResult(
    success: boolean,
    amountAUD: number,
    tenantId: string,
    exchangeProvider: string,
    duration: number,
    error?: Error
  ): void {
    // Use existing metrics collector
    metricsCollector.recordBitcoinPurchase(
      amountAUD,
      duration,
      success,
      exchangeProvider
    );

    // Record business event
    if (success) {
      this.recordBusinessEvent(
        amountAUD > 10000 ? BusinessEvent.LARGE_PURCHASE : BusinessEvent.FIRST_PURCHASE,
        tenantId,
        { amountAUD, exchangeProvider, duration }
      );
    } else {
      // Capture error in Sentry for failed purchases
      if (error) {
        LiquidSentry.captureBitcoinPurchaseError(error, {
          tenantId,
          amount: amountAUD,
          currency: 'AUD',
          exchangeProvider
        });
      }
    }

    // Check if success rate is below threshold
    const currentRate = this.calculateBitcoinPurchaseSuccessRate();
    if (currentRate < KPI_THRESHOLDS.bitcoin_purchase_success_rate) {
      this.triggerBusinessAlert('bitcoin_purchase_success_rate_low', {
        currentRate,
        threshold: KPI_THRESHOLDS.bitcoin_purchase_success_rate,
        tenantId
      });
    }
  }

  /**
   * Record customer lifecycle event
   */
  recordCustomerEvent(
    event: 'registration' | 'first_purchase' | 'upgrade' | 'downgrade' | 'churn',
    tenantId: string,
    metadata?: Record<string, any>
  ): void {
    const businessEventMap = {
      registration: BusinessEvent.USER_REGISTRATION,
      first_purchase: BusinessEvent.FIRST_PURCHASE,
      upgrade: BusinessEvent.SUBSCRIPTION_UPGRADE,
      downgrade: BusinessEvent.SUBSCRIPTION_DOWNGRADE,
      churn: BusinessEvent.CHURN_EVENT
    };

    this.recordBusinessEvent(businessEventMap[event], tenantId, metadata);
  }

  /**
   * Record treasury rule activity
   */
  recordTreasuryRuleActivity(
    action: 'created' | 'triggered' | 'modified' | 'disabled',
    tenantId: string,
    ruleName: string,
    ruleType: string,
    metadata?: Record<string, any>
  ): void {
    const event = action === 'created' ? 
      BusinessEvent.TREASURY_RULE_CREATED : 
      BusinessEvent.TREASURY_RULE_TRIGGERED;

    this.recordBusinessEvent(event, tenantId, {
      action,
      ruleName,
      ruleType,
      ...metadata
    });
  }

  /**
   * Record compliance and regulatory events
   */
  recordComplianceEvent(
    type: 'aml_check' | 'large_transaction_report' | 'suspicious_activity' | 'audit_log',
    tenantId?: string,
    metadata?: Record<string, any>
  ): void {
    appLogger.logAudit(`Compliance event: ${type}`, {
      tenantId,
      metadata: {
        complianceType: type,
        timestamp: Date.now(),
        ...metadata
      }
    });

    if (type === 'suspicious_activity') {
      this.recordBusinessEvent(BusinessEvent.COMPLIANCE_ALERT, tenantId, {
        alertType: type,
        ...metadata
      });
    }
  }

  /**
   * Get current business metrics summary
   */
  getBusinessMetricsSummary(): BusinessMetrics {
    const operationalMetrics = metricsCollector.getMetricsSummary();
    
    return {
      // Revenue metrics (would be calculated from database in real implementation)
      totalRevenueAUD: this.calculateTotalRevenue(),
      monthlyRecurringRevenue: this.calculateMRR(),
      averageRevenuePerUser: this.calculateARPU(),
      
      // Bitcoin metrics
      totalBitcoinPurchased: this.calculateTotalBitcoinPurchased(),
      averagePurchaseSize: operationalMetrics.bitcoinPurchases.averageAmount,
      bitcoinPurchaseSuccessRate: operationalMetrics.bitcoinPurchases.successRate,
      
      // Customer metrics
      totalActiveCustomers: this.calculateActiveCustomers(),
      newCustomersThisMonth: this.calculateNewCustomers(),
      customerRetentionRate: this.calculateRetentionRate(),
      
      // Operational metrics
      systemUptime: this.calculateUptime(),
      averageApiResponseTime: operationalMetrics.exchangeApi.averageResponseTime,
      errorRate: this.calculateErrorRate()
    };
  }

  /**
   * Get daily KPI dashboard data
   */
  getDailyKPIDashboard(): {
    date: string;
    kpis: Array<{
      name: string;
      value: number;
      threshold: number;
      status: 'healthy' | 'warning' | 'critical';
      trend: 'up' | 'down' | 'stable';
    }>;
  } {
    const today = new Date().toISOString().split('T')[0];
    const metrics = this.getBusinessMetricsSummary();

    const kpis = [
      {
        name: 'Bitcoin Purchase Success Rate',
        value: metrics.bitcoinPurchaseSuccessRate,
        threshold: KPI_THRESHOLDS.bitcoin_purchase_success_rate,
        status: metrics.bitcoinPurchaseSuccessRate >= KPI_THRESHOLDS.bitcoin_purchase_success_rate ? 'healthy' : 'critical',
        trend: this.calculateTrend('bitcoin_success_rate')
      },
      {
        name: 'API Response Time (P95)',
        value: metrics.averageApiResponseTime,
        threshold: KPI_THRESHOLDS.api_response_time_p95,
        status: metrics.averageApiResponseTime <= KPI_THRESHOLDS.api_response_time_p95 ? 'healthy' : 'warning',
        trend: this.calculateTrend('api_response_time')
      },
      {
        name: 'System Uptime',
        value: metrics.systemUptime,
        threshold: KPI_THRESHOLDS.system_uptime,
        status: metrics.systemUptime >= KPI_THRESHOLDS.system_uptime ? 'healthy' : 'critical',
        trend: this.calculateTrend('system_uptime')
      },
      {
        name: 'Daily Transaction Volume',
        value: this.calculateDailyTransactionVolume(),
        threshold: KPI_THRESHOLDS.daily_transaction_volume,
        status: this.calculateDailyTransactionVolume() >= KPI_THRESHOLDS.daily_transaction_volume ? 'healthy' : 'warning',
        trend: this.calculateTrend('daily_volume')
      }
    ] as any;

    return {
      date: today,
      kpis
    };
  }

  // Private helper methods

  private startPeriodicCalculations(): void {
    // Calculate metrics every 5 minutes
    setInterval(() => {
      this.calculateAndStoreMetrics();
    }, 5 * 60 * 1000);
  }

  private calculateAndStoreMetrics(): void {
    const metrics = this.getBusinessMetricsSummary();
    const timestamp = Date.now();

    // Store in time-series format for trending
    this.storeTimeSeriesMetric('business_metrics', timestamp, metrics);
  }

  private storeTimeSeriesMetric(key: string, timestamp: number, value: any): void {
    // In a real implementation, this would store in a time-series database
    // For now, we'll use in-memory storage with automatic cleanup
    
    const timeSeriesKey = `${key}_${Math.floor(timestamp / (60 * 60 * 1000))}`; // Hourly buckets
    this.dailyMetrics.set(timeSeriesKey, value);
  }

  private recordSpecificEventMetrics(
    event: BusinessEvent,
    tenantId?: string,
    metadata?: Record<string, any>
  ): void {
    switch (event) {
      case BusinessEvent.LARGE_PURCHASE:
        // Track high-value customers
        if (metadata?.amountAUD > 50000) {
          this.triggerBusinessAlert('high_value_transaction', {
            tenantId,
            amount: metadata.amountAUD
          });
        }
        break;
        
      case BusinessEvent.CHURN_EVENT:
        // Track churn for analysis
        this.triggerBusinessAlert('customer_churn', {
          tenantId,
          reason: metadata?.reason
        });
        break;
    }
  }

  private triggerBusinessAlert(
    alertType: string,
    context: Record<string, any>
  ): void {
    appLogger.warn(`Business alert: ${alertType}`, {
      category: LogCategory.SYSTEM,
      action: 'business_alert',
      metadata: {
        alertType,
        ...context
      }
    });

    // In a real implementation, this would trigger PagerDuty, Slack, etc.
    console.warn(`🚨 Business Alert: ${alertType}`, context);
  }

  // Calculation methods (these would query the database in a real implementation)
  private calculateBitcoinPurchaseSuccessRate(): number {
    return metricsCollector.getMetricsSummary().bitcoinPurchases.successRate;
  }

  private calculateTotalRevenue(): number {
    // Mock calculation - would query database
    return 125000; // $125K AUD
  }

  private calculateMRR(): number {
    // Mock calculation - would query database
    return 25000; // $25K AUD MRR
  }

  private calculateARPU(): number {
    // Mock calculation - would query database  
    return 85; // $85 AUD per user per month
  }

  private calculateTotalBitcoinPurchased(): number {
    // Mock calculation - would query database
    return 12.5; // 12.5 BTC total
  }

  private calculateActiveCustomers(): number {
    // Mock calculation - would query database
    return 1250;
  }

  private calculateNewCustomers(): number {
    // Mock calculation - would query database
    return 85;
  }

  private calculateRetentionRate(): number {
    // Mock calculation - would query database
    return 0.92; // 92%
  }

  private calculateUptime(): number {
    // Mock calculation - would calculate from health check logs
    return 0.9995; // 99.95%
  }

  private calculateErrorRate(): number {
    // Mock calculation - would calculate from API logs
    return 0.002; // 0.2%
  }

  private calculateDailyTransactionVolume(): number {
    // Mock calculation - would query today's transactions
    return 15000; // $15K AUD today
  }

  private calculateTrend(metric: string): 'up' | 'down' | 'stable' {
    // Mock trend calculation - would compare with historical data
    return 'stable';
  }
}

// Singleton instance
export const businessMetrics = BusinessMetricsCollector.getInstance();