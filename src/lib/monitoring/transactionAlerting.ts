// LIQUID ABT - Large Transaction Alerting System
// Implementation of threat model $10K+ transaction monitoring

import { tenantSchemaManager } from '@/lib/database/connection';
import { createRedisCache } from '../cache/redisClient';

export interface TransactionAlert {
  id: string;
  tenantId: string;
  userId: string;
  transactionId: string;
  amount: number;
  currency: string;
  alertType: 'large_transaction' | 'velocity_anomaly' | 'unusual_pattern' | 'suspicious_activity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  metadata: Record<string, any>;
  createdAt: Date;
  status: 'open' | 'acknowledged' | 'resolved' | 'false_positive';
  acknowledgedBy?: string;
  resolvedAt?: Date;
}

export interface AlertingRule {
  name: string;
  enabled: boolean;
  subscriptionTier: 'starter' | 'growth' | 'pro' | 'enterprise';
  conditions: {
    singleTransactionThreshold: number; // $10,000 AUD AUSTRAC threshold
    internalAlertThreshold: number; // Tier-based internal threshold
    velocityThreshold: {
      amount: number;
      timeWindowMs: number;
    };
    patternDetection: {
      enabled: boolean;
      suspiciousPatterns: string[];
    };
  };
  notifications: {
    email: boolean;
    slack: boolean;
    sms: boolean;
    webhook?: string;
  };
}

export interface VelocityMetrics {
  last1Hour: number;
  last24Hours: number;
  last7Days: number;
  transactionCount: number;
  averageAmount: number;
  unusualActivity: boolean;
}

export class TransactionAlertingManager {
  private redis = createRedisCache();
  
  // Tier-based alerting rules per subscription level
  private readonly TIER_BASED_RULES = {
    starter: {
      name: 'Starter_Tier_Monitoring',
      enabled: true,
      subscriptionTier: 'starter' as const,
      conditions: {
        singleTransactionThreshold: 10000, // AUSTRAC threshold
        internalAlertThreshold: 5000, // Alert at $5K for free tier
        velocityThreshold: {
          amount: 15000, // $15K velocity for starter
          timeWindowMs: 24 * 60 * 60 * 1000
        },
        patternDetection: {
          enabled: true,
          suspiciousPatterns: [
            'round_number_sequence',
            'split_transactions',
            'rapid_succession'
          ]
        }
      },
      notifications: {
        email: true,
        slack: false,
        sms: false
      }
    },
    growth: {
      name: 'Growth_Tier_Monitoring',
      enabled: true,
      subscriptionTier: 'growth' as const,
      conditions: {
        singleTransactionThreshold: 10000, // AUSTRAC threshold
        internalAlertThreshold: 25000, // Alert at $25K for growth
        velocityThreshold: {
          amount: 100000, // $100K velocity for growth
          timeWindowMs: 24 * 60 * 60 * 1000
        },
        patternDetection: {
          enabled: true,
          suspiciousPatterns: [
            'round_number_sequence',
            'split_transactions',
            'unusual_timing',
            'rapid_succession'
          ]
        }
      },
      notifications: {
        email: true,
        slack: true,
        sms: false
      }
    },
    pro: {
      name: 'Pro_Tier_Monitoring',
      enabled: true,
      subscriptionTier: 'pro' as const,
      conditions: {
        singleTransactionThreshold: 10000, // AUSTRAC threshold
        internalAlertThreshold: 50000, // Alert at $50K for pro
        velocityThreshold: {
          amount: 500000, // $500K velocity for pro
          timeWindowMs: 24 * 60 * 60 * 1000
        },
        patternDetection: {
          enabled: true,
          suspiciousPatterns: [
            'round_number_sequence',
            'split_transactions',
            'unusual_timing',
            'rapid_succession',
            'geographic_anomaly'
          ]
        }
      },
      notifications: {
        email: true,
        slack: true,
        sms: true // SMS for high-tier customers
      }
    },
    enterprise: {
      name: 'Enterprise_Tier_Monitoring',
      enabled: true,
      subscriptionTier: 'enterprise' as const,
      conditions: {
        singleTransactionThreshold: 10000, // AUSTRAC threshold
        internalAlertThreshold: 100000, // Alert at $100K for enterprise
        velocityThreshold: {
          amount: 2000000, // $2M velocity for enterprise
          timeWindowMs: 24 * 60 * 60 * 1000
        },
        patternDetection: {
          enabled: true,
          suspiciousPatterns: [
            'round_number_sequence',
            'split_transactions',
            'unusual_timing',
            'rapid_succession',
            'geographic_anomaly'
          ]
        }
      },
      notifications: {
        email: true,
        slack: true,
        sms: true,
        webhook: process.env.ENTERPRISE_ALERT_WEBHOOK // Custom webhook for enterprise
      }
    }
  };

