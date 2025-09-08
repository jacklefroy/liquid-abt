// LIQUID ABT - Security Alerts API
// Manages security alerts for the dashboard

import { NextRequest, NextResponse } from 'next/server';
import { securityMetricsService, SecuritySeverity } from '@/lib/security/securityMetrics';
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

    // Check if user has admin privileges for security alerts
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges' },
        { status: 403 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;
    const severity = searchParams.get('severity') as SecuritySeverity | undefined;
    const limit = parseInt(searchParams.get('limit') || '50');

    // Get active security alerts
    const alerts = await securityMetricsService.getActiveAlerts(
      tenantId !== 'global' ? tenantId : undefined,
      severity,
      limit
    );

    return NextResponse.json({
      alerts,
      total: alerts.length,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Security alerts API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}