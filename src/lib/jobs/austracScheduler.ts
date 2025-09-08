// LIQUID ABT - AUSTRAC Scheduler Background Job
// Processes scheduled AUSTRAC reports automatically

import { austracReportingService } from '../compliance/austracReporting';
import { securityMetricsService, SecurityMetricType } from '../security/securityMetrics';
import cron from 'node-cron';

export class AUSTRACScheduler {
  private isRunning = false;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

  /**
   * Start the AUSTRAC scheduler
   * Runs every hour to check for scheduled reports
   */
  start(): void {
    if (this.isRunning) {
      console.log('AUSTRAC scheduler is already running');
      return;
    }

    console.log('Starting AUSTRAC scheduler...');

    // Schedule report processing every hour
    const hourlyTask = cron.schedule('0 * * * *', async () => {
      await this.processScheduledReports();
    }, {
      scheduled: true,
      timezone: "Australia/Sydney"
    });

    this.scheduledJobs.set('hourly_reports', hourlyTask);

    // Schedule daily compliance check at 2 AM
    const dailyTask = cron.schedule('0 2 * * *', async () => {
      await this.performDailyComplianceCheck();
    }, {
      scheduled: true,
      timezone: "Australia/Sydney"
    });

    this.scheduledJobs.set('daily_compliance', dailyTask);

    // Schedule weekly report summary on Sundays at 6 AM
    const weeklyTask = cron.schedule('0 6 * * 0', async () => {
      await this.generateWeeklyComplianceSummary();
    }, {
      scheduled: true,
      timezone: "Australia/Sydney"
    });

    this.scheduledJobs.set('weekly_summary', weeklyTask);

    this.isRunning = true;
    console.log('AUSTRAC scheduler started successfully');
    console.log('Scheduled tasks:', Array.from(this.scheduledJobs.keys()));
  }

  /**
   * Stop the AUSTRAC scheduler
   */
  stop(): void {
    if (!this.isRunning) {
      console.log('AUSTRAC scheduler is not running');
      return;
    }

    console.log('Stopping AUSTRAC scheduler...');

    // Stop all scheduled tasks
    this.scheduledJobs.forEach((task, name) => {
      task.stop();
      task.destroy();
      console.log(`Stopped scheduled task: ${name}`);
    });

    this.scheduledJobs.clear();
    this.isRunning = false;
    console.log('AUSTRAC scheduler stopped');
  }

  /**
   * Process scheduled reports
   */
  private async processScheduledReports(): Promise<void> {
    try {
      console.log('Processing scheduled AUSTRAC reports...');
      const startTime = Date.now();

      // Process scheduled reports through the reporting service
      await austracReportingService.processScheduledReports();

      const duration = Date.now() - startTime;
      console.log(`Scheduled reports processing completed in ${duration}ms`);

      // Track processing metrics
      await securityMetricsService.recordMetric(
        SecurityMetricType.COMPLIANCE_THRESHOLD_BREACHES,
        0, // Success - no errors
        undefined, // Global metric
        {
          operation: 'scheduled_reports_processing',
          duration,
          success: true
        }
      );

    } catch (error) {
      console.error('Error processing scheduled AUSTRAC reports:', error);

      // Track failure metrics
      await securityMetricsService.recordMetric(
        SecurityMetricType.COMPLIANCE_THRESHOLD_BREACHES,
        1, // Failure
        undefined,
        {
          operation: 'scheduled_reports_processing',
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false
        }
      );
    }
  }

