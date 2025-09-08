// LIQUID ABT - Alerting and Incident Management System
// PagerDuty, Slack, and email alerting with escalation paths

import { WebClient } from '@slack/web-api';
import { appLogger, LogCategory } from '../logging/logger';
import { LiquidSentry } from '../../sentry.server.config';

// Alert severity levels
export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Alert categories
export enum AlertCategory {
  SYSTEM = 'system',
  BUSINESS = 'business',
  SECURITY = 'security',
  COMPLIANCE = 'compliance',
  PERFORMANCE = 'performance'
}

// Alert interface
export interface Alert {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  category: AlertCategory;
  source: string;
  timestamp: number;
  context: Record<string, any>;
  resolved?: boolean;
  resolvedAt?: number;
  escalatedAt?: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

// Alert configuration
interface AlertConfig {
  enabled: boolean;
  severity: AlertSeverity;
  category: AlertCategory;
  escalationTimeMinutes: number;
  channels: Array<'slack' | 'email' | 'pagerduty' | 'sentry'>;
  runbook?: string;
}

// Pre-configured alert types
export const ALERT_CONFIGS: Record<string, AlertConfig> = {
  // Critical system alerts
  'bitcoin_purchase_failure_rate_high': {
    enabled: true,
    severity: AlertSeverity.CRITICAL,
    category: AlertCategory.BUSINESS,
    escalationTimeMinutes: 5,
    channels: ['slack', 'pagerduty', 'sentry'],
    runbook: 'https://docs.liquidtreasury.business/runbooks/bitcoin-purchase-failures'
  },
  
  'exchange_api_down': {
    enabled: true,
    severity: AlertSeverity.CRITICAL,
    category: AlertCategory.SYSTEM,
    escalationTimeMinutes: 2,
    channels: ['slack', 'pagerduty', 'sentry'],
    runbook: 'https://docs.liquidtreasury.business/runbooks/exchange-api-failures'
  },
  
  'database_connection_failed': {
    enabled: true,
    severity: AlertSeverity.CRITICAL,
    category: AlertCategory.SYSTEM,
    escalationTimeMinutes: 1,
    channels: ['slack', 'pagerduty', 'sentry'],
    runbook: 'https://docs.liquidtreasury.business/runbooks/database-failures'
  },
  
  // High severity alerts
  'api_response_time_high': {
    enabled: true,
    severity: AlertSeverity.HIGH,
    category: AlertCategory.PERFORMANCE,
    escalationTimeMinutes: 10,
    channels: ['slack', 'sentry'],
    runbook: 'https://docs.liquidtreasury.business/runbooks/performance-issues'
  },
  
  'error_rate_high': {
    enabled: true,
    severity: AlertSeverity.HIGH,
    category: AlertCategory.SYSTEM,
    escalationTimeMinutes: 10,
    channels: ['slack', 'sentry']
  },
  
  'large_transaction_compliance': {
    enabled: true,
    severity: AlertSeverity.HIGH,
    category: AlertCategory.COMPLIANCE,
    escalationTimeMinutes: 30,
    channels: ['slack', 'email'],
    runbook: 'https://docs.liquidtreasury.business/runbooks/compliance-reporting'
  },
  
  // Medium severity alerts
  'circuit_breaker_open': {
    enabled: true,
    severity: AlertSeverity.MEDIUM,
    category: AlertCategory.SYSTEM,
    escalationTimeMinutes: 15,
    channels: ['slack']
  },
  
  'rate_limit_exceeded': {
    enabled: true,
    severity: AlertSeverity.MEDIUM,
    category: AlertCategory.SECURITY,
    escalationTimeMinutes: 20,
    channels: ['slack']
  },
  
  // Low severity alerts
  'new_customer_signup': {
    enabled: true,
    severity: AlertSeverity.LOW,
    category: AlertCategory.BUSINESS,
    escalationTimeMinutes: 60,
    channels: ['slack']
  }
};

// Slack client
let slackClient: WebClient | null = null;

// Initialize Slack client
function getSlackClient(): WebClient | null {
  if (!slackClient && process.env.SLACK_BOT_TOKEN) {
    slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return slackClient;
}

export class AlertingSystem {
  private static instance: AlertingSystem;
  private activeAlerts: Map<string, Alert> = new Map();
  private escalationTimers: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    console.log('🚨 Alerting system initialized');
  }

  public static getInstance(): AlertingSystem {
    if (!AlertingSystem.instance) {
      AlertingSystem.instance = new AlertingSystem();
    }
    return AlertingSystem.instance;
  }

  /**
   * Trigger an alert
   */
  async triggerAlert(
    alertType: string,
    title: string,
    description: string,
    context: Record<string, any> = {}
  ): Promise<string> {
    const config = ALERT_CONFIGS[alertType];
    if (!config || !config.enabled) {
      console.log(`Alert ${alertType} is disabled, skipping`);
      return '';
    }

    const alertId = this.generateAlertId(alertType);
    const alert: Alert = {
      id: alertId,
      title,
      description,
      severity: config.severity,
      category: config.category,
      source: alertType,
      timestamp: Date.now(),
      context,
      resolved: false
    };

    // Store active alert
    this.activeAlerts.set(alertId, alert);

    // Log the alert
    appLogger.error(`Alert triggered: ${alertType}`, {
      category: LogCategory.SYSTEM,
      action: 'alert_triggered',
      metadata: {
        alertId,
        alertType,
        severity: alert.severity,
        ...context
      }
    });

    // Send notifications
    await this.sendNotifications(alert, config);

    // Set up escalation timer
    if (config.escalationTimeMinutes > 0) {
      const timer = setTimeout(() => {
        this.escalateAlert(alertId);
      }, config.escalationTimeMinutes * 60 * 1000);
      
      this.escalationTimers.set(alertId, timer);
    }

    return alertId;
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, resolvedBy?: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      console.warn(`Alert ${alertId} not found`);
      return;
    }

    alert.resolved = true;
    alert.resolvedAt = Date.now();

    // Clear escalation timer
    const timer = this.escalationTimers.get(alertId);
    if (timer) {
      clearTimeout(timer);
      this.escalationTimers.delete(alertId);
    }

    // Log resolution
    appLogger.info(`Alert resolved: ${alert.source}`, {
      category: LogCategory.SYSTEM,
      action: 'alert_resolved',
      metadata: {
        alertId,
        resolvedBy,
        duration: alert.resolvedAt - alert.timestamp
      }
    });

    // Send resolution notification
    await this.sendResolutionNotification(alert, resolvedBy);

    // Remove from active alerts after a delay
    setTimeout(() => {
      this.activeAlerts.delete(alertId);
    }, 60 * 60 * 1000); // Keep for 1 hour for reference
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      console.warn(`Alert ${alertId} not found`);
      return;
    }

