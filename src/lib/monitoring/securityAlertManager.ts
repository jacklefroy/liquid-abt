// LIQUID ABT - Security Monitoring & Alerting System
// Implementation of comprehensive security event monitoring

import { createRedisCache } from '../cache/redisClient';

export interface SecurityEvent {
  id: string;
  type: 'PRICE_MANIPULATION' | 'SUSPICIOUS_TRANSACTION' | 'AUTH_FAILURE' | 'EXCHANGE_FAILURE' | 'SYSTEM_ERROR';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  tenantId?: string;
  userId?: string;
  metadata: Record<string, any>;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'sms' | 'webhook' | 'cloudwatch';
  enabled: boolean;
  config: Record<string, any>;
  minSeverity: SecurityEvent['severity'];
}

export interface MonitoringMetrics {
  totalEvents: number;
  criticalEvents: number;
  resolvedEvents: number;
  averageResolutionTime: number;
  topEventTypes: Array<{ type: string; count: number }>;
  recentEvents: SecurityEvent[];
}

export class SecurityAlertManager {
  private redis = createRedisCache();
  private readonly ALERT_CACHE_PREFIX = 'security_alerts';
  private readonly METRICS_PREFIX = 'security_metrics';
  private readonly ALERT_TTL = 30 * 24 * 60 * 60; // 30 days

  private alertChannels: AlertChannel[] = [
    {
      type: 'cloudwatch',
      enabled: true,
      config: {
        logGroup: process.env.CLOUDWATCH_LOG_GROUP || '/liquid-abt/security',
        region: 'ap-southeast-2'
      },
      minSeverity: 'MEDIUM'
    },
    {
      type: 'email',
      enabled: !!process.env.TRANSACTION_ALERT_EMAIL,
      config: {
        recipients: process.env.TRANSACTION_ALERT_EMAIL?.split(',') || [],
        service: 'ses' // AWS SES
      },
      minSeverity: 'HIGH'
    },
    {
      type: 'slack',
      enabled: !!process.env.SLACK_WEBHOOK_URL,
      config: {
        webhookUrl: process.env.SLACK_WEBHOOK_URL,
        channel: '#security-alerts'
      },
      minSeverity: 'HIGH'
    }
  ];

  /**
   * Create and dispatch a security alert
   */
  async createSecurityAlert(alert: Omit<SecurityEvent, 'id' | 'timestamp' | 'resolved'>): Promise<SecurityEvent> {
    const securityEvent: SecurityEvent = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      resolved: false,
      ...alert
    };

