// LIQUID ABT - AUSTRAC Report Submission API
// Submit validated reports to AUSTRAC

import { NextRequest, NextResponse } from 'next/server';
import { austracReportingService } from '@/lib/compliance/austracReporting';
import { validateJWT } from '@/lib/auth/jwt';
import { headers } from 'next/headers';

interface RouteParams {
  params: {
    reportId: string;
  };
}

export async function POST(
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

    // Check if user has compliance privileges for submission
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER' && userInfo.role !== 'COMPLIANCE') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges for AUSTRAC report submission' },
        { status: 403 }
      );
    }

    const { reportId } = params;

    // Validate report ID format
    if (!reportId || !reportId.match(/^(TTR|SMR|IFTI|CAR|CIR)_\d{8}_[a-f0-9]{8}$/)) {
      return NextResponse.json(
        { error: 'Invalid report ID format' },
        { status: 400 }
      );
    }

    console.log('Submitting AUSTRAC report:', {
      reportId,
      submittedBy: userInfo.sub,
      timestamp: new Date().toISOString()
    });

    // Submit report to AUSTRAC
    const submissionResult = await austracReportingService.submitReport(reportId);

    if (submissionResult) {
      return NextResponse.json({
        success: true,
        reportId,
        status: 'submitted',
        message: 'Report submitted to AUSTRAC successfully',
        submittedBy: userInfo.sub,
        submittedAt: new Date().toISOString(),
        nextSteps: [
          'Monitor submission status in AUSTRAC portal',
          'Await confirmation receipt from AUSTRAC',
          'Retain submission records for audit purposes'
        ]
      });
    } else {
      return NextResponse.json({
        success: false,
        reportId,
        status: 'failed',
        error: 'Failed to submit report to AUSTRAC',
        recommendations: [
          'Verify report is in validated status',
          'Check AUSTRAC system availability',
          'Review report content for compliance issues',
          'Contact compliance team for assistance'
        ]
      }, { status: 500 });
    }

  } catch (error) {
    console.error('AUSTRAC report submission API error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Internal server error during report submission',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}