    alert.acknowledgedAt = Date.now();
    alert.acknowledgedBy = acknowledgedBy;

    // Clear escalation timer since alert is acknowledged
    const timer = this.escalationTimers.get(alertId);
    if (timer) {
      clearTimeout(timer);
      this.escalationTimers.delete(alertId);
    }

    appLogger.info(`Alert acknowledged: ${alert.source}`, {
      category: LogCategory.SYSTEM,
      action: 'alert_acknowledged',
      metadata: {
        alertId,
        acknowledgedBy
      }
    });
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
  }

  /**
   * Get alert statistics
   */
  getAlertStatistics(): {
    total: number;
    active: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    const alerts = Array.from(this.activeAlerts.values());
    const active = alerts.filter(a => !a.resolved);

    const byCategory = alerts.reduce((acc, alert) => {
      acc[alert.category] = (acc[alert.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const bySeverity = alerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: alerts.length,
      active: active.length,
      byCategory,
      bySeverity
    };
  }

  // Specific alert triggers

  /**
   * Bitcoin purchase failure alert
   */
  async alertBitcoinPurchaseFailures(failureRate: number, totalFailed: number): Promise<string> {
    return this.triggerAlert(
      'bitcoin_purchase_failure_rate_high',
      `Bitcoin Purchase Failure Rate: ${(failureRate * 100).toFixed(1)}%`,
      `Bitcoin purchase failure rate is ${(failureRate * 100).toFixed(1)}% (${totalFailed} failures). This exceeds the 5% threshold.`,
      {
        failureRate,
        totalFailed,
        threshold: 0.05
      }
    );
  }

  /**
   * Exchange API down alert
   */
  async alertExchangeApiDown(exchangeName: string, error: string): Promise<string> {
    return this.triggerAlert(
      'exchange_api_down',
      `${exchangeName} Exchange API Down`,
      `The ${exchangeName} exchange API is not responding. Error: ${error}`,
      {
        exchangeName,
        error,
        impact: 'Bitcoin purchases are affected'
      }
    );
  }

  /**
   * Database connection failure alert
   */
  async alertDatabaseConnectionFailed(error: string): Promise<string> {
    return this.triggerAlert(
      'database_connection_failed',
      'Database Connection Failed',
      `Unable to connect to the PostgreSQL database. Error: ${error}`,
      {
        error,
        impact: 'All database operations are affected'
      }
    );
  }

  /**
   * API response time alert
   */
  async alertHighApiResponseTime(averageTime: number, p95Time: number): Promise<string> {
    return this.triggerAlert(
      'api_response_time_high',
      `High API Response Times: ${p95Time}ms P95`,
      `API response times are elevated. P95: ${p95Time}ms, Average: ${averageTime}ms`,
      {
        averageTime,
        p95Time,
        threshold: 2000
      }
    );
  }

  /**
   * Large transaction compliance alert
   */
  async alertLargeTransaction(
    tenantId: string,
    amount: number,
    currency: string
  ): Promise<string> {
    return this.triggerAlert(
      'large_transaction_compliance',
      `Large Transaction: ${currency} ${amount.toLocaleString()}`,
      `Large transaction requires compliance review. Amount: ${currency} ${amount.toLocaleString()}`,
      {
        tenantId,
        amount,
        currency,
        complianceRequired: true
      }
    );
  }

  // Private methods

  private generateAlertId(alertType: string): string {
    const timestamp = Date.now();
    return `${alertType}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async sendNotifications(alert: Alert, config: AlertConfig): Promise<void> {
    const promises = config.channels.map(channel => {
      switch (channel) {
        case 'slack':
          return this.sendSlackNotification(alert, config);
        case 'email':
          return this.sendEmailNotification(alert, config);
        case 'pagerduty':
          return this.sendPagerDutyNotification(alert, config);
        case 'sentry':
          return this.sendSentryNotification(alert, config);
        default:
          return Promise.resolve();
      }
    });

    try {
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Failed to send alert notifications:', error);
    }
  }

  private async sendSlackNotification(alert: Alert, config: AlertConfig): Promise<void> {
    const slack = getSlackClient();
    if (!slack) {
      console.warn('Slack client not configured');
      return;
    }

    const color = this.getSeverityColor(alert.severity);
    const channel = this.getSlackChannel(alert.category);

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚨 ${alert.title}`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Severity:* ${alert.severity.toUpperCase()}`
          },
          {
            type: 'mrkdwn',
            text: `*Category:* ${alert.category}`
          },
          {
            type: 'mrkdwn',
            text: `*Time:* ${new Date(alert.timestamp).toISOString()}`
          },
          {
            type: 'mrkdwn',
            text: `*Alert ID:* ${alert.id}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: alert.description
        }
      }
    ];

    if (config.runbook) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📚 <${config.runbook}|View Runbook>`
        }
      });
    }

    if (Object.keys(alert.context).length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Context:*\n\`\`\`${JSON.stringify(alert.context, null, 2)}\`\`\``
        }
      });
    }

    try {
      await slack.chat.postMessage({
        channel,
        blocks,
        attachments: [
          {
            color,
            fallback: `${alert.severity.toUpperCase()}: ${alert.title}`
          }
        ]
      });
    } catch (error) {
      console.error('Failed to send Slack notification:', error);
    }
  }

  private async sendEmailNotification(alert: Alert, config: AlertConfig): Promise<void> {
    // Email notification implementation would go here
    // For now, just log that we would send an email
    console.log(`📧 Would send email for alert: ${alert.id}`);
  }

  private async sendPagerDutyNotification(alert: Alert, config: AlertConfig): Promise<void> {
    // PagerDuty integration would go here
    // For now, just log that we would create a PagerDuty incident
    console.log(`📟 Would create PagerDuty incident for alert: ${alert.id}`);
  }

  private async sendSentryNotification(alert: Alert, config: AlertConfig): Promise<void> {
    try {
      LiquidSentry.captureApiError(new Error(alert.description), {
        endpoint: alert.source,
        statusCode: alert.severity === AlertSeverity.CRITICAL ? 500 : 400,
        ...alert.context
      });
    } catch (error) {
      console.error('Failed to send Sentry notification:', error);
    }
  }

  private async sendResolutionNotification(alert: Alert, resolvedBy?: string): Promise<void> {
    const slack = getSlackClient();
    if (!slack) return;

    const channel = this.getSlackChannel(alert.category);

    try {
      await slack.chat.postMessage({
        channel,
        text: `✅ Alert resolved: ${alert.title}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Alert Resolved*\n*${alert.title}*\nResolved by: ${resolvedBy || 'System'}\nDuration: ${this.formatDuration(alert.timestamp, alert.resolvedAt!)}`
            }
          }
        ]
      });
    } catch (error) {
      console.error('Failed to send resolution notification:', error);
    }
  }

  private async escalateAlert(alertId: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.resolved || alert.acknowledgedAt) {
      return; // Alert was resolved or acknowledged
    }

    alert.escalatedAt = Date.now();

    appLogger.warn(`Alert escalated: ${alert.source}`, {
      category: LogCategory.SYSTEM,
      action: 'alert_escalated',
      metadata: {
        alertId,
        originalTimestamp: alert.timestamp
      }
    });

    // Send escalation notification
    const slack = getSlackClient();
    if (slack) {
      const channel = '#critical-alerts'; // Escalate to critical channel
      
      await slack.chat.postMessage({
        channel,
        text: `🆘 ESCALATED: ${alert.title}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🆘 ALERT ESCALATION',
              emoji: true
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${alert.title}*\n${alert.description}\n\n⏰ *Unacknowledged for:* ${this.formatDuration(alert.timestamp, Date.now())}`
            }
          }
        ]
      });
    }
  }

  private getSeverityColor(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL: return '#ff0000';
      case AlertSeverity.HIGH: return '#ff8800';
      case AlertSeverity.MEDIUM: return '#ffaa00';
      case AlertSeverity.LOW: return '#00aa00';
      default: return '#808080';
    }
  }

  private getSlackChannel(category: AlertCategory): string {
    switch (category) {
      case AlertCategory.BUSINESS: return '#business-alerts';
      case AlertCategory.SYSTEM: return '#system-alerts';
      case AlertCategory.SECURITY: return '#security-alerts';
      case AlertCategory.COMPLIANCE: return '#compliance-alerts';
      case AlertCategory.PERFORMANCE: return '#performance-alerts';
      default: return '#general-alerts';
    }
  }

  private formatDuration(start: number, end: number): string {
    const diff = end - start;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else {
      return `${minutes}m`;
    }
  }
}

// Singleton instance
export const alertingSystem = AlertingSystem.getInstance();