// LIQUID ABT - Audit Export Download API
// Download completed audit trail export files

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
        { error: 'Forbidden - Insufficient privileges for audit trail downloads' },
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

    console.log('Audit export download requested:', {
      exportId,
      requestedBy: userInfo.userId,
      timestamp: new Date().toISOString()
    });

    // Download export file
    const downloadResult = await auditTrailExportService.downloadExport(exportId, userInfo.userId);
    
    if (!downloadResult) {
      return NextResponse.json(
        { error: 'Export file not available or access denied' },
        { status: 404 }
      );
    }

    // Log the download for audit purposes
    await auditTrailExportService.recordAuditEvent(
      'audit_export_downloaded',
      'data_access',
      'audit_export',
      'download',
      'success',
      {
        exportId,
        downloadedBy: userInfo.userId,
        fileSize: downloadResult.content.length,
        filename: downloadResult.filename
      },
      userInfo.tenantId,
      userInfo.userId,
      {
        ipAddress: headersList.get('x-forwarded-for') || 'unknown',
        userAgent: headersList.get('user-agent') || 'unknown'
      }
    );

    // Return file with appropriate headers
    return new NextResponse(downloadResult.content, {
      status: 200,
      headers: {
        'Content-Type': downloadResult.contentType,
        'Content-Disposition': `attachment; filename="${downloadResult.filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Download-Info': JSON.stringify({
          exportId,
          generatedAt: new Date().toISOString(),
          downloadedBy: userInfo.userId
        })
      }
    });

  } catch (error) {
    console.error('Audit export download API error:', error);
    
    // Log failed download attempt
    try {
      const headersList = headers();
      const token = headersList.get('authorization')?.substring(7);
      const userInfo = token ? await validateJWT(token) : null;
      
      if (userInfo) {
        await auditTrailExportService.recordAuditEvent(
          'audit_export_download_failed',
          'security_event',
          'audit_export',
          'download',
          'failure',
          {
            exportId: params.exportId,
            error: error instanceof Error ? error.message : 'Unknown error',
            attemptedBy: userInfo.userId
          },
          userInfo.tenantId,
          userInfo.userId
        );
      }
    } catch (auditError) {
      console.error('Failed to log download failure:', auditError);
    }
    
    return NextResponse.json(
      { error: 'Internal server error during download' },
      { status: 500 }
    );
  }
}