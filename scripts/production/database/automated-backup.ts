import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BackupConfig {
  schedule: string;
  retention: number;
  s3Bucket: string;
  notification: {
    webhook?: string;
    email?: string;
    slack?: string;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  monitoring: {
    cloudWatchLogGroup?: string;
    enableMetrics: boolean;
  };
}

interface BackupResult {
  success: boolean;
  startTime: Date;
  endTime: Date;
  duration: number;
  filesCreated: number;
  totalSize: string;
  s3Locations: string[];
  errors: string[];
}

class AutomatedBackupService {
  private config: BackupConfig;
  private scriptPath: string;
  private logPath: string;

  constructor(configPath?: string) {
    this.scriptPath = join(__dirname, 'backup.sh');
    this.logPath = join(process.cwd(), 'logs', 'automated-backup.log');
    this.config = this.loadConfig(configPath);
  }

  private loadConfig(configPath?: string): BackupConfig {
    const defaultConfig: BackupConfig = {
      schedule: '0 */6 * * *', // Every 6 hours
      retention: 30, // 30 days
      s3Bucket: process.env.S3_BACKUP_BUCKET || 'liquid-abt-backups',
      notification: {
        webhook: process.env.NOTIFICATION_WEBHOOK,
        email: process.env.NOTIFICATION_EMAIL,
        slack: process.env.SLACK_WEBHOOK
      },
      database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        name: process.env.DB_NAME || 'liquid_abt',
        user: process.env.DB_USER || 'liquid_abt_user',
        password: process.env.DB_PASSWORD || ''
      },
      monitoring: {
        cloudWatchLogGroup: process.env.CLOUDWATCH_LOG_GROUP,
        enableMetrics: process.env.ENABLE_BACKUP_METRICS === 'true'
      }
    };

    // Load custom config if provided
    if (configPath) {
      try {
        const customConfig = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
        return { ...defaultConfig, ...customConfig };
      } catch (error) {
        console.warn(`Could not load config from ${configPath}, using defaults:`, error);
      }
    }

    return defaultConfig;
  }

  private async ensureLogDirectory(): Promise<void> {
    const logDir = join(process.cwd(), 'logs');
    try {
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      console.warn('Could not create log directory:', error);
    }
  }

  private async logMessage(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data: data || {},
      service: 'automated-backup'
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      await this.ensureLogDirectory();
      await fs.appendFile(this.logPath, logLine);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }

    // Also log to console
    const consoleMessage = `[${timestamp}] ${level}: ${message}`;
    if (data) {
      console.log(consoleMessage, data);
    } else {
      console.log(consoleMessage);
    }

    // Send to CloudWatch if configured
    if (this.config.monitoring.cloudWatchLogGroup) {
      try {
        await this.sendToCloudWatch(logEntry);
      } catch (error) {
        console.warn('Failed to send log to CloudWatch:', error);
      }
    }
  }

  private async sendToCloudWatch(logEntry: any): Promise<void> {
    // Implementation for CloudWatch logging
    // This would require AWS SDK and proper IAM permissions
    try {
      const { CloudWatchLogs } = await import('@aws-sdk/client-cloudwatch-logs');
      
      const client = new CloudWatchLogs({ region: process.env.AWS_REGION || 'ap-southeast-2' });
      
      const logStreamName = `backup-${new Date().toISOString().split('T')[0]}`;
      
      await client.putLogEvents({
        logGroupName: this.config.monitoring.cloudWatchLogGroup,
        logStreamName,
        logEvents: [{
          timestamp: Date.now(),
          message: JSON.stringify(logEntry)
        }]
      });
    } catch (error) {
      // CloudWatch logging is optional, don't fail the backup for this
      console.warn('CloudWatch logging failed:', error);
    }
  }

  private async sendNotification(result: BackupResult): Promise<void> {
    const { success, duration, filesCreated, totalSize, errors } = result;
    const status = success ? 'success' : 'error';
    const title = success ? 'Database Backup Completed' : 'Database Backup Failed';
    
    const message = success 
      ? `Backup completed successfully in ${duration}s. Created ${filesCreated} files (${totalSize}).`
      : `Backup failed after ${duration}s. Errors: ${errors.join(', ')}`;

    const details = {
      startTime: result.startTime.toISOString(),
      endTime: result.endTime.toISOString(),
      duration: `${duration}s`,
      filesCreated,
      totalSize,
      s3Locations: result.s3Locations,
      errors: errors.length > 0 ? errors : undefined
    };

    // Webhook notification
    if (this.config.notification.webhook) {
      try {
        const response = await fetch(this.config.notification.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            message,
            status,
            details,
            timestamp: new Date().toISOString(),
            service: 'liquid-abt-backup'
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        await this.logMessage('INFO', 'Webhook notification sent successfully');
      } catch (error) {
        await this.logMessage('WARN', 'Failed to send webhook notification', { error: error.message });
      }
    }

    // Slack notification
    if (this.config.notification.slack) {
      try {
        const color = success ? 'good' : 'danger';
        const slackMessage = {
          text: title,
          attachments: [{
            color,
            text: message,
            fields: [
              { title: 'Duration', value: `${duration}s`, short: true },
              { title: 'Files', value: String(filesCreated), short: true },
              { title: 'Size', value: totalSize, short: true },
              { title: 'Status', value: status.toUpperCase(), short: true }
            ],
            footer: 'LIQUID ABT Backup Service',
            ts: Math.floor(Date.now() / 1000)
          }]
        };

        const response = await fetch(this.config.notification.slack, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackMessage)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        await this.logMessage('INFO', 'Slack notification sent successfully');
      } catch (error) {
        await this.logMessage('WARN', 'Failed to send Slack notification', { error: error.message });
      }
    }

    // Email notification would be implemented here
    if (this.config.notification.email) {
      await this.logMessage('WARN', 'Email notifications not implemented yet');
    }
  }

  private async publishMetrics(result: BackupResult): Promise<void> {
    if (!this.config.monitoring.enableMetrics) {
      return;
    }

    try {
      const { CloudWatch } = await import('@aws-sdk/client-cloudwatch');
      
      const client = new CloudWatch({ region: process.env.AWS_REGION || 'ap-southeast-2' });
      
      const metrics = [
        {
          MetricName: 'BackupDuration',
          Value: result.duration,
          Unit: 'Seconds'
        },
        {
          MetricName: 'BackupSuccess',
          Value: result.success ? 1 : 0,
          Unit: 'Count'
        },
        {
          MetricName: 'FilesCreated',
          Value: result.filesCreated,
          Unit: 'Count'
        }
      ];

      await client.putMetricData({
        Namespace: 'LiquidABT/Backup',
        MetricData: metrics.map(metric => ({
          ...metric,
          Timestamp: new Date(),
          Dimensions: [
            { Name: 'Environment', Value: process.env.NODE_ENV || 'production' },
            { Name: 'Database', Value: this.config.database.name }
          ]
        }))
      });

      await this.logMessage('INFO', 'CloudWatch metrics published successfully');
    } catch (error) {
      await this.logMessage('WARN', 'Failed to publish CloudWatch metrics', { error: error.message });
    }
  }

  async runBackup(): Promise<BackupResult> {
    const startTime = new Date();
    
    await this.logMessage('INFO', 'Starting automated backup process', {
      database: `${this.config.database.host}:${this.config.database.port}/${this.config.database.name}`,
      s3Bucket: this.config.s3Bucket,
      retention: `${this.config.retention} days`
    });

    try {
      // Prepare environment variables for the backup script
      const env = {
        ...process.env,
        DB_HOST: this.config.database.host,
        DB_PORT: String(this.config.database.port),
        DB_NAME: this.config.database.name,
        DB_USER: this.config.database.user,
        DB_PASSWORD: this.config.database.password,
        S3_BUCKET: this.config.s3Bucket,
        RETENTION_DAYS: String(this.config.retention),
        NOTIFICATION_WEBHOOK: this.config.notification.webhook || '',
        LOG_FILE: this.logPath
      };

      // Execute the backup script
      const { stdout, stderr } = await execAsync(`bash "${this.scriptPath}"`, {
        env,
        timeout: 30 * 60 * 1000, // 30 minutes timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      const endTime = new Date();
      const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

      // Parse the output to extract backup information
      const s3Locations = this.extractS3Locations(stdout);
      const filesCreated = s3Locations.length;
      const totalSize = this.extractTotalSize(stdout);

      const result: BackupResult = {
        success: true,
        startTime,
        endTime,
        duration,
        filesCreated,
        totalSize: totalSize || 'Unknown',
        s3Locations,
        errors: stderr ? [stderr] : []
      };

      await this.logMessage('INFO', 'Backup completed successfully', {
        duration: `${duration}s`,
        filesCreated,
        totalSize: result.totalSize
      });

      // Send notifications and metrics
      await Promise.all([
        this.sendNotification(result),
        this.publishMetrics(result)
      ]);

      return result;

    } catch (error) {
      const endTime = new Date();
      const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
      
      const result: BackupResult = {
        success: false,
        startTime,
        endTime,
        duration,
        filesCreated: 0,
        totalSize: '0',
        s3Locations: [],
        errors: [error.message || 'Unknown error']
      };

      await this.logMessage('ERROR', 'Backup failed', {
        error: error.message,
        duration: `${duration}s`
      });

      // Send failure notifications
      await this.sendNotification(result);
      await this.publishMetrics(result);

      return result;
    }
  }

  private extractS3Locations(output: string): string[] {
    const lines = output.split('\n');
    const s3Locations: string[] = [];
    
    let inS3Section = false;
    for (const line of lines) {
      if (line.includes('S3 locations:')) {
        inS3Section = true;
        continue;
      }
      
      if (inS3Section) {
        if (line.trim().startsWith('s3://')) {
          s3Locations.push(line.trim());
        } else if (line.trim() === '' || !line.trim().startsWith(' ')) {
          break; // End of S3 locations section
        }
      }
    }
    
    return s3Locations;
  }

  private extractTotalSize(output: string): string | null {
    const match = output.match(/Total size:\s*([^\n]+)/i);
    return match ? match[1].trim() : null;
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string; lastBackup?: Date }> {
    try {
      // Check if backup script exists
      await fs.access(this.scriptPath);

      // Check database connectivity
      const { stdout } = await execAsync(`PGPASSWORD="${this.config.database.password}" psql -h "${this.config.database.host}" -p "${this.config.database.port}" -U "${this.config.database.user}" -d "${this.config.database.name}" -c "SELECT 1;" -t`, {
        timeout: 10000
      });

      if (!stdout.includes('1')) {
        return { healthy: false, message: 'Database connection failed' };
      }

      // Check AWS credentials
      await execAsync('aws sts get-caller-identity', { timeout: 10000 });

      // Check S3 bucket access
      await execAsync(`aws s3 ls s3://${this.config.s3Bucket}`, { timeout: 10000 });

      // Try to determine last backup time (optional)
      let lastBackup: Date | undefined;
      try {
        const { stdout: s3List } = await execAsync(`aws s3api list-objects-v2 --bucket "${this.config.s3Bucket}" --prefix "backups/" --query "sort_by(Contents, &LastModified)[-1].LastModified" --output text`, {
          timeout: 10000
        });
        if (s3List.trim() && s3List.trim() !== 'None') {
          lastBackup = new Date(s3List.trim());
        }
      } catch (error) {
        // Last backup time is optional
      }

      return {
        healthy: true,
        message: 'Backup service is healthy',
        lastBackup
      };

    } catch (error) {
      return {
        healthy: false,
        message: `Health check failed: ${error.message}`
      };
    }
  }

  getConfig(): BackupConfig {
    return { ...this.config };
  }
}

// CLI interface for manual execution
async function main() {
  const args = process.argv.slice(2);
  const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : undefined;
  
  const backupService = new AutomatedBackupService(configPath);

  if (args.includes('--health-check')) {
    const health = await backupService.healthCheck();
    console.log(JSON.stringify(health, null, 2));
    process.exit(health.healthy ? 0 : 1);
  }

  if (args.includes('--show-config')) {
    const config = backupService.getConfig();
    // Redact sensitive information
    const safeConfig = {
      ...config,
      database: {
        ...config.database,
        password: '[REDACTED]'
      }
    };
    console.log(JSON.stringify(safeConfig, null, 2));
    process.exit(0);
  }

  try {
    const result = await backupService.runBackup();
    console.log('Backup result:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('Backup process failed:', error);
    process.exit(1);
  }
}

// Export for use as a module
export { AutomatedBackupService, BackupConfig, BackupResult };

// Run CLI interface if executed directly
if (require.main === module) {
  main().catch(console.error);
}