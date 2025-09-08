import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../logging/logger';
import { createRedisCache } from '../cache/redisClient';
import { AlertingSystem } from '../monitoring/alerting';

const execAsync = promisify(exec);

interface BackupConfig {
  schedule: string;
  retention: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  s3Bucket: string;
  encryptionKeyId: string;
  notifications: {
    slack?: string;
    email?: string[];
  };
}

interface BackupJob {
  id: string;
  type: 'full' | 'schema' | 'tenant';
  tenantId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  filePath?: string;
  fileSize?: number;
  s3Key?: string;
  error?: string;
}

interface BackupMetadata {
  id: string;
  filename: string;
  type: 'full' | 'schema' | 'tenant';
  size: number;
  createdAt: Date;
  s3Key: string;
  tenantId?: string;
  checksum: string;
  verified: boolean;
}

export class BackupService {
  private logger: Logger;
  private cache = createRedisCache();
  private alerting: AlertingSystem;
  private config: BackupConfig;
  private activeJobs = new Map<string, BackupJob>();

  constructor(config: BackupConfig) {
    this.logger = new Logger({ module: 'BackupService' });
    this.alerting = new AlertingSystem({
      slackWebhookUrl: config.notifications.slack,
      pagerDutyApiKey: process.env.PAGERDUTY_API_KEY
    });
    this.config = config;
    
    this.startScheduler();
  }

  private startScheduler(): void {
    // Schedule daily full backups
    this.scheduleJob('0 2 * * *', () => this.performFullBackup());
    
    // Schedule weekly schema backups
    this.scheduleJob('0 3 * * 0', () => this.performSchemaBackup());
    
    // Schedule cleanup every day at 4 AM
    this.scheduleJob('0 4 * * *', () => this.cleanupOldBackups());
  }

  private scheduleJob(cron: string, jobFunction: () => Promise<void>): void {
    // This would use a proper cron scheduler in production
    // For now, we'll use a simplified interval approach
    const runJob = async () => {
      try {
        await jobFunction();
      } catch (error) {
        this.logger.error('Scheduled backup job failed', { 
          error: (error as Error).message 
        });
      }
    };

    // Schedule for next execution (simplified)
    setInterval(runJob, 24 * 60 * 60 * 1000); // Daily for demo
  }

  // Full database backup
  async performFullBackup(): Promise<string> {
    const jobId = `full_${Date.now()}`;
    const job: BackupJob = {
      id: jobId,
      type: 'full',
      status: 'pending',
      startedAt: new Date()
    };

    this.activeJobs.set(jobId, job);
    
    try {
      this.logger.info('Starting full database backup', { jobId });
      job.status = 'running';

      const scriptPath = path.join(process.cwd(), 'scripts', 'backup-database.sh');
      const { stdout, stderr } = await execAsync(`bash ${scriptPath} full`, {
        env: {
          ...process.env,
          S3_BUCKET: this.config.s3Bucket,
          ENCRYPTION_KEY_ID: this.config.encryptionKeyId,
          SLACK_WEBHOOK_URL: this.config.notifications.slack
        }
      });

      // Parse output to get backup file path
      const backupPath = this.parseBackupPath(stdout);
      const stats = await fs.stat(backupPath);

      job.status = 'completed';
      job.completedAt = new Date();
      job.filePath = backupPath;
      job.fileSize = stats.size;
      job.s3Key = `full/${path.basename(backupPath)}`;

      // Store backup metadata
      await this.storeBackupMetadata({
        id: jobId,
        filename: path.basename(backupPath),
        type: 'full',
        size: stats.size,
        createdAt: job.startedAt,
        s3Key: job.s3Key,
        checksum: await this.calculateChecksum(backupPath),
        verified: false
      });

      // Verify backup in background
      this.verifyBackupAsync(jobId, backupPath);

      this.logger.info('Full database backup completed', {
        jobId,
        fileSize: stats.size,
        duration: Date.now() - job.startedAt.getTime()
      });

      await this.alerting.sendAlert('info', 'Database Backup Completed', {
        type: 'full',
        size: this.formatFileSize(stats.size),
        duration: this.formatDuration(Date.now() - job.startedAt.getTime())
      });

      return backupPath;

    } catch (error) {
      job.status = 'failed';
      job.error = (error as Error).message;
      job.completedAt = new Date();

      this.logger.error('Full database backup failed', {
        jobId,
        error: job.error
      });

      await this.alerting.sendAlert('error', 'Database Backup Failed', {
        type: 'full',
        error: job.error
      });

      throw error;
    } finally {
      this.activeJobs.set(jobId, job);
    }
  }

  // Schema-only backup
  async performSchemaBackup(): Promise<string> {
    const jobId = `schema_${Date.now()}`;
    const job: BackupJob = {
      id: jobId,
      type: 'schema',
      status: 'running',
      startedAt: new Date()
    };

    this.activeJobs.set(jobId, job);

    try {
      this.logger.info('Starting schema backup', { jobId });

      const scriptPath = path.join(process.cwd(), 'scripts', 'backup-database.sh');
      const { stdout } = await execAsync(`bash ${scriptPath} schema`, {
        env: {
          ...process.env,
          S3_BUCKET: this.config.s3Bucket,
          ENCRYPTION_KEY_ID: this.config.encryptionKeyId
        }
      });

      const backupPath = this.parseBackupPath(stdout);
      const stats = await fs.stat(backupPath);

      job.status = 'completed';
      job.completedAt = new Date();
      job.filePath = backupPath;
      job.fileSize = stats.size;
      job.s3Key = `schema/${path.basename(backupPath)}`;

      await this.storeBackupMetadata({
        id: jobId,
        filename: path.basename(backupPath),
        type: 'schema',
        size: stats.size,
        createdAt: job.startedAt,
        s3Key: job.s3Key,
        checksum: await this.calculateChecksum(backupPath),
        verified: false
      });

      this.logger.info('Schema backup completed', {
        jobId,
        fileSize: stats.size
      });

      return backupPath;

    } catch (error) {
      job.status = 'failed';
      job.error = (error as Error).message;
      job.completedAt = new Date();

      this.logger.error('Schema backup failed', {
        jobId,
        error: job.error
      });

      throw error;
    } finally {
      this.activeJobs.set(jobId, job);
    }
  }

  // Tenant-specific backup
  async performTenantBackup(tenantId: string): Promise<string> {
    const jobId = `tenant_${tenantId}_${Date.now()}`;
    const job: BackupJob = {
      id: jobId,
      type: 'tenant',
      tenantId,
      status: 'running',
      startedAt: new Date()
    };

    this.activeJobs.set(jobId, job);

    try {
      this.logger.info('Starting tenant backup', { jobId, tenantId });

      const scriptPath = path.join(process.cwd(), 'scripts', 'backup-database.sh');
      const { stdout } = await execAsync(`bash ${scriptPath} tenant ${tenantId}`, {
        env: {
          ...process.env,
          S3_BUCKET: this.config.s3Bucket,
          ENCRYPTION_KEY_ID: this.config.encryptionKeyId
        }
      });

      const backupPath = this.parseBackupPath(stdout);
      const stats = await fs.stat(backupPath);

      job.status = 'completed';
      job.completedAt = new Date();
      job.filePath = backupPath;
      job.fileSize = stats.size;
      job.s3Key = `tenants/${tenantId}/${path.basename(backupPath)}`;

      await this.storeBackupMetadata({
        id: jobId,
        filename: path.basename(backupPath),
        type: 'tenant',
        size: stats.size,
        createdAt: job.startedAt,
        s3Key: job.s3Key,
        tenantId,
        checksum: await this.calculateChecksum(backupPath),
        verified: false
      });

      this.logger.info('Tenant backup completed', {
        jobId,
        tenantId,
        fileSize: stats.size
      });

      return backupPath;

    } catch (error) {
      job.status = 'failed';
      job.error = (error as Error).message;
      job.completedAt = new Date();

      this.logger.error('Tenant backup failed', {
        jobId,
        tenantId,
        error: job.error
      });

      throw error;
    } finally {
      this.activeJobs.set(jobId, job);
    }
  }

  // Restore database from backup
  async restoreDatabase(s3Key: string, restoreType: 'full' | 'schema' | 'tenant' = 'full', targetSchema?: string): Promise<void> {
    const jobId = `restore_${Date.now()}`;
    
    try {
      this.logger.info('Starting database restore', { jobId, s3Key, restoreType });

      const scriptPath = path.join(process.cwd(), 'scripts', 'restore-database.sh');
      let command = `bash ${scriptPath} restore ${s3Key} ${restoreType}`;
      
      if (targetSchema) {
        command += ` ${targetSchema}`;
      }

      const { stdout, stderr } = await execAsync(command, {
        env: {
          ...process.env,
          S3_BUCKET: this.config.s3Bucket
        }
      });

      this.logger.info('Database restore completed', { jobId });

      await this.alerting.sendAlert('warning', 'Database Restore Completed', {
        s3Key,
        restoreType,
        targetSchema: targetSchema || 'default'
      });

    } catch (error) {
      this.logger.error('Database restore failed', {
        jobId,
        s3Key,
        error: (error as Error).message
      });

      await this.alerting.sendAlert('error', 'Database Restore Failed', {
        s3Key,
        error: (error as Error).message
      });

      throw error;
    }
  }

  // List available backups
  async listBackups(type?: 'full' | 'schema' | 'tenant', tenantId?: string): Promise<BackupMetadata[]> {
    try {
      const cacheKey = `backups:list:${type || 'all'}:${tenantId || 'all'}`;
      const cached = await this.cache.get<BackupMetadata[]>(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Get backups from metadata storage
      const backups = await this.getBackupMetadata(type, tenantId);
      
      await this.cache.set(cacheKey, backups, { ttl: 300 }); // Cache for 5 minutes
      
      return backups;

    } catch (error) {
      this.logger.error('Failed to list backups', {
        type,
        tenantId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Get backup job status
  async getJobStatus(jobId: string): Promise<BackupJob | null> {
    return this.activeJobs.get(jobId) || null;
  }

  // Get all active jobs
  async getActiveJobs(): Promise<BackupJob[]> {
    return Array.from(this.activeJobs.values());
  }

  // Verify backup integrity
  async verifyBackup(backupId: string): Promise<boolean> {
    try {
      const metadata = await this.getBackupMetadataById(backupId);
      if (!metadata) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // Download and verify backup
      const scriptPath = path.join(process.cwd(), 'scripts', 'verify-backup.sh');
      const { stdout } = await execAsync(`bash ${scriptPath} ${metadata.s3Key}`, {
        env: {
          ...process.env,
          S3_BUCKET: this.config.s3Bucket
        }
      });

      const verified = stdout.includes('VERIFICATION_PASSED');
      
      if (verified) {
        await this.updateBackupVerification(backupId, true);
        this.logger.info('Backup verification passed', { backupId });
      } else {
        this.logger.error('Backup verification failed', { backupId });
      }

      return verified;

    } catch (error) {
      this.logger.error('Backup verification error', {
        backupId,
        error: (error as Error).message
      });
      return false;
    }
  }

  // Clean up old backups based on retention policy
  async cleanupOldBackups(): Promise<void> {
    try {
      this.logger.info('Starting backup cleanup process');

      const now = new Date();
      const backups = await this.listBackups();

      let deletedCount = 0;

      for (const backup of backups) {
        const age = now.getTime() - backup.createdAt.getTime();
        const daysDiff = Math.floor(age / (1000 * 60 * 60 * 24));

        let shouldDelete = false;

        switch (backup.type) {
          case 'full':
            if (daysDiff > this.config.retention.daily && this.isDailyBackup(backup)) {
              shouldDelete = true;
            } else if (daysDiff > this.config.retention.weekly * 7 && this.isWeeklyBackup(backup)) {
              shouldDelete = true;
            } else if (daysDiff > this.config.retention.monthly * 30 && this.isMonthlyBackup(backup)) {
              shouldDelete = true;
            }
            break;
          
          case 'schema':
            if (daysDiff > 7) { // Keep schema backups for 7 days
              shouldDelete = true;
            }
            break;
          
          case 'tenant':
            if (daysDiff > 30) { // Keep tenant backups for 30 days
              shouldDelete = true;
            }
            break;
        }

        if (shouldDelete) {
          await this.deleteBackup(backup.id);
          deletedCount++;
        }
      }

      this.logger.info('Backup cleanup completed', { deletedCount });

    } catch (error) {
      this.logger.error('Backup cleanup failed', {
        error: (error as Error).message
      });
    }
  }

  // Private helper methods

  private async verifyBackupAsync(jobId: string, backupPath: string): Promise<void> {
    // Verify backup in background to not block the main process
    setTimeout(async () => {
      try {
        const verified = await this.verifyBackup(jobId);
        if (!verified) {
          await this.alerting.sendAlert('error', 'Backup Verification Failed', {
            jobId,
            backupPath
          });
        }
      } catch (error) {
        this.logger.error('Background backup verification failed', {
          jobId,
          error: (error as Error).message
        });
      }
    }, 30000); // Wait 30 seconds before verification
  }

  private parseBackupPath(output: string): string {
    // Extract backup file path from script output
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('/app/backups/') && line.includes('.sql.gz')) {
        const match = line.match(/\/app\/backups\/[^\\s]+\.sql\.gz/);
        if (match) {
          return match[0];
        }
      }
    }
    throw new Error('Could not parse backup path from output');
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    const { stdout } = await execAsync(`sha256sum "${filePath}"`);
    return stdout.split(' ')[0];
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private isDailyBackup(backup: BackupMetadata): boolean {
    // Logic to determine if this is a daily backup
    const hour = backup.createdAt.getHours();
    return hour >= 2 && hour < 3; // Daily backups run at 2 AM
  }

  private isWeeklyBackup(backup: BackupMetadata): boolean {
    // Logic to determine if this is a weekly backup
    const dayOfWeek = backup.createdAt.getDay();
    return dayOfWeek === 0; // Weekly backups on Sunday
  }

  private isMonthlyBackup(backup: BackupMetadata): boolean {
    // Logic to determine if this is a monthly backup
    const dayOfMonth = backup.createdAt.getDate();
    return dayOfMonth === 1; // Monthly backups on the 1st
  }

  // These methods would interact with your database or metadata store
  private async storeBackupMetadata(metadata: BackupMetadata): Promise<void> {
    await this.cache.set(`backup:metadata:${metadata.id}`, metadata, { ttl: 86400 * 30 });
  }

  private async getBackupMetadata(type?: string, tenantId?: string): Promise<BackupMetadata[]> {
    // Implementation would query your backup metadata storage
    return [];
  }

  private async getBackupMetadataById(backupId: string): Promise<BackupMetadata | null> {
    return await this.cache.get(`backup:metadata:${backupId}`);
  }

  private async updateBackupVerification(backupId: string, verified: boolean): Promise<void> {
    const metadata = await this.getBackupMetadataById(backupId);
    if (metadata) {
      metadata.verified = verified;
      await this.storeBackupMetadata(metadata);
    }
  }

  private async deleteBackup(backupId: string): Promise<void> {
    const metadata = await this.getBackupMetadataById(backupId);
    if (metadata) {
      // Delete from S3
      await execAsync(`aws s3 rm s3://${this.config.s3Bucket}/${metadata.s3Key}`);
      
      // Remove metadata
      await this.cache.del(`backup:metadata:${backupId}`);
      
      this.logger.info('Backup deleted', { backupId, s3Key: metadata.s3Key });
    }
  }
}

// Factory function
export function createBackupService(): BackupService {
  const config: BackupConfig = {
    schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *',
    retention: {
      daily: parseInt(process.env.BACKUP_RETENTION_DAILY || '7'),
      weekly: parseInt(process.env.BACKUP_RETENTION_WEEKLY || '4'),
      monthly: parseInt(process.env.BACKUP_RETENTION_MONTHLY || '12')
    },
    s3Bucket: process.env.S3_BACKUP_BUCKET || 'liquid-abt-backups-prod',
    encryptionKeyId: process.env.BACKUP_ENCRYPTION_KEY_ID || 'alias/liquid-abt-backups',
    notifications: {
      slack: process.env.SLACK_WEBHOOK_URL,
      email: process.env.NOTIFICATION_EMAILS?.split(',')
    }
  };

  return new BackupService(config);
}