  private readonly REDIS_PREFIX = 'transaction_alerts';
  private readonly VELOCITY_PREFIX = 'transaction_velocity';

  /**
   * Monitor transaction for alerting conditions
   */
  async monitorTransaction(
    tenantId: string,
    userId: string,
    transactionData: {
      transactionId: string;
      amount: number;
      currency: string;
      type: 'payment' | 'bitcoin_purchase' | 'withdrawal';
      metadata?: Record<string, any>;
    }
  ): Promise<TransactionAlert[]> {
    const alerts: TransactionAlert[] = [];

    try {
      // Get tenant-specific alerting rules
      const rules = await this.getAlertingRules(tenantId);

      // Check tier-based internal threshold first
      if (transactionData.amount >= rules.conditions.internalAlertThreshold) {
        const alert = await this.createAlert(tenantId, userId, {
          transactionId: transactionData.transactionId,
          amount: transactionData.amount,
          currency: transactionData.currency,
          alertType: 'large_transaction',
          severity: this.determineSeverity(transactionData.amount, rules.conditions.internalAlertThreshold),
          description: `Large transaction alert (${rules.subscriptionTier} tier): ${transactionData.currency} ${transactionData.amount.toLocaleString()}`,
          metadata: {
            ...transactionData.metadata,
            alertType: 'internal_threshold',
            threshold: rules.conditions.internalAlertThreshold,
            subscriptionTier: rules.subscriptionTier,
            ratio: transactionData.amount / rules.conditions.internalAlertThreshold
          }
        });
        alerts.push(alert);
      }

      // Check AUSTRAC reporting threshold (always $10K AUD)
      if (transactionData.amount >= rules.conditions.singleTransactionThreshold) {
        const alert = await this.createAlert(tenantId, userId, {
          transactionId: transactionData.transactionId,
          amount: transactionData.amount,
          currency: transactionData.currency,
          alertType: 'large_transaction',
          severity: this.determineSeverity(transactionData.amount, rules.conditions.singleTransactionThreshold),
          description: `AUSTRAC reporting threshold exceeded: ${transactionData.currency} ${transactionData.amount.toLocaleString()}`,
          metadata: {
            ...transactionData.metadata,
            alertType: 'austrac_threshold',
            threshold: rules.conditions.singleTransactionThreshold,
            subscriptionTier: rules.subscriptionTier,
            ratio: transactionData.amount / rules.conditions.singleTransactionThreshold,
            complianceRequired: true
          }
        });
        alerts.push(alert);
      }

      // Check velocity patterns
      const velocityAlert = await this.checkVelocityPattern(tenantId, userId, transactionData, rules);
      if (velocityAlert) {
        alerts.push(velocityAlert);
      }

      // Check for suspicious patterns
      if (rules.conditions.patternDetection.enabled) {
        const patternAlerts = await this.detectSuspiciousPatterns(tenantId, userId, transactionData, rules);
        alerts.push(...patternAlerts);
      }

      // Update velocity metrics
      await this.updateVelocityMetrics(tenantId, userId, transactionData);

      // Send notifications for new alerts
      for (const alert of alerts) {
        await this.sendAlertNotifications(alert, rules.notifications);
      }

      if (alerts.length > 0) {
        console.warn('Transaction alerts generated:', {
          tenantId,
          userId,
          transactionId: transactionData.transactionId,
          alertCount: alerts.length,
          alertTypes: alerts.map(a => a.alertType)
        });
      }

      return alerts;

    } catch (error) {
      console.error('Transaction monitoring failed:', error);
      return [];
    }
  }

  /**
   * Check velocity-based alerting patterns
   */
  private async checkVelocityPattern(
    tenantId: string,
    userId: string,
    transactionData: any,
    rules: AlertingRule
  ): Promise<TransactionAlert | null> {
    const velocityMetrics = await this.getVelocityMetrics(tenantId, userId);
    const currentVelocity = velocityMetrics.last24Hours + transactionData.amount;

    if (currentVelocity >= rules.conditions.velocityThreshold.amount) {
      return this.createAlert(tenantId, userId, {
        transactionId: transactionData.transactionId,
        amount: transactionData.amount,
        currency: transactionData.currency,
        alertType: 'velocity_anomaly',
        severity: 'high',
        description: `High transaction velocity: ${transactionData.currency} ${currentVelocity.toLocaleString()} in 24h`,
        metadata: {
          velocityMetrics,
          threshold: rules.conditions.velocityThreshold.amount,
          currentVelocity
        }
      });
    }

    return null;
  }

