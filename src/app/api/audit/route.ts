// LIQUID ABT - Audit Trail API Endpoints
// Secure access to audit records for compliance and investigation

import { NextRequest, NextResponse } from 'next/server';
import { auditTrailService, AuditQueryFilters, AuditEventType, AuditSeverity } from '@/lib/database/audit';
import { appLogger, LogCategory } from '@/lib/logging/logger';

// Auth middleware would validate JWT and extract user info
interface AuthenticatedRequest extends NextRequest {
  user?: {
    id: string;
    tenantId?: string;
    role: string;
    permissions: string[];
  };
}

/**
 * GET /api/audit - Query audit records
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Extract query parameters
    const { searchParams } = new URL(request.url);
    
    const filters: AuditQueryFilters = {
      tenantId: searchParams.get('tenantId') || undefined,
      userId: searchParams.get('userId') || undefined,
      eventType: searchParams.get('eventType') as AuditEventType || undefined,
      resourceType: searchParams.get('resourceType') || undefined,
      resourceId: searchParams.get('resourceId') || undefined,
      severity: searchParams.get('severity') as AuditSeverity || undefined,
      complianceOnly: searchParams.get('complianceOnly') === 'true',
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0
    };

    // Parse date filters
    if (searchParams.get('startDate')) {
      filters.startDate = new Date(searchParams.get('startDate')!);
    }
    if (searchParams.get('endDate')) {
      filters.endDate = new Date(searchParams.get('endDate')!);
    }

    // Query audit records
    const result = await auditTrailService.queryAuditRecords(filters);

    // Log audit access (meta-audit)
    await auditTrailService.logDataAccess(
      filters.tenantId || 'system',
      'api_user', // Would be from JWT
      'audit_logs',
      'query',
      undefined,
      { filters, resultCount: result.records.length }
    );

    return NextResponse.json({
      success: true,
      data: result.records,
      pagination: {
        totalCount: result.totalCount,
        limit: filters.limit || 50,
        offset: filters.offset || 0,
        hasMore: result.hasMore
      }
    });

  } catch (error) {
    appLogger.error('Audit query failed', {
      category: LogCategory.SYSTEM,
      action: 'audit_query_error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to query audit records',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/audit/export - Export audit records
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    
    const {
      filters = {},
      format = 'csv'
    } = body;

    // Validate format
    if (!['csv', 'json'].includes(format)) {
      return NextResponse.json(
        { success: false, error: 'Invalid format. Use csv or json.' },
        { status: 400 }
      );
    }

    // Export audit records
    const exportResult = await auditTrailService.exportAuditRecords(filters, format);

    // Log audit export (compliance event)
    await auditTrailService.logComplianceEvent(
      filters.tenantId || 'system',
      AuditEventType.DATA_EXPORT,
      'audit_export',
      `Audit records exported in ${format} format`,
      { filters, filename: exportResult.filename },
      'api_user' // Would be from JWT
    );

    // Return file content with appropriate headers
    return new NextResponse(exportResult.content, {
      status: 200,
      headers: {
        'Content-Type': exportResult.mimeType,
        'Content-Disposition': `attachment; filename="${exportResult.filename}"`,
        'Content-Length': Buffer.byteLength(exportResult.content).toString()
      }
    });

  } catch (error) {
    appLogger.error('Audit export failed', {
      category: LogCategory.SYSTEM,
      action: 'audit_export_error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to export audit records',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}