// LIQUID ABT - Individual Security Alert Management API
// Update alert status and manage individual alerts

import { NextRequest, NextResponse } from 'next/server';
import { securityMetricsService } from '@/lib/security/securityMetrics';
import { validateJWT } from '@/lib/auth/jwt';
import { headers } from 'next/headers';

interface RouteParams {
  params: {
    alertId: string;
  };
}

export async function PATCH(
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
        { error: 'Forbidden - Insufficient privileges' },
        { status: 403 }
      );
    }

    const { alertId } = params;
    const body = await request.json();
    
    // Validate required fields
    if (!body.status) {
      return NextResponse.json(
        { error: 'Status is required' },
        { status: 400 }
      );
    }

    // Validate status value
    const validStatuses = ['new', 'investigating', 'resolved', 'false_positive'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') },
        { status: 400 }
      );
    }

    // Update alert status
    await securityMetricsService.updateAlertStatus(
      alertId,
      body.status,
      userInfo.sub, // assigned_to
      body.resolutionNotes
    );

    return NextResponse.json({
      success: true,
      message: 'Alert status updated successfully',
      alertId,
      status: body.status,
      updatedBy: userInfo.sub,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Update alert status API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
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
        { error: 'Forbidden - Insufficient privileges' },
        { status: 403 }
      );
    }

    const { alertId } = params;
    
    // Get specific alert details (would implement this method)
    // For now, return a placeholder response
    return NextResponse.json({
      alertId,
      message: 'Alert details retrieval not implemented yet'
    });

  } catch (error) {
    console.error('Get alert details API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}