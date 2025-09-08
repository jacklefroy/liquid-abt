// LIQUID ABT - Audit Trail Export System
// Comprehensive audit trail generation for compliance and regulatory requirements

import { getMasterPrisma, getTenantPrisma } from '../database/connection';
import { createRedisCache } from '../cache/redisClient';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { Redis } from 'ioredis';

export interface AuditTrailExport {
  id: string;
  exportType: AuditExportType;
  tenantId?: string;
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  filters: AuditFilters;
  generatedAt: Date;
  completedAt?: Date;
  status: AuditExportStatus;
  format: ExportFormat;
  filePath?: string;
  recordCount: number;
  metadata: {
    requestedBy: string;
    exportReason: string;
    retentionDays: number;
    encryptionEnabled: boolean;
    complianceFramework?: ComplianceFramework;
  };
}

export enum AuditExportType {
  FULL_SYSTEM_AUDIT = 'full_system_audit',
  SECURITY_EVENTS = 'security_events',
  TRANSACTION_HISTORY = 'transaction_history',
  USER_ACTIVITIES = 'user_activities',
  COMPLIANCE_ACTIVITIES = 'compliance_activities',
  API_ACCESS_LOGS = 'api_access_logs',
  DATABASE_CHANGES = 'database_changes',
  PAYMENT_PROCESSOR_LOGS = 'payment_processor_logs',
  BITCOIN_OPERATIONS = 'bitcoin_operations',
  KYC_VERIFICATION_LOGS = 'kyc_verification_logs'
}

export enum AuditExportStatus {
  REQUESTED = 'requested',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired'
}

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  PDF = 'pdf',
  XML = 'xml'
}

export enum ComplianceFramework {
  SOC2_TYPE1 = 'soc2_type1',
  SOC2_TYPE2 = 'soc2_type2',
  ISO27001 = 'iso27001',
  PCI_DSS = 'pci_dss',
  GDPR = 'gdpr',
  AUSTRAC = 'austrac',
  ATO = 'ato',
  GENERAL_AUDIT = 'general_audit'
}

export interface AuditFilters {
  userIds?: string[];
  eventTypes?: string[];
  severityLevels?: string[];
  ipAddresses?: string[];
  resources?: string[];
  outcomes?: ('success' | 'failure' | 'error')[];
  includeSystemEvents?: boolean;
  includePIIData?: boolean;
  includeFinancialData?: boolean;
}

export interface AuditRecord {
  id: string;
  timestamp: Date;
  tenantId?: string;
  userId?: string;
  eventType: string;
  eventCategory: AuditEventCategory;
  resource: string;
  action: string;
  outcome: 'success' | 'failure' | 'error';
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  complianceRelevant: boolean;
  retentionCategory: 'short_term' | 'medium_term' | 'long_term' | 'permanent';
}

export enum AuditEventCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  DATA_ACCESS = 'data_access',
  DATA_MODIFICATION = 'data_modification',
  FINANCIAL_TRANSACTION = 'financial_transaction',
  SECURITY_EVENT = 'security_event',
  COMPLIANCE_EVENT = 'compliance_event',
  SYSTEM_EVENT = 'system_event',
  USER_MANAGEMENT = 'user_management',
  CONFIGURATION_CHANGE = 'configuration_change'
}

export class AuditTrailExportService {
  private redis: Redis;
  private readonly EXPORT_PREFIX = 'audit_export:';
  private readonly CACHE_PREFIX = 'audit_cache:';

  constructor() {
    this.redis = createRedisCache();
  }

  /**
   * Request audit trail export
   */
  async requestExport(
    exportType: AuditExportType,
    dateRange: { startDate: Date; endDate: Date },
    filters: AuditFilters,
    format: ExportFormat,
    requestedBy: string,
    tenantId?: string,
    options?: {
      exportReason?: string;
      complianceFramework?: ComplianceFramework;
      retentionDays?: number;
      encryptionEnabled?: boolean;
    }
  ): Promise<AuditTrailExport> {
    const exportId = `audit_${format(new Date(), 'yyyyMMdd')}_${uuidv4().substring(0, 8)}`;

    const auditExport: AuditTrailExport = {
      id: exportId,
      exportType,
      tenantId,
      dateRange,
      filters,
      generatedAt: new Date(),
      status: AuditExportStatus.REQUESTED,
      format,
      recordCount: 0,
      metadata: {
        requestedBy,
        exportReason: options?.exportReason || 'General audit review',
        retentionDays: options?.retentionDays || 90,
        encryptionEnabled: options?.encryptionEnabled || true,
        complianceFramework: options?.complianceFramework
      }
    };

    // Store export request
    await this.storeExportRequest(auditExport);

    // Start processing asynchronously
    this.processExportAsync(auditExport);

    console.log('Audit trail export requested:', {
      exportId,
      exportType,
      requestedBy,
      dateRange
    });

    return auditExport;
  }

