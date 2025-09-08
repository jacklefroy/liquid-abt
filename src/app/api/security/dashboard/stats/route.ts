// LIQUID ABT - Security Dashboard Statistics API
// Provides real-time security metrics for the dashboard

import { NextRequest, NextResponse } from 'next/server';
import { securityMetricsService } from '@/lib/security/securityMetrics';
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

    // Check if user has admin privileges for security dashboard
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges' },
        { status: 403 }
      );
    }

    // Get tenant ID from header (for tenant-specific stats) or use from JWT
    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;

    // Get security dashboard statistics
    const stats = await securityMetricsService.getDashboardStats();

    // Add tenant-specific risk score if tenant is specified
    let tenantRiskScore = 0;
    if (tenantId && tenantId !== 'global') {
      tenantRiskScore = await securityMetricsService.getTenantRiskScore(tenantId);
    }

    return NextResponse.json({
      ...stats,
      tenantRiskScore,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Security dashboard stats API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}