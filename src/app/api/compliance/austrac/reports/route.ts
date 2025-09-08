// LIQUID ABT - AUSTRAC Reports Management API
// Generate, retrieve, and manage AUSTRAC compliance reports

import { NextRequest, NextResponse } from 'next/server';
import { austracReportingService, AUSTRACReportType } from '@/lib/compliance/austracReporting';
import { validateJWT } from '@/lib/auth/jwt';
import { headers } from 'next/headers';

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

    // Check if user has compliance privileges
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER' && userInfo.role !== 'COMPLIANCE') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges for AUSTRAC reporting' },
        { status: 403 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;
    const reportType = searchParams.get('type') as AUSTRACReportType;
    const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined;
    const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined;

    // Get AUSTRAC reports
    const reports = await austracReportingService.getReports(
      startDate,
      endDate,
      reportType,
      tenantId !== 'global' ? tenantId : undefined
    );

    return NextResponse.json({
      reports,
      total: reports.length,
      filters: {
        reportType,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        tenantId: tenantId !== 'global' ? tenantId : null
      },
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('AUSTRAC reports API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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

    // Check if user has compliance privileges
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER' && userInfo.role !== 'COMPLIANCE') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges for AUSTRAC reporting' },
        { status: 403 }
      );
    }

    const body = await request.json();
    
    // Validate required fields
    if (!body.reportType || !body.startDate || !body.endDate) {
      return NextResponse.json(
        { error: 'reportType, startDate, and endDate are required' },
        { status: 400 }
      );
    }

    // Validate report type
    if (!Object.values(AUSTRACReportType).includes(body.reportType)) {
      return NextResponse.json(
        { error: 'Invalid report type. Must be one of: ' + Object.values(AUSTRACReportType).join(', ') },
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

    // Generate report based on type
    let report;
    switch (body.reportType) {
      case AUSTRACReportType.THRESHOLD_TRANSACTION_REPORT:
        report = await austracReportingService.generateTTR(
          startDate,
          endDate,
          tenantId !== 'global' ? tenantId : undefined
        );
        break;

      case AUSTRACReportType.SUSPICIOUS_MATTER_REPORT:
        report = await austracReportingService.generateSMR(
          startDate,
          endDate,
          tenantId !== 'global' ? tenantId : undefined
        );
        break;

      default:
        return NextResponse.json(
          { error: `Report type ${body.reportType} not yet implemented` },
          { status: 501 }
        );
    }

    return NextResponse.json({
      success: true,
      report,
      message: `${body.reportType} report generated successfully`,
      generatedBy: userInfo.sub,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Generate AUSTRAC report API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}