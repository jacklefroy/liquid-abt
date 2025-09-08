// LIQUID ABT - Audit Trail Export API
// Request and manage comprehensive audit trail exports

import { NextRequest, NextResponse } from 'next/server';
import { auditTrailExportService, AuditExportType, ExportFormat, ComplianceFramework } from '@/lib/audit/auditTrailExport';
import { validateJWT } from '@/lib/auth/jwt';
import { headers } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    // Extract JWT from Authorization header
    const headersList = headers();
    const authorization = headersList.get('authorization');
    
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - Missing or invalid token' },
        { status: 401 }
      );
    }

    const token = authorization.substring(7);
    
    // Validate JWT and extract user info
    const userInfo = await validateJWT(token);
    if (!userInfo) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }

    // Check if user has admin privileges for audit exports
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges for audit trail exports' },
        { status: 403 }
      );
    }

    const body = await request.json();
    
    // Validate required fields
    if (!body.exportType || !body.startDate || !body.endDate || !body.format) {
      return NextResponse.json(
        { error: 'exportType, startDate, endDate, and format are required' },
        { status: 400 }
      );
    }

    // Validate export type
    if (!Object.values(AuditExportType).includes(body.exportType)) {
      return NextResponse.json(
        { error: 'Invalid export type. Must be one of: ' + Object.values(AuditExportType).join(', ') },
        { status: 400 }
      );
    }

    // Validate format
    if (!Object.values(ExportFormat).includes(body.format)) {
      return NextResponse.json(
        { error: 'Invalid format. Must be one of: ' + Object.values(ExportFormat).join(', ') },
        { status: 400 }
      );
    }

    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);

    // Validate date range
    if (startDate >= endDate) {
      return NextResponse.json(
        { error: 'Start date must be before end date' },
        { status: 400 }
      );
    }

    // Validate date range is not too large (prevent system overload)
    const daysDifference = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDifference > 365) {
      return NextResponse.json(
        { error: 'Date range cannot exceed 365 days' },
        { status: 400 }
      );
    }

    // Request audit export
    const auditExport = await auditTrailExportService.requestExport(
      body.exportType,
      { startDate, endDate },
      body.filters || {},
      body.format,
      userInfo.userId,
      tenantId !== 'global' ? tenantId : undefined,
      {
        exportReason: body.exportReason,
        complianceFramework: body.complianceFramework,
        retentionDays: body.retentionDays,
        encryptionEnabled: body.encryptionEnabled !== false
      }
    );

    return NextResponse.json({
      success: true,
      export: auditExport,
      message: 'Audit trail export requested successfully',
      estimatedCompletionTime: '5-15 minutes for typical exports',
      nextSteps: [
        'Monitor export status using GET /api/audit/export/{exportId}',
        'Download completed export using GET /api/audit/export/{exportId}/download',
        'Export will be available for download for the specified retention period'
      ]
    });

  } catch (error) {
    console.error('Audit export request API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Extract JWT from Authorization header
    const headersList = headers();
    const authorization = headersList.get('authorization');
    
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - Missing or invalid token' },
        { status: 401 }
      );
    }

    const token = authorization.substring(7);
    
    // Validate JWT and extract user info
    const userInfo = await validateJWT(token);
    if (!userInfo) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }

    // Check if user has admin privileges
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges for audit trail exports' },
        { status: 403 }
      );
    }

    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;
    
    // Get user's export history
    const exportHistory = await auditTrailExportService.getUserExportHistory(
      userInfo.userId,
      tenantId !== 'global' ? tenantId : undefined,
      20
    );

    return NextResponse.json({
      exports: exportHistory,
      total: exportHistory.length,
      user: userInfo.userId,
      tenantId: tenantId !== 'global' ? tenantId : null
    });

  } catch (error) {
    console.error('Get audit export history API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}