  /**
   * Detect suspicious transaction patterns
   */
  private async detectSuspiciousPatterns(
    tenantId: string,
    userId: string,
    transactionData: any,
    rules: AlertingRule
  ): Promise<TransactionAlert[]> {
    const alerts: TransactionAlert[] = [];

    // Get recent transactions for pattern analysis
    const recentTransactions = await this.getRecentTransactions(tenantId, userId, 24 * 60 * 60 * 1000); // 24 hours

    // Pattern 1: Split transactions (multiple transactions just under threshold)
    const nearThresholdTransactions = recentTransactions.filter(
      t => t.amount > rules.conditions.singleTransactionThreshold * 0.8 &&
           t.amount < rules.conditions.singleTransactionThreshold
    );

    if (nearThresholdTransactions.length >= 3) {
      alerts.push(await this.createAlert(tenantId, userId, {
        transactionId: transactionData.transactionId,
        amount: transactionData.amount,
        currency: transactionData.currency,
        alertType: 'suspicious_activity',
        severity: 'medium',
        description: `Potential split transaction pattern detected: ${nearThresholdTransactions.length} transactions near threshold`,
        metadata: {
          pattern: 'split_transactions',
          nearThresholdCount: nearThresholdTransactions.length,
          threshold: rules.conditions.singleTransactionThreshold
        }
      }));
    }

    // Pattern 2: Rapid succession of large transactions
    const last5Minutes = recentTransactions.filter(
      t => Date.now() - t.timestamp.getTime() < 5 * 60 * 1000
    );

    if (last5Minutes.length >= 3 && last5Minutes.some(t => t.amount > 5000)) {
      alerts.push(await this.createAlert(tenantId, userId, {
        transactionId: transactionData.transactionId,
        amount: transactionData.amount,
        currency: transactionData.currency,
        alertType: 'unusual_pattern',
        severity: 'medium',
        description: `Rapid succession of transactions: ${last5Minutes.length} transactions in 5 minutes`,
        metadata: {
          pattern: 'rapid_succession',
          transactionCount: last5Minutes.length,
          timeWindow: '5_minutes'
        }
      }));
    }

    // Pattern 3: Round number sequences (potential structuring)
    const roundNumbers = recentTransactions.filter(t => t.amount % 1000 === 0);
    if (roundNumbers.length >= 5) {
      alerts.push(await this.createAlert(tenantId, userId, {
        transactionId: transactionData.transactionId,
        amount: transactionData.amount,
        currency: transactionData.currency,
        alertType: 'suspicious_activity',
        severity: 'high',
        description: `Suspicious round number pattern: ${roundNumbers.length} transactions in round amounts`,
        metadata: {
          pattern: 'round_number_sequence',
          roundNumberCount: roundNumbers.length,
          amounts: roundNumbers.map(t => t.amount)
        }
      }));
    }

    return alerts;
  }

  /**
   * Create and store transaction alert
   */
  private async createAlert(
    tenantId: string,
    userId: string,
    alertData: Omit<TransactionAlert, 'id' | 'tenantId' | 'userId' | 'createdAt' | 'status'>
  ): Promise<TransactionAlert> {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const alert: TransactionAlert = {
      id: alertId,
      tenantId,
      userId,
      createdAt: new Date(),
      status: 'open',
      ...alertData
    };

    // Store in database
    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO transaction_alerts (
        id, user_id, transaction_id, amount, currency, alert_type, severity,
        description, metadata, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        alert.id,
        alert.userId,
        alert.transactionId,
        alert.amount,
        alert.currency,
        alert.alertType,
        alert.severity,
        alert.description,
        JSON.stringify(alert.metadata),
        alert.status
      ]
    );

    // Store in Redis for quick access
    const alertKey = `${this.REDIS_PREFIX}:${tenantId}:${alertId}`;
    await this.redis.setex(alertKey, 7 * 24 * 60 * 60, JSON.stringify(alert)); // 7 days