    try {
      // Store alert in Redis
      const alertKey = `${this.ALERT_CACHE_PREFIX}:${securityEvent.id}`;
      await this.redis.setex(alertKey, this.ALERT_TTL, JSON.stringify(securityEvent));

      // Update metrics
      await this.updateMetrics(securityEvent);

      // Dispatch to all enabled channels
      await this.dispatchAlert(securityEvent);

      console.log('Security alert created:', {
        id: securityEvent.id,
        type: securityEvent.type,
        severity: securityEvent.severity,
        tenantId: securityEvent.tenantId
      });

      return securityEvent;

    } catch (error) {
      console.error('Failed to create security alert:', error);
      // Fallback: at least log the critical alert
      console.error('CRITICAL SECURITY ALERT:', securityEvent);
      throw error;
    }
  }

  /**
   * Dispatch alert to configured channels
   */
  private async dispatchAlert(event: SecurityEvent): Promise<void> {
    const enabledChannels = this.alertChannels.filter(channel => 
      channel.enabled && this.shouldSendToChannel(event.severity, channel.minSeverity)
    );

    await Promise.allSettled(
      enabledChannels.map(channel => this.sendToChannel(event, channel))
    );
  }

  /**
   * Send alert to specific channel
   */
  private async sendToChannel(event: SecurityEvent, channel: AlertChannel): Promise<void> {
    try {
      switch (channel.type) {
        case 'cloudwatch':
          await this.sendToCloudWatch(event, channel);
          break;
        case 'email':
          await this.sendEmailAlert(event, channel);
          break;
        case 'slack':
          await this.sendSlackAlert(event, channel);
          break;
        case 'webhook':
          await this.sendWebhookAlert(event, channel);
          break;
        default:
          console.warn(`Unknown alert channel type: ${channel.type}`);
      }
    } catch (error) {
      console.error(`Failed to send alert to ${channel.type}:`, error);
    }
  }

  /**
   * Send alert to CloudWatch Logs
   */
  private async sendToCloudWatch(event: SecurityEvent, channel: AlertChannel): Promise<void> {
    // This would integrate with AWS CloudWatch SDK
    console.log('CloudWatch Security Alert:', {
      logGroup: channel.config.logGroup,
      severity: event.severity,
      type: event.type,
      title: event.title,
      description: event.description,
      metadata: event.metadata,
      timestamp: event.timestamp.toISOString()
    });

    // TODO: Implement actual CloudWatch integration
    // const cloudWatchLogs = new AWS.CloudWatchLogs();
    // await cloudWatchLogs.putLogEvents({
    //   logGroupName: channel.config.logGroup,
    //   logStreamName: `security-alerts-${new Date().toISOString().slice(0, 10)}`,
    //   logEvents: [{
    //     timestamp: event.timestamp.getTime(),
    //     message: JSON.stringify(event)
    //   }]
    // }).promise();
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(event: SecurityEvent, channel: AlertChannel): Promise<void> {
    console.log('Email Security Alert:', {
      recipients: channel.config.recipients,
      subject: `🚨 LIQUID ABT Security Alert - ${event.severity}`,
      severity: event.severity,
      title: event.title,
      description: event.description
    });

    // TODO: Implement SES email sending
    // const ses = new AWS.SES();
    // await ses.sendEmail({
    //   Source: 'security@liquidtreasury.business',
    //   Destination: {
    //     ToAddresses: channel.config.recipients
    //   },
    //   Message: {
    //     Subject: { Data: `🚨 Security Alert - ${event.severity}` },
    //     Body: {
    //       Html: { Data: this.formatEmailAlert(event) }
    //     }
    //   }
    // }).promise();
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(event: SecurityEvent, channel: AlertChannel): Promise<void> {
    const severityColors = {
      'LOW': '#36a64f',
      'MEDIUM': '#ff9500', 
      'HIGH': '#ff0000',
      'CRITICAL': '#8B0000'
    };

    const payload = {
      channel: channel.config.channel,
      username: 'LIQUID ABT Security',
      icon_emoji: '🚨',
      attachments: [{
        color: severityColors[event.severity],
        title: `${event.severity} Security Alert`,
        text: event.title,
        fields: [
          {
            title: 'Description',
            value: event.description,
            short: false
          },
          {
            title: 'Event Type',
            value: event.type,
            short: true
          },
          {
            title: 'Timestamp',
            value: event.timestamp.toISOString(),
            short: true
          },
          {
            title: 'Tenant ID',
            value: event.tenantId || 'System',
            short: true
          }
        ]
      }]
    };

    console.log('Slack Security Alert:', {
      webhook: channel.config.webhookUrl?.substring(0, 50) + '...',
      severity: event.severity,
      title: event.title
    });

    // TODO: Implement actual Slack webhook
    // await fetch(channel.config.webhookUrl, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(payload)
    // });
  }

  /**
   * Send custom webhook alert
   */
  private async sendWebhookAlert(event: SecurityEvent, channel: AlertChannel): Promise<void> {
    console.log('Webhook Security Alert:', {
      url: channel.config.url,
      event: event
    });

    // TODO: Implement webhook dispatch
    // await fetch(channel.config.url, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(event)
    // });
  }

  /**
   * Check if alert should be sent to channel based on severity
   */
  private shouldSendToChannel(eventSeverity: SecurityEvent['severity'], channelMinSeverity: SecurityEvent['severity']): boolean {
    const severityLevels = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'CRITICAL': 4 };
    return severityLevels[eventSeverity] >= severityLevels[channelMinSeverity];
  }

  /**
   * Update security metrics
   */
  private async updateMetrics(event: SecurityEvent): Promise<void> {
    try {
      const metricsKey = `${this.METRICS_PREFIX}:daily:${new Date().toISOString().slice(0, 10)}`;
      
      // Get existing metrics
      const existingMetrics = await this.redis.get(metricsKey);
      const metrics = existingMetrics ? JSON.parse(existingMetrics) : {
        totalEvents: 0,
        criticalEvents: 0,
        eventTypes: {}
      };

      // Update metrics
      metrics.totalEvents += 1;
      if (event.severity === 'CRITICAL') {
        metrics.criticalEvents += 1;
      }
      metrics.eventTypes[event.type] = (metrics.eventTypes[event.type] || 0) + 1;

      // Store updated metrics (24-hour TTL)
      await this.redis.setex(metricsKey, 24 * 60 * 60, JSON.stringify(metrics));

    } catch (error) {
      console.error('Failed to update security metrics:', error);
    }
  }

  /**
   * Resolve a security alert
   */
  async resolveAlert(alertId: string, resolvedBy: string, resolution?: string): Promise<boolean> {
    try {
      const alertKey = `${this.ALERT_CACHE_PREFIX}:${alertId}`;
      const alertData = await this.redis.get(alertKey);
      
      if (!alertData) {
        return false;
      }

      const alert: SecurityEvent = JSON.parse(alertData);
      alert.resolved = true;
      alert.resolvedAt = new Date();
      
      if (resolution) {
        alert.metadata = {
          ...alert.metadata,
          resolution,
          resolvedBy
        };
      }

      await this.redis.setex(alertKey, this.ALERT_TTL, JSON.stringify(alert));

      console.log('Security alert resolved:', {
        alertId,
        resolvedBy,
        resolution
      });

      return true;

    } catch (error) {
      console.error('Failed to resolve alert:', error);
      return false;
    }
  }

  /**
   * Get security monitoring metrics
   */
  async getMonitoringMetrics(days: number = 7): Promise<MonitoringMetrics> {
    try {
      const metrics: MonitoringMetrics = {
        totalEvents: 0,
        criticalEvents: 0,
        resolvedEvents: 0,
        averageResolutionTime: 0,
        topEventTypes: [],
        recentEvents: []
      };

      // Aggregate metrics from recent days
      const eventTypes: Record<string, number> = {};
      let resolutionTimes: number[] = [];

      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayKey = `${this.METRICS_PREFIX}:daily:${date.toISOString().slice(0, 10)}`;
        
        const dayMetrics = await this.redis.get(dayKey);
        if (dayMetrics) {
          const parsed = JSON.parse(dayMetrics);
          metrics.totalEvents += parsed.totalEvents || 0;
          metrics.criticalEvents += parsed.criticalEvents || 0;
          
          Object.entries(parsed.eventTypes || {}).forEach(([type, count]) => {
            eventTypes[type] = (eventTypes[type] || 0) + (count as number);
          });
        }
      }

      // Convert event types to sorted array
      metrics.topEventTypes = Object.entries(eventTypes)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

      return metrics;

    } catch (error) {
      console.error('Failed to get monitoring metrics:', error);
      return {
        totalEvents: 0,
        criticalEvents: 0,
        resolvedEvents: 0,
        averageResolutionTime: 0,
        topEventTypes: [],
        recentEvents: []
      };
    }
  }

  /**
   * Get recent security alerts
   */
  async getRecentAlerts(limit: number = 50): Promise<SecurityEvent[]> {
    try {
      // This would require scanning Redis keys or maintaining a time-ordered index
      // For now, return empty array as a placeholder
      
      console.log('Fetching recent security alerts:', { limit });
      return [];

    } catch (error) {
      console.error('Failed to get recent alerts:', error);
      return [];
    }
  }

  /**
   * Test alert system with sample alert
   */
  async testAlertSystem(): Promise<void> {
    await this.createSecurityAlert({
      type: 'SYSTEM_ERROR',
      severity: 'LOW',
      title: 'Alert System Test',
      description: 'This is a test alert to verify the monitoring system is working correctly.',
      metadata: {
        test: true,
        timestamp: Date.now()
      }
    });
  }
}

// Export singleton instance
export const securityAlertManager = new SecurityAlertManager();