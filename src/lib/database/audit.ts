// LIQUID ABT - Audit Trail System
// Immutable audit logging with comprehensive data access tracking

import { appLogger, LogCategory } from '../logging/logger';
import { getMasterPrisma } from './connection';
import { createHash } from 'crypto';

// Audit event types
export enum AuditEventType {
  // Data operations
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  
  // Authentication events
  LOGIN = 'login',
  LOGOUT = 'logout',
  LOGIN_FAILED = 'login_failed',
  PASSWORD_CHANGE = 'password_change',
  
  // Business operations
  BITCOIN_PURCHASE = 'bitcoin_purchase',
  TREASURY_RULE_CREATE = 'treasury_rule_create',
  TREASURY_RULE_EXECUTE = 'treasury_rule_execute',
  WITHDRAWAL = 'withdrawal',
  
  // Configuration changes
  CONFIG_CHANGE = 'config_change',
  PERMISSION_CHANGE = 'permission_change',
  API_KEY_CREATE = 'api_key_create',
  API_KEY_REVOKE = 'api_key_revoke',
  
  // Compliance events
  KYC_VERIFICATION = 'kyc_verification',
  AML_ALERT = 'aml_alert',
  AUSTRAC_REPORT = 'austrac_report',
  ATO_REPORT = 'ato_report',
  
  // Administrative actions
  ADMIN_ACTION = 'admin_action',
  SYSTEM_MAINTENANCE = 'system_maintenance',
  DATA_EXPORT = 'data_export',
  DATA_IMPORT = 'data_import'
}

// Audit severity levels
export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

// Audit trail record
export interface AuditRecord {
  id: string;
  tenantId?: string;          // Which tenant (null for system-wide events)
  userId?: string;            // Who performed the action
  sessionId?: string;         // Session identifier
  eventType: AuditEventType;  // What type of action
  resourceType: string;       // What was acted upon (table/entity name)
  resourceId?: string;        // Specific record ID
  action: string;             // Detailed action description
  oldValues?: any;           // Previous values (for updates)
  newValues?: any;           // New values (for creates/updates)
  metadata?: any;            // Additional context
  ipAddress?: string;        // Source IP address
  userAgent?: string;        // User agent string
  severity: AuditSeverity;   // Event severity
  timestamp: Date;           // When it happened
  hash: string;              // Integrity hash
  previousHash?: string;     // Hash of previous audit record (blockchain-like)
  correlationId?: string;    // Request correlation ID
  complianceRelevant: boolean; // Flag for compliance-related events
}

// Audit query filters
export interface AuditQueryFilters {
  tenantId?: string;
  userId?: string;
  eventType?: AuditEventType;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  severity?: AuditSeverity;
  complianceOnly?: boolean;
  limit?: number;
  offset?: number;
}

// Data retention policies
export interface RetentionPolicy {
  eventType: AuditEventType;
  retentionYears: number;
  archiveAfterMonths?: number;
  complianceRequired: boolean;
}

// Default retention policies (Australian compliance requirements)
export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  // Financial records: 7 years
  { eventType: AuditEventType.BITCOIN_PURCHASE, retentionYears: 7, complianceRequired: true },
  { eventType: AuditEventType.WITHDRAWAL, retentionYears: 7, complianceRequired: true },
  { eventType: AuditEventType.ATO_REPORT, retentionYears: 7, complianceRequired: true },
  
  // AML/CTF records: 7 years
  { eventType: AuditEventType.KYC_VERIFICATION, retentionYears: 7, complianceRequired: true },
  { eventType: AuditEventType.AML_ALERT, retentionYears: 7, complianceRequired: true },
  { eventType: AuditEventType.AUSTRAC_REPORT, retentionYears: 7, complianceRequired: true },
  
  // Authentication and access: 2 years
  { eventType: AuditEventType.LOGIN, retentionYears: 2, complianceRequired: false },
  { eventType: AuditEventType.LOGOUT, retentionYears: 2, complianceRequired: false },
  { eventType: AuditEventType.LOGIN_FAILED, retentionYears: 2, complianceRequired: false },
  
  // System operations: 3 years
  { eventType: AuditEventType.CONFIG_CHANGE, retentionYears: 3, complianceRequired: true },
  { eventType: AuditEventType.ADMIN_ACTION, retentionYears: 3, complianceRequired: true },
  
  // Data operations: 5 years (general business records)
  { eventType: AuditEventType.CREATE, retentionYears: 5, complianceRequired: false },
  { eventType: AuditEventType.UPDATE, retentionYears: 5, complianceRequired: false },
  { eventType: AuditEventType.DELETE, retentionYears: 5, complianceRequired: true }
];

export class AuditTrailService {
  private static instance: AuditTrailService;
  private previousHash: string | null = null;