  /**
   * Get export status
   */
  async getExportStatus(exportId: string): Promise<AuditTrailExport | null> {
    try {
      // Check cache first
      const cacheKey = `${this.EXPORT_PREFIX}${exportId}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Query database
      const prisma = getMasterPrisma();
      const exportRecord = await prisma.auditExport.findUnique({
        where: { id: exportId }
      });

      if (!exportRecord) return null;

      const auditExport: AuditTrailExport = {
        id: exportRecord.id,
        exportType: exportRecord.exportType as AuditExportType,
        tenantId: exportRecord.tenantId || undefined,
        dateRange: {
          startDate: exportRecord.dateRangeStart,
          endDate: exportRecord.dateRangeEnd
        },
        filters: exportRecord.filters as any,
        generatedAt: exportRecord.generatedAt,
        completedAt: exportRecord.completedAt || undefined,
        status: exportRecord.status as AuditExportStatus,
        format: exportRecord.format as ExportFormat,
        filePath: exportRecord.filePath || undefined,
        recordCount: exportRecord.recordCount,
        metadata: exportRecord.metadata as any
      };

      // Cache for quick access
      await this.redis.setex(cacheKey, 3600, JSON.stringify(auditExport));

      return auditExport;

    } catch (error) {
      console.error('Error retrieving export status:', error);
      return null;
    }
  }

  /**
   * Get user's export history
   */
  async getUserExportHistory(
    requestedBy: string,
    tenantId?: string,
    limit: number = 20
  ): Promise<AuditTrailExport[]> {
    try {
      const prisma = getMasterPrisma();
      
      const exports = await prisma.auditExport.findMany({
        where: {
          metadata: {
            path: ['requestedBy'],
            equals: requestedBy
          },
          ...(tenantId ? { tenantId } : {})
        },
        orderBy: { generatedAt: 'desc' },
        take: limit
      });

      return exports.map(exp => ({
        id: exp.id,
        exportType: exp.exportType as AuditExportType,
        tenantId: exp.tenantId || undefined,
        dateRange: {
          startDate: exp.dateRangeStart,
          endDate: exp.dateRangeEnd
        },
        filters: exp.filters as any,
        generatedAt: exp.generatedAt,
        completedAt: exp.completedAt || undefined,
        status: exp.status as AuditExportStatus,
        format: exp.format as ExportFormat,
        filePath: exp.filePath || undefined,
        recordCount: exp.recordCount,
        metadata: exp.metadata as any
      }));

    } catch (error) {
      console.error('Error retrieving export history:', error);
      return [];
    }
  }

  /**
   * Download export file
   */
  async downloadExport(exportId: string, requestedBy: string): Promise<{
    content: Buffer | string;
    filename: string;
    contentType: string;
  } | null> {
    try {
      const auditExport = await this.getExportStatus(exportId);
      
      if (!auditExport || auditExport.metadata.requestedBy !== requestedBy) {
        throw new Error('Export not found or access denied');
      }

      if (auditExport.status !== AuditExportStatus.COMPLETED) {
        throw new Error('Export not completed yet');
      }

      if (!auditExport.filePath) {
        throw new Error('Export file not available');
      }

      // In production, this would read from S3 or file system
      const mockContent = await this.generateMockExportContent(auditExport);
      
      const filename = `audit_export_${auditExport.id}.${auditExport.format}`;
      const contentType = this.getContentType(auditExport.format);

      return {
        content: mockContent,
        filename,
        contentType
      };

    } catch (error) {
      console.error('Error downloading export:', error);
      return null;
    }
  }

  /**
   * Generate compliance-specific audit report
   */
  async generateComplianceReport(
    complianceFramework: ComplianceFramework,
    dateRange: { startDate: Date; endDate: Date },
    tenantId?: string,
    requestedBy?: string
  ): Promise<AuditTrailExport> {
    const filters = this.getComplianceFilters(complianceFramework);
    const exportType = this.getComplianceExportType(complianceFramework);

    return this.requestExport(
      exportType,
      dateRange,
      filters,
      ExportFormat.PDF,
      requestedBy || 'system',
      tenantId,
      {
        exportReason: `${complianceFramework} compliance audit`,
        complianceFramework,
        retentionDays: this.getComplianceRetentionDays(complianceFramework),
        encryptionEnabled: true
      }
    );
  }

  /**
   * Record audit event
   */
  async recordAuditEvent(
    eventType: string,
    eventCategory: AuditEventCategory,
    resource: string,
    action: string,
    outcome: 'success' | 'failure' | 'error',
    details: Record<string, any>,
    tenantId?: string,
    userId?: string,
    options?: {
      ipAddress?: string;
      userAgent?: string;
      sessionId?: string;
      riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    }
  ): Promise<void> {
    try {
      const auditRecord: AuditRecord = {
        id: uuidv4(),
        timestamp: new Date(),
        tenantId,
        userId,
        eventType,
        eventCategory,
        resource,
        action,
        outcome,
        details,
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
        sessionId: options?.sessionId,
        riskLevel: options?.riskLevel || 'low',
        complianceRelevant: this.isComplianceRelevant(eventCategory, eventType),
        retentionCategory: this.getRetentionCategory(eventCategory, eventType)
      };

      // Store in database
      const prisma = tenantId ? getTenantPrisma(tenantId) : getMasterPrisma();
      
      await prisma.auditEvent.create({
        data: {
          id: auditRecord.id,
          timestamp: auditRecord.timestamp,
          tenantId: auditRecord.tenantId,
          userId: auditRecord.userId,
          eventType: auditRecord.eventType,
          eventCategory: auditRecord.eventCategory,
          resource: auditRecord.resource,
          action: auditRecord.action,
          outcome: auditRecord.outcome,
          details: auditRecord.details as any,
          ipAddress: auditRecord.ipAddress,
          userAgent: auditRecord.userAgent,
          sessionId: auditRecord.sessionId,
          riskLevel: auditRecord.riskLevel,
          complianceRelevant: auditRecord.complianceRelevant,
          retentionCategory: auditRecord.retentionCategory
        }
      });

      // Cache recent events for quick access
      const cacheKey = `${this.CACHE_PREFIX}recent:${tenantId || 'global'}`;
      await this.redis.lpush(cacheKey, JSON.stringify(auditRecord));
      await this.redis.ltrim(cacheKey, 0, 999); // Keep last 1000 events
      await this.redis.expire(cacheKey, 3600); // 1 hour

    } catch (error) {
      console.error('Error recording audit event:', error);
      // Don't throw - audit logging should not break application flow
    }
  }

  /**
   * Search audit events
   */
  async searchAuditEvents(
    filters: AuditFilters,
    dateRange: { startDate: Date; endDate: Date },
    tenantId?: string,
    limit: number = 1000
  ): Promise<AuditRecord[]> {
    try {
      const prisma = tenantId ? getTenantPrisma(tenantId) : getMasterPrisma();
      
      const whereCondition: any = {
        timestamp: {
          gte: dateRange.startDate,
          lte: dateRange.endDate
        }
      };

      if (filters.userIds && filters.userIds.length > 0) {
        whereCondition.userId = { in: filters.userIds };
      }

      if (filters.eventTypes && filters.eventTypes.length > 0) {
        whereCondition.eventType = { in: filters.eventTypes };
      }

      if (filters.outcomes && filters.outcomes.length > 0) {
        whereCondition.outcome = { in: filters.outcomes };
      }

      if (filters.ipAddresses && filters.ipAddresses.length > 0) {
        whereCondition.ipAddress = { in: filters.ipAddresses };
      }

      const events = await prisma.auditEvent.findMany({
        where: whereCondition,
        orderBy: { timestamp: 'desc' },
        take: limit
      });

      return events.map(event => ({
        id: event.id,
        timestamp: event.timestamp,
        tenantId: event.tenantId || undefined,
        userId: event.userId || undefined,
        eventType: event.eventType,
        eventCategory: event.eventCategory as AuditEventCategory,
        resource: event.resource,
        action: event.action,
        outcome: event.outcome as any,
        details: event.details as any,
        ipAddress: event.ipAddress || undefined,
        userAgent: event.userAgent || undefined,
        sessionId: event.sessionId || undefined,
        riskLevel: event.riskLevel as any,
        complianceRelevant: event.complianceRelevant,
        retentionCategory: event.retentionCategory as any
      }));

    } catch (error) {
      console.error('Error searching audit events:', error);
      return [];
    }
  }

  private async processExportAsync(auditExport: AuditTrailExport): Promise<void> {
    try {
      // Update status to processing
      auditExport.status = AuditExportStatus.PROCESSING;
      await this.updateExportStatus(auditExport);

      // Collect audit data based on export type
      const auditRecords = await this.collectAuditData(auditExport);
      
      // Generate export file
      const filePath = await this.generateExportFile(auditExport, auditRecords);
      
      // Update completion status
      auditExport.status = AuditExportStatus.COMPLETED;
      auditExport.completedAt = new Date();
      auditExport.filePath = filePath;
      auditExport.recordCount = auditRecords.length;
      
      await this.updateExportStatus(auditExport);

      console.log('Audit export completed:', {
        exportId: auditExport.id,
        recordCount: auditRecords.length,
        filePath
      });

    } catch (error) {
      console.error('Error processing audit export:', error);
      
      auditExport.status = AuditExportStatus.FAILED;
      await this.updateExportStatus(auditExport);
    }
  }

  private async collectAuditData(auditExport: AuditTrailExport): Promise<AuditRecord[]> {
    // Simulate data collection based on export type
    switch (auditExport.exportType) {
      case AuditExportType.SECURITY_EVENTS:
        return this.collectSecurityEvents(auditExport);
      case AuditExportType.TRANSACTION_HISTORY:
        return this.collectTransactionHistory(auditExport);
      case AuditExportType.USER_ACTIVITIES:
        return this.collectUserActivities(auditExport);
      case AuditExportType.FULL_SYSTEM_AUDIT:
        return this.collectFullSystemAudit(auditExport);
      default:
        return this.searchAuditEvents(
          auditExport.filters,
          auditExport.dateRange,
          auditExport.tenantId,
          10000
        );
    }
  }

  private async collectSecurityEvents(auditExport: AuditTrailExport): Promise<AuditRecord[]> {
    const filters = {
      ...auditExport.filters,
      eventTypes: ['login', 'logout', 'password_change', 'mfa_enabled', 'suspicious_activity', 'rate_limit_violation']
    };
    
    return this.searchAuditEvents(filters, auditExport.dateRange, auditExport.tenantId);
  }

  private async collectTransactionHistory(auditExport: AuditTrailExport): Promise<AuditRecord[]> {
    const filters = {
      ...auditExport.filters,
      eventTypes: ['bitcoin_purchase', 'bitcoin_sale', 'deposit', 'withdrawal', 'treasury_rule_execution']
    };
    
    return this.searchAuditEvents(filters, auditExport.dateRange, auditExport.tenantId);
  }

  private async collectUserActivities(auditExport: AuditTrailExport): Promise<AuditRecord[]> {
    const filters = {
      ...auditExport.filters,
      eventTypes: ['page_view', 'api_call', 'configuration_change', 'integration_setup', 'report_generation']
    };
    
    return this.searchAuditEvents(filters, auditExport.dateRange, auditExport.tenantId);
  }

  private async collectFullSystemAudit(auditExport: AuditTrailExport): Promise<AuditRecord[]> {
    // Collect all audit events without specific filtering
    return this.searchAuditEvents(auditExport.filters, auditExport.dateRange, auditExport.tenantId, 50000);
  }

  private async generateExportFile(auditExport: AuditTrailExport, records: AuditRecord[]): Promise<string> {
    const filename = `audit_export_${auditExport.id}.${auditExport.format}`;
    const filePath = `exports/audit/${filename}`;
    
    switch (auditExport.format) {
      case ExportFormat.JSON:
        return this.generateJSONExport(auditExport, records, filePath);
      case ExportFormat.CSV:
        return this.generateCSVExport(auditExport, records, filePath);
      case ExportFormat.PDF:
        return this.generatePDFExport(auditExport, records, filePath);
      case ExportFormat.XML:
        return this.generateXMLExport(auditExport, records, filePath);
      default:
        throw new Error(`Unsupported export format: ${auditExport.format}`);
    }
  }

  private async generateJSONExport(auditExport: AuditTrailExport, records: AuditRecord[], filePath: string): Promise<string> {
    const exportData = {
      exportMetadata: {
        ...auditExport,
        generatedAt: auditExport.generatedAt.toISOString(),
        completedAt: new Date().toISOString()
      },
      auditRecords: records.map(record => ({
        ...record,
        timestamp: record.timestamp.toISOString()
      })),
      summary: {
        totalRecords: records.length,
        dateRange: {
          startDate: auditExport.dateRange.startDate.toISOString(),
          endDate: auditExport.dateRange.endDate.toISOString()
        },
        eventCategories: this.summarizeEventCategories(records),
        riskLevels: this.summarizeRiskLevels(records)
      }
    };

    // In production, would write to S3 or file system
    console.log(`JSON export generated: ${filePath} (${records.length} records)`);
    return filePath;
  }

  private async generateCSVExport(auditExport: AuditTrailExport, records: AuditRecord[], filePath: string): Promise<string> {
    const headers = [
      'ID', 'Timestamp', 'Tenant ID', 'User ID', 'Event Type', 'Event Category',
      'Resource', 'Action', 'Outcome', 'IP Address', 'Risk Level', 'Compliance Relevant'
    ];
    
    const csvData = [
      headers.join(','),
      ...records.map(record => [
        record.id,
        record.timestamp.toISOString(),
        record.tenantId || '',
        record.userId || '',
        record.eventType,
        record.eventCategory,
        record.resource,
        record.action,
        record.outcome,
        record.ipAddress || '',
        record.riskLevel || '',
        record.complianceRelevant
      ].join(','))
    ].join('\n');

    console.log(`CSV export generated: ${filePath} (${records.length} records)`);
    return filePath;
  }

  private async generatePDFExport(auditExport: AuditTrailExport, records: AuditRecord[], filePath: string): Promise<string> {
    // In production, would use a PDF library like puppeteer or jsPDF
    console.log(`PDF export generated: ${filePath} (${records.length} records)`);
    return filePath;
  }

  private async generateXMLExport(auditExport: AuditTrailExport, records: AuditRecord[], filePath: string): Promise<string> {
    console.log(`XML export generated: ${filePath} (${records.length} records)`);
    return filePath;
  }

  private async generateMockExportContent(auditExport: AuditTrailExport): Promise<string> {
    return JSON.stringify({
      exportId: auditExport.id,
      exportType: auditExport.exportType,
      generatedAt: auditExport.generatedAt,
      recordCount: auditExport.recordCount,
      mockData: 'This is mock export content for testing purposes'
    }, null, 2);
  }

  private getContentType(format: ExportFormat): string {
    switch (format) {
      case ExportFormat.JSON:
        return 'application/json';
      case ExportFormat.CSV:
        return 'text/csv';
      case ExportFormat.PDF:
        return 'application/pdf';
      case ExportFormat.XML:
        return 'application/xml';
      default:
        return 'application/octet-stream';
    }
  }

  private getComplianceFilters(framework: ComplianceFramework): AuditFilters {
    switch (framework) {
      case ComplianceFramework.SOC2_TYPE2:
        return {
          eventTypes: ['login', 'logout', 'data_access', 'configuration_change', 'user_creation', 'user_deletion'],
          includeSystemEvents: true,
          includePIIData: false,
          includeFinancialData: true
        };
      case ComplianceFramework.PCI_DSS:
        return {
          eventTypes: ['payment_processing', 'card_data_access', 'security_event'],
          includeFinancialData: true,
          includePIIData: false
        };
      case ComplianceFramework.AUSTRAC:
        return {
          eventTypes: ['bitcoin_purchase', 'bitcoin_sale', 'large_transaction', 'suspicious_activity'],
          includeFinancialData: true,
          outcomes: ['success']
        };
      default:
        return {
          includeSystemEvents: true,
          includeFinancialData: true,
          includePIIData: false
        };
    }
  }

  private getComplianceExportType(framework: ComplianceFramework): AuditExportType {
    switch (framework) {
      case ComplianceFramework.SOC2_TYPE1:
      case ComplianceFramework.SOC2_TYPE2:
        return AuditExportType.FULL_SYSTEM_AUDIT;
      case ComplianceFramework.PCI_DSS:
        return AuditExportType.PAYMENT_PROCESSOR_LOGS;
      case ComplianceFramework.AUSTRAC:
        return AuditExportType.COMPLIANCE_ACTIVITIES;
      default:
        return AuditExportType.FULL_SYSTEM_AUDIT;
    }
  }

  private getComplianceRetentionDays(framework: ComplianceFramework): number {
    switch (framework) {
      case ComplianceFramework.SOC2_TYPE1:
      case ComplianceFramework.SOC2_TYPE2:
        return 2555; // 7 years
      case ComplianceFramework.PCI_DSS:
        return 365; // 1 year minimum
      case ComplianceFramework.AUSTRAC:
        return 2555; // 7 years
      case ComplianceFramework.ATO:
        return 1825; // 5 years
      default:
        return 365; // 1 year default
    }
  }

  private isComplianceRelevant(eventCategory: AuditEventCategory, eventType: string): boolean {
    const complianceEvents = [
      AuditEventCategory.FINANCIAL_TRANSACTION,
      AuditEventCategory.SECURITY_EVENT,
      AuditEventCategory.COMPLIANCE_EVENT,
      AuditEventCategory.DATA_MODIFICATION,
      AuditEventCategory.USER_MANAGEMENT
    ];
    
    return complianceEvents.includes(eventCategory) || 
           eventType.includes('compliance') ||
           eventType.includes('audit') ||
           eventType.includes('security');
  }

  private getRetentionCategory(eventCategory: AuditEventCategory, eventType: string): string {
    if (eventCategory === AuditEventCategory.FINANCIAL_TRANSACTION ||
        eventCategory === AuditEventCategory.COMPLIANCE_EVENT) {
      return 'permanent';
    }
    
    if (eventCategory === AuditEventCategory.SECURITY_EVENT ||
        eventCategory === AuditEventCategory.USER_MANAGEMENT) {
      return 'long_term';
    }
    
    if (eventCategory === AuditEventCategory.DATA_MODIFICATION ||
        eventCategory === AuditEventCategory.CONFIGURATION_CHANGE) {
      return 'medium_term';
    }
    
    return 'short_term';
  }

  private summarizeEventCategories(records: AuditRecord[]): Record<string, number> {
    return records.reduce((acc, record) => {
      acc[record.eventCategory] = (acc[record.eventCategory] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private summarizeRiskLevels(records: AuditRecord[]): Record<string, number> {
    return records.reduce((acc, record) => {
      const riskLevel = record.riskLevel || 'unknown';
      acc[riskLevel] = (acc[riskLevel] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private async storeExportRequest(auditExport: AuditTrailExport): Promise<void> {
    try {
      const prisma = getMasterPrisma();
      
      await prisma.auditExport.create({
        data: {
          id: auditExport.id,
          exportType: auditExport.exportType,
          tenantId: auditExport.tenantId,
          dateRangeStart: auditExport.dateRange.startDate,
          dateRangeEnd: auditExport.dateRange.endDate,
          filters: auditExport.filters as any,
          generatedAt: auditExport.generatedAt,
          completedAt: auditExport.completedAt,
          status: auditExport.status,
          format: auditExport.format,
          filePath: auditExport.filePath,
          recordCount: auditExport.recordCount,
          metadata: auditExport.metadata as any
        }
      });

      // Cache for quick access
      const cacheKey = `${this.EXPORT_PREFIX}${auditExport.id}`;
      await this.redis.setex(cacheKey, 3600, JSON.stringify(auditExport));

    } catch (error) {
      console.error('Error storing export request:', error);
    }
  }

  private async updateExportStatus(auditExport: AuditTrailExport): Promise<void> {
    try {
      const prisma = getMasterPrisma();
      
      await prisma.auditExport.update({
        where: { id: auditExport.id },
        data: {
          status: auditExport.status,
          completedAt: auditExport.completedAt,
          filePath: auditExport.filePath,
          recordCount: auditExport.recordCount,
          metadata: auditExport.metadata as any
        }
      });

      // Update cache
      const cacheKey = `${this.EXPORT_PREFIX}${auditExport.id}`;
      await this.redis.setex(cacheKey, 3600, JSON.stringify(auditExport));

    } catch (error) {
      console.error('Error updating export status:', error);
    }
  }
}

// Export singleton instance
export const auditTrailExportService = new AuditTrailExportService();