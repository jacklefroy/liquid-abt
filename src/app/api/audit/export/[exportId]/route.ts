// LIQUID ABT - Individual Audit Export Status API
// Check status of specific audit trail exports

import { NextRequest, NextResponse } from 'next/server';
import { auditTrailExportService } from '@/lib/audit/auditTrailExport';
import { validateJWT } from '@/lib/auth/jwt';
import { headers } from 'next/headers';

interface RouteParams {
  params: {
    exportId: string;
  };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
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

    const { exportId } = params;

    // Validate export ID format
    if (!exportId || !exportId.match(/^audit_\d{8}_[a-f0-9]{8}$/)) {
      return NextResponse.json(
        { error: 'Invalid export ID format' },
        { status: 400 }
      );
    }

    // Get export status
    const auditExport = await auditTrailExportService.getExportStatus(exportId);
    
    if (!auditExport) {
      return NextResponse.json(
        { error: 'Export not found' },
        { status: 404 }
      );
    }

    // Verify user has access to this export
    if (auditExport.metadata.requestedBy !== userInfo.userId) {
      return NextResponse.json(
        { error: 'Access denied - You can only view your own exports' },
        { status: 403 }
      );
    }

    // Calculate progress information
    let progressInfo = {};
    if (auditExport.status === 'processing') {
      progressInfo = {
        estimatedTimeRemaining: '2-10 minutes',
        currentPhase: 'Collecting audit data and generating export file'
      };
    } else if (auditExport.status === 'completed') {
      progressInfo = {
        downloadAvailable: true,
        downloadUrl: `/api/audit/export/${exportId}/download`,
        expiresAt: new Date(auditExport.generatedAt.getTime() + (auditExport.metadata.retentionDays * 24 * 60 * 60 * 1000)).toISOString()
      };
    }

    return NextResponse.json({
      export: auditExport,
      progress: progressInfo,
      actions: auditExport.status === 'completed' ? [
        'Download export file',
        'Verify export contents',
        'Store export for compliance records'
      ] : auditExport.status === 'processing' ? [
        'Wait for processing to complete',
        'Check status again in a few minutes'
      ] : [
        'Check export logs for error details',
        'Contact support if issue persists'
      ]
    });

  } catch (error) {
    console.error('Get audit export status API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}