    return alert;
  }

  /**
   * Get velocity metrics for user
   */
  private async getVelocityMetrics(tenantId: string, userId: string): Promise<VelocityMetrics> {
    const velocityKey = `${this.VELOCITY_PREFIX}:${tenantId}:${userId}`;
    const metricsData = await this.redis.get(velocityKey);

    if (metricsData) {
      return JSON.parse(metricsData);
    }

    // Calculate from database if not in cache
    const now = Date.now();
    const [last1Hour, last24Hours, last7Days] = await Promise.all([
      this.getTransactionSum(tenantId, userId, now - 60 * 60 * 1000),
      this.getTransactionSum(tenantId, userId, now - 24 * 60 * 60 * 1000),
      this.getTransactionSum(tenantId, userId, now - 7 * 24 * 60 * 60 * 1000)
    ]);

    const metrics: VelocityMetrics = {
      last1Hour: last1Hour.sum,
      last24Hours: last24Hours.sum,
      last7Days: last7Days.sum,
      transactionCount: last24Hours.count,
      averageAmount: last24Hours.count > 0 ? last24Hours.sum / last24Hours.count : 0,
      unusualActivity: last1Hour.sum > last24Hours.sum * 0.5 // 50% of daily volume in 1 hour
    };

    // Cache for 5 minutes
    await this.redis.setex(velocityKey, 300, JSON.stringify(metrics));

    return metrics;
  }

  /**
   * Update velocity metrics in cache
   */
  private async updateVelocityMetrics(
    tenantId: string,
    userId: string,
    transactionData: any
  ): Promise<void> {
    const metrics = await this.getVelocityMetrics(tenantId, userId);
    
    // Update metrics
    metrics.last1Hour += transactionData.amount;
    metrics.last24Hours += transactionData.amount;
    metrics.last7Days += transactionData.amount;
    metrics.transactionCount += 1;
    metrics.averageAmount = metrics.last24Hours / metrics.transactionCount;
    
    const velocityKey = `${this.VELOCITY_PREFIX}:${tenantId}:${userId}`;
    await this.redis.setex(velocityKey, 300, JSON.stringify(metrics));
  }

  /**
   * Send alert notifications
   */
  private async sendAlertNotifications(
    alert: TransactionAlert,
    notificationConfig: AlertingRule['notifications']
  ): Promise<void> {
    // TODO: Integrate with actual notification services
    // This is a placeholder for notification implementation
    
    console.log('Alert notification:', {
      alertId: alert.id,
      severity: alert.severity,
      description: alert.description,
      channels: {
        email: notificationConfig.email,
        slack: notificationConfig.slack,
        sms: notificationConfig.sms
      }
    });

    // In production, implement:
    // - Email notifications (SendGrid, AWS SES)
    // - Slack webhook notifications
    // - SMS notifications (Twilio) for critical alerts
    // - Custom webhook notifications
  }

  /**
   * Get alerting rules for tenant based on subscription tier
   */
  private async getAlertingRules(tenantId: string): Promise<AlertingRule> {
    try {
      // Get tenant's subscription tier from database
      const tierResult = await tenantSchemaManager.queryTenantSchema(
        tenantId,
        `SELECT subscription_tier FROM tenants WHERE id = $1`,
        [tenantId]
      );

      const subscriptionTier = tierResult[0]?.subscription_tier || 'starter';
      
      // Return tier-specific rules
      const rules = this.TIER_BASED_RULES[subscriptionTier as keyof typeof this.TIER_BASED_RULES];
      
      if (!rules) {
        console.warn(`Unknown subscription tier: ${subscriptionTier}, defaulting to starter`);
        return this.TIER_BASED_RULES.starter;
      }

      console.log(`Using ${subscriptionTier} tier alerting rules for tenant:`, tenantId);
      return rules;

    } catch (error) {
      console.error('Failed to get tenant subscription tier, defaulting to starter:', error);
      return this.TIER_BASED_RULES.starter;
    }
  }

  /**
   * Get recent transactions for pattern analysis
   */
  private async getRecentTransactions(
    tenantId: string,
    userId: string,
    timeWindowMs: number
  ): Promise<Array<{ amount: number; timestamp: Date; transactionId: string }>> {
    const cutoff = new Date(Date.now() - timeWindowMs);
    
    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `SELECT amount, created_at, id FROM transactions 
       WHERE user_id = $1 AND created_at >= $2 
       ORDER BY created_at DESC LIMIT 50`,
      [userId, cutoff]
    );

    return result.map(row => ({
      amount: parseFloat(row.amount),
      timestamp: new Date(row.created_at),
      transactionId: row.id
    }));
  }

  /**
   * Get transaction sum and count for time period
   */
  private async getTransactionSum(
    tenantId: string,
    userId: string,
    since: number
  ): Promise<{ sum: number; count: number }> {
    const cutoff = new Date(since);
    
    const result = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `SELECT COALESCE(SUM(amount), 0) as sum, COUNT(*) as count
       FROM transactions 
       WHERE user_id = $1 AND created_at >= $2`,
      [userId, cutoff]
    );

    return {
      sum: parseFloat(result[0]?.sum || 0),
      count: parseInt(result[0]?.count || 0)
    };
  }

  /**
   * Determine alert severity based on amount and threshold
   */
  private determineSeverity(amount: number, threshold: number): TransactionAlert['severity'] {
    const ratio = amount / threshold;
    
    if (ratio >= 10) return 'critical'; // 10x threshold
    if (ratio >= 5) return 'high';     // 5x threshold
    if (ratio >= 2) return 'medium';   // 2x threshold
    return 'low';                      // Just above threshold
  }
}

// Export singleton instance
export const transactionAlertingManager = new TransactionAlertingManager();