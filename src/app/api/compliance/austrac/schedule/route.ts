// LIQUID ABT - AUSTRAC Automated Reporting Schedule API
// Configure and manage automated AUSTRAC report generation

import { NextRequest, NextResponse } from 'next/server';
import { austracReportingService, AUSTRACReportType } from '@/lib/compliance/austracReporting';
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

    // Check if user has compliance privileges
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER' && userInfo.role !== 'COMPLIANCE') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges for AUSTRAC scheduling' },
        { status: 403 }
      );
    }

    const body = await request.json();
    
    // Validate required fields
    if (!body.reportType || !body.frequency) {
      return NextResponse.json(
        { error: 'reportType and frequency are required' },
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

    // Validate frequency
    const validFrequencies = ['daily', 'weekly', 'monthly'];
    if (!validFrequencies.includes(body.frequency)) {
      return NextResponse.json(
        { error: 'Invalid frequency. Must be one of: ' + validFrequencies.join(', ') },
        { status: 400 }
      );
    }

    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;

    // Schedule automatic reporting
    await austracReportingService.scheduleAutomaticReporting(
      body.reportType,
      body.frequency,
      tenantId !== 'global' ? tenantId : undefined
    );

    return NextResponse.json({
      success: true,
      message: 'Automatic AUSTRAC reporting scheduled successfully',
      configuration: {
        reportType: body.reportType,
        frequency: body.frequency,
        tenantId: tenantId !== 'global' ? tenantId : null,
        scheduledBy: userInfo.sub,
        scheduledAt: new Date().toISOString()
      },
      nextSteps: [
        'Reports will be generated automatically based on the schedule',
        'Monitor report generation in the compliance dashboard',
        'Review and submit reports as required',
        'Update schedule as needed for compliance requirements'
      ]
    });

  } catch (error) {
    console.error('AUSTRAC scheduling API error:', error);
    
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

    // Check if user has compliance privileges
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER' && userInfo.role !== 'COMPLIANCE') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges for AUSTRAC scheduling' },
        { status: 403 }
      );
    }

    // This would retrieve existing schedules from the database
    // For now, return a placeholder response
    return NextResponse.json({
      schedules: [],
      message: 'Schedule retrieval not implemented yet - check Redis cache for active schedules'
    });

  } catch (error) {
    console.error('AUSTRAC schedule retrieval API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}