  private constructor() {
    // Initialize with the hash of the last audit record
    this.initializePreviousHash();
  }

  public static getInstance(): AuditTrailService {
    if (!AuditTrailService.instance) {
      AuditTrailService.instance = new AuditTrailService();
    }
    return AuditTrailService.instance;
  }

  /**
   * Log an audit event
   */
  async logAuditEvent(event: Omit<AuditRecord, 'id' | 'timestamp' | 'hash' | 'previousHash'>): Promise<string> {
    const auditRecord: AuditRecord = {
      id: this.generateAuditId(),
      ...event,
      timestamp: new Date(),
      hash: '',
      previousHash: this.previousHash || undefined
    };

    // Calculate integrity hash
    auditRecord.hash = this.calculateRecordHash(auditRecord);
    
    // Update previous hash for next record
    this.previousHash = auditRecord.hash;

    try {
      // Store in database
      await this.storeAuditRecord(auditRecord);

      // Log to application logs as well
      appLogger.logAudit(`Audit: ${event.eventType}`, {
        tenantId: event.tenantId,
        userId: event.userId,
        metadata: {
          auditId: auditRecord.id,
          eventType: event.eventType,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          action: event.action
        }
      });

      return auditRecord.id;

    } catch (error) {
      appLogger.error('Failed to store audit record', {
        category: LogCategory.SYSTEM,
        action: 'audit_store_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: { auditId: auditRecord.id }
      });
      throw error;
    }
  }