  /**
   * Perform daily compliance checks
   */
  private async performDailyComplianceCheck(): Promise<void> {
    try {
      console.log('Performing daily AUSTRAC compliance check...');

      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // Check for threshold transactions that might need reporting
      const reports = await austracReportingService.getReports(
        yesterday,
        today
      );

      const unreportedThresholdTransactions = reports.filter(report => 
        report.reportType === 'TTR' && 
        report.status === 'generated' &&
        report.recordCount > 0
      );

      if (unreportedThresholdTransactions.length > 0) {
        console.log(`Found ${unreportedThresholdTransactions.length} unreported TTR reports`);
        
        // Create compliance alert
        await securityMetricsService.recordMetric(
          SecurityMetricType.COMPLIANCE_THRESHOLD_BREACHES,
          unreportedThresholdTransactions.length,
          undefined,
          {
            operation: 'daily_compliance_check',
            unreportedReports: unreportedThresholdTransactions.map(r => r.id),
            totalAmount: unreportedThresholdTransactions.reduce((sum, r) => sum + r.totalAmount, 0)
          }
        );
      }

      // Check for overdue suspicious matter reports
      const overdueAlerts = await this.checkForOverdueSMRs();
      if (overdueAlerts.length > 0) {
        console.log(`Found ${overdueAlerts.length} overdue SMR alerts`);
        
        await securityMetricsService.recordMetric(
          SecurityMetricType.COMPLIANCE_THRESHOLD_BREACHES,
          overdueAlerts.length,
          undefined,
          {
            operation: 'daily_compliance_check',
            overdueAlerts,
            alertType: 'overdue_smr'
          }
        );
      }

      console.log('Daily compliance check completed');

    } catch (error) {
      console.error('Error performing daily compliance check:', error);
    }
  }

  /**
   * Generate weekly compliance summary
   */
  private async generateWeeklyComplianceSummary(): Promise<void> {
    try {
      console.log('Generating weekly AUSTRAC compliance summary...');

      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 7);

      // Get all reports for the week
      const weeklyReports = await austracReportingService.getReports(
        startDate,
        endDate
      );

      // Calculate summary statistics
      const summary = {
        totalReports: weeklyReports.length,
        ttrReports: weeklyReports.filter(r => r.reportType === 'TTR').length,
        smrReports: weeklyReports.filter(r => r.reportType === 'SMR').length,
        submittedReports: weeklyReports.filter(r => r.status === 'submitted').length,
        pendingReports: weeklyReports.filter(r => r.status === 'validated').length,
        totalThresholdAmount: weeklyReports
          .filter(r => r.reportType === 'TTR')
          .reduce((sum, r) => sum + r.totalAmount, 0),
        reportingPeriod: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        }
      };

      // Record compliance summary metrics
      await securityMetricsService.recordMetric(
        SecurityMetricType.COMPLIANCE_THRESHOLD_BREACHES,
        summary.pendingReports, // Focus on pending reports as a metric
        undefined,
        {
          operation: 'weekly_compliance_summary',
          summary,
          complianceRate: summary.totalReports > 0 ? 
            (summary.submittedReports / summary.totalReports) * 100 : 100
        }
      );

      console.log('Weekly compliance summary:', summary);

      // In production, this would send summary reports to compliance officers
      // via email, Slack, or other notification channels

    } catch (error) {
      console.error('Error generating weekly compliance summary:', error);
    }
  }

  /**
   * Check for overdue suspicious matter reports
   */
  private async checkForOverdueSMRs(): Promise<string[]> {
    // Implementation would check for suspicious activities that haven't been 
    // reported within the required timeframe (typically 3 business days)
    
    // For now, return empty array - would implement based on actual SMR tracking
    return [];
  }

  /**
   * Manual trigger for testing purposes
   */
  async triggerScheduledReports(): Promise<void> {
    console.log('Manually triggering scheduled AUSTRAC reports...');
    await this.processScheduledReports();
  }

  /**
   * Manual trigger for daily compliance check
   */
  async triggerDailyComplianceCheck(): Promise<void> {
    console.log('Manually triggering daily compliance check...');
    await this.performDailyComplianceCheck();
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    scheduledJobs: string[];
    nextExecution: Record<string, string>;
  } {
    const nextExecution: Record<string, string> = {};
    
    this.scheduledJobs.forEach((task, name) => {
      // Note: node-cron doesn't provide direct access to next execution time
      // In production, you might want to use a more advanced scheduler like Bull
      nextExecution[name] = 'Available with advanced scheduler';
    });

    return {
      isRunning: this.isRunning,
      scheduledJobs: Array.from(this.scheduledJobs.keys()),
      nextExecution
    };
  }
}

// Export singleton instance
export const austracScheduler = new AUSTRACScheduler();

// Auto-start in production environments
if (process.env.NODE_ENV === 'production' && process.env.AUSTRAC_SCHEDULER_ENABLED === 'true') {
  console.log('Auto-starting AUSTRAC scheduler in production mode...');
  austracScheduler.start();
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, stopping AUSTRAC scheduler...');
  austracScheduler.stop();
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, stopping AUSTRAC scheduler...');
  austracScheduler.stop();
});