  /**
   * Query audit records with filters
   */
  async queryAuditRecords(filters: AuditQueryFilters): Promise<{
    records: AuditRecord[];
    totalCount: number;
    hasMore: boolean;
  }> {
    try {
      const prisma = getMasterPrisma();
      const limit = filters.limit || 100;
      const offset = filters.offset || 0;

      // Build where clause
      const whereClause: any = {};
      
      if (filters.tenantId) whereClause.tenantId = filters.tenantId;
      if (filters.userId) whereClause.userId = filters.userId;
      if (filters.eventType) whereClause.eventType = filters.eventType;
      if (filters.resourceType) whereClause.resourceType = filters.resourceType;
      if (filters.resourceId) whereClause.resourceId = filters.resourceId;
      if (filters.severity) whereClause.severity = filters.severity;
      if (filters.complianceOnly) whereClause.complianceRelevant = true;
      
      if (filters.startDate || filters.endDate) {
        whereClause.timestamp = {};
        if (filters.startDate) whereClause.timestamp.gte = filters.startDate;
        if (filters.endDate) whereClause.timestamp.lte = filters.endDate;
      }

      // Execute query
      const [records, totalCount] = await Promise.all([
        prisma.auditLog.findMany({
          where: whereClause,
          orderBy: { timestamp: 'desc' },
          skip: offset,
          take: limit
        }),
        prisma.auditLog.count({ where: whereClause })
      ]);

      return {
        records: records as AuditRecord[],
        totalCount,
        hasMore: totalCount > offset + records.length
      };

    } catch (error) {
      appLogger.error('Failed to query audit records', {
        category: LogCategory.SYSTEM,
        action: 'audit_query_error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Export audit records for compliance
   */
  async exportAuditRecords(
    filters: AuditQueryFilters,
    format: 'csv' | 'json' = 'csv'
  ): Promise<{ content: string; filename: string; mimeType: string }> {
    const { records } = await this.queryAuditRecords({
      ...filters,
      limit: 10000 // Large limit for export
    });

    if (format === 'csv') {
      const csvHeaders = [
        'ID', 'Timestamp', 'Tenant ID', 'User ID', 'Event Type', 'Resource Type',
        'Resource ID', 'Action', 'Severity', 'IP Address', 'Correlation ID',
        'Old Values', 'New Values', 'Metadata'
      ].join(',');

      const csvRows = records.map(record => [
        record.id,
        record.timestamp.toISOString(),
        record.tenantId || '',
        record.userId || '',
        record.eventType,
        record.resourceType,
        record.resourceId || '',
        `"${record.action}"`,
        record.severity,
        record.ipAddress || '',
        record.correlationId || '',
        `"${JSON.stringify(record.oldValues || {})}"`,
        `"${JSON.stringify(record.newValues || {})}"`,
        `"${JSON.stringify(record.metadata || {})}"`
      ].join(','));

      const content = [csvHeaders, ...csvRows].join('\n');
      const timestamp = new Date().toISOString().split('T')[0];

      return {
        content,
        filename: `audit_export_${timestamp}.csv`,
        mimeType: 'text/csv'
      };
    } else {
      const content = JSON.stringify(records, null, 2);
      const timestamp = new Date().toISOString().split('T')[0];

      return {
        content,
        filename: `audit_export_${timestamp}.json`,
        mimeType: 'application/json'
      };
    }
  }

  /**
   * Verify audit record integrity
   */
  async verifyAuditIntegrity(recordId: string): Promise<{
    valid: boolean;
    hashMatch: boolean;
    chainValid: boolean;
    details: string;
  }> {
    try {
      const record = await this.getAuditRecord(recordId);
      if (!record) {
        return {
          valid: false,
          hashMatch: false,
          chainValid: false,
          details: 'Audit record not found'
        };
      }

      // Verify hash
      const calculatedHash = this.calculateRecordHash({
        ...record,
        hash: '' // Exclude hash from hash calculation
      });
      const hashMatch = calculatedHash === record.hash;

      // Verify chain integrity (if previous hash exists)
      let chainValid = true;
      if (record.previousHash) {
        const previousRecord = await this.getPreviousAuditRecord(record.timestamp);
        chainValid = previousRecord ? previousRecord.hash === record.previousHash : false;
      }

      return {
        valid: hashMatch && chainValid,
        hashMatch,
        chainValid,
        details: hashMatch && chainValid ? 'Audit record integrity verified' : 'Integrity check failed'
      };

    } catch (error) {
      return {
        valid: false,
        hashMatch: false,
        chainValid: false,
        details: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Apply data retention policies
   */
  async applyRetentionPolicies(): Promise<{
    recordsArchived: number;
    recordsDeleted: number;
    policiesApplied: number;
  }> {
    let recordsArchived = 0;
    let recordsDeleted = 0;
    let policiesApplied = 0;

    appLogger.info('Applying audit retention policies', {
      category: LogCategory.SYSTEM,
      action: 'retention_policy_start'
    });

    for (const policy of DEFAULT_RETENTION_POLICIES) {
      try {
        const cutoffDate = new Date();
        cutoffDate.setFullYear(cutoffDate.getFullYear() - policy.retentionYears);

        // Archive records if archiving is configured
        if (policy.archiveAfterMonths) {
          const archiveDate = new Date();
          archiveDate.setMonth(archiveDate.getMonth() - policy.archiveAfterMonths);
          
          const recordsToArchive = await this.getRecordsForArchiving(policy.eventType, archiveDate, cutoffDate);
          if (recordsToArchive.length > 0) {
            await this.archiveRecords(recordsToArchive);
            recordsArchived += recordsToArchive.length;
          }
        }

        // Delete very old records (beyond retention period)
        const recordsToDelete = await this.getRecordsForDeletion(policy.eventType, cutoffDate);
        if (recordsToDelete.length > 0) {
          // Only delete non-compliance records or after legal retention period
          if (!policy.complianceRequired) {
            await this.deleteRecords(recordsToDelete);
            recordsDeleted += recordsToDelete.length;
          }
        }

        policiesApplied++;

      } catch (error) {
        appLogger.error('Failed to apply retention policy', {
          category: LogCategory.SYSTEM,
          action: 'retention_policy_error',
          error: error instanceof Error ? error.message : 'Unknown error',
          metadata: { eventType: policy.eventType }
        });
      }
    }

    appLogger.info('Retention policies applied', {
      category: LogCategory.SYSTEM,
      action: 'retention_policy_complete',
      metadata: { recordsArchived, recordsDeleted, policiesApplied }
    });

    return { recordsArchived, recordsDeleted, policiesApplied };
  }

  // Convenience methods for common audit events

  /**
   * Log data access (read operations)
   */
  async logDataAccess(
    tenantId: string,
    userId: string,
    resourceType: string,
    resourceId: string,
    correlationId?: string,
    metadata?: any
  ): Promise<string> {
    return this.logAuditEvent({
      tenantId,
      userId,
      eventType: AuditEventType.READ,
      resourceType,
      resourceId,
      action: `Accessed ${resourceType} record`,
      severity: AuditSeverity.INFO,
      correlationId,
      metadata,
      complianceRelevant: false
    });
  }

  /**
   * Log data modification
   */
  async logDataModification(
    tenantId: string,
    userId: string,
    eventType: AuditEventType.CREATE | AuditEventType.UPDATE | AuditEventType.DELETE,
    resourceType: string,
    resourceId: string,
    oldValues?: any,
    newValues?: any,
    correlationId?: string
  ): Promise<string> {
    return this.logAuditEvent({
      tenantId,
      userId,
      eventType,
      resourceType,
      resourceId,
      action: `${eventType.toUpperCase()} ${resourceType} record`,
      oldValues,
      newValues,
      severity: AuditSeverity.INFO,
      correlationId,
      complianceRelevant: eventType === AuditEventType.DELETE
    });
  }

  /**
   * Log authentication events
   */
  async logAuthentication(
    userId: string,
    eventType: AuditEventType.LOGIN | AuditEventType.LOGOUT | AuditEventType.LOGIN_FAILED,
    ipAddress?: string,
    userAgent?: string,
    sessionId?: string,
    metadata?: any
  ): Promise<string> {
    return this.logAuditEvent({
      userId,
      eventType,
      resourceType: 'authentication',
      action: `User ${eventType}`,
      severity: eventType === AuditEventType.LOGIN_FAILED ? AuditSeverity.WARNING : AuditSeverity.INFO,
      ipAddress,
      userAgent,
      sessionId,
      metadata,
      complianceRelevant: false
    });
  }

  /**
   * Log compliance events
   */
  async logComplianceEvent(
    tenantId: string,
    eventType: AuditEventType.KYC_VERIFICATION | AuditEventType.AML_ALERT | AuditEventType.AUSTRAC_REPORT | AuditEventType.ATO_REPORT,
    resourceId: string,
    action: string,
    metadata?: any,
    userId?: string
  ): Promise<string> {
    return this.logAuditEvent({
      tenantId,
      userId,
      eventType,
      resourceType: 'compliance',
      resourceId,
      action,
      severity: AuditSeverity.INFO,
      metadata,
      complianceRelevant: true
    });
  }

  // Private helper methods

  private async initializePreviousHash(): Promise<void> {
    try {
      const prisma = getMasterPrisma();
      const lastRecord = await prisma.auditLog.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { hash: true }
      });
      
      this.previousHash = lastRecord?.hash || null;
    } catch (error) {
      // If we can't get the last hash, start fresh
      this.previousHash = null;
    }
  }

  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateRecordHash(record: AuditRecord): string {
    // Create a consistent string representation for hashing
    const hashInput = [
      record.id,
      record.tenantId || '',
      record.userId || '',
      record.eventType,
      record.resourceType,
      record.resourceId || '',
      record.action,
      JSON.stringify(record.oldValues || {}),
      JSON.stringify(record.newValues || {}),
      JSON.stringify(record.metadata || {}),
      record.timestamp.toISOString(),
      record.previousHash || ''
    ].join('|');

    return createHash('sha256').update(hashInput).digest('hex');
  }

  private async storeAuditRecord(record: AuditRecord): Promise<void> {
    const prisma = getMasterPrisma();
    
    await prisma.auditLog.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        userId: record.userId,
        sessionId: record.sessionId,
        eventType: record.eventType,
        resourceType: record.resourceType,
        resourceId: record.resourceId,
        action: record.action,
        oldValues: record.oldValues,
        newValues: record.newValues,
        metadata: record.metadata,
        ipAddress: record.ipAddress,
        userAgent: record.userAgent,
        severity: record.severity,
        timestamp: record.timestamp,
        hash: record.hash,
        previousHash: record.previousHash,
        correlationId: record.correlationId,
        complianceRelevant: record.complianceRelevant
      }
    });
  }

  private async getAuditRecord(recordId: string): Promise<AuditRecord | null> {
    const prisma = getMasterPrisma();
    const record = await prisma.auditLog.findUnique({
      where: { id: recordId }
    });
    
    return record as AuditRecord | null;
  }

  private async getPreviousAuditRecord(timestamp: Date): Promise<AuditRecord | null> {
    const prisma = getMasterPrisma();
    const record = await prisma.auditLog.findFirst({
      where: { timestamp: { lt: timestamp } },
      orderBy: { timestamp: 'desc' }
    });
    
    return record as AuditRecord | null;
  }

  private async getRecordsForArchiving(eventType: AuditEventType, archiveDate: Date, cutoffDate: Date): Promise<AuditRecord[]> {
    const prisma = getMasterPrisma();
    const records = await prisma.auditLog.findMany({
      where: {
        eventType,
        timestamp: {
          gte: cutoffDate,
          lt: archiveDate
        }
      }
    });
    
    return records as AuditRecord[];
  }

  private async getRecordsForDeletion(eventType: AuditEventType, cutoffDate: Date): Promise<AuditRecord[]> {
    const prisma = getMasterPrisma();
    const records = await prisma.auditLog.findMany({
      where: {
        eventType,
        timestamp: { lt: cutoffDate }
      }
    });
    
    return records as AuditRecord[];
  }

  private async archiveRecords(records: AuditRecord[]): Promise<void> {
    // In a real implementation, this would move records to an archive storage
    console.log(`Archiving ${records.length} audit records`);
  }

  private async deleteRecords(records: AuditRecord[]): Promise<void> {
    const prisma = getMasterPrisma();
    const recordIds = records.map(r => r.id);
    
    await prisma.auditLog.deleteMany({
      where: { id: { in: recordIds } }
    });
  }
}

// Singleton instance
export const auditTrailService = AuditTrailService.getInstance();