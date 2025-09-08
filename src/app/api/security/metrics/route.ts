// LIQUID ABT - Security Metrics API
// Provides historical security metrics for dashboard charts

import { NextRequest, NextResponse } from 'next/server';
import { securityMetricsService, SecurityMetricType } from '@/lib/security/securityMetrics';
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

    // Check if user has admin privileges
    if (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient privileges' },
        { status: 403 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;
    const timeframe = searchParams.get('timeframe') || '24h';
    const metricType = searchParams.get('type') as SecurityMetricType;

    // Convert timeframe to hours
    const timeframeHours = {
      '1h': 1,
      '24h': 24,
      '7d': 24 * 7,
      '30d': 24 * 30
    }[timeframe] || 24;

    let metrics;
    
    if (metricType) {
      // Get specific metric type
      metrics = await securityMetricsService.getMetrics(
        metricType,
        tenantId !== 'global' ? tenantId : undefined,
        timeframeHours
      );
    } else {
      // Get all metric types
      const allMetricTypes = Object.values(SecurityMetricType);
      const metricsPromises = allMetricTypes.map(type =>
        securityMetricsService.getMetrics(
          type,
          tenantId !== 'global' ? tenantId : undefined,
          timeframeHours
        )
      );
      
      const allMetrics = await Promise.all(metricsPromises);
      
      // Flatten and sort by timestamp
      metrics = allMetrics
        .flat()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    // Group metrics by type for easier consumption
    const metricsByType = metrics.reduce((acc, metric) => {
      if (!acc[metric.metricType]) {
        acc[metric.metricType] = [];
      }
      acc[metric.metricType].push(metric);
      return acc;
    }, {} as Record<string, typeof metrics>);

    return NextResponse.json({
      metrics,
      metricsByType,
      timeframe,
      total: metrics.length,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Security metrics API error:', error);
    
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

    // Only system-level operations can create metrics directly
    // Most metrics should be created through specific service functions
    if (userInfo.role !== 'SYSTEM') {
      return NextResponse.json(
        { error: 'Forbidden - Direct metric creation not allowed' },
        { status: 403 }
      );
    }

    const body = await request.json();
    
    // Validate required fields
    if (!body.metricType || body.value === undefined) {
      return NextResponse.json(
        { error: 'metricType and value are required' },
        { status: 400 }
      );
    }

    // Validate metric type
    if (!Object.values(SecurityMetricType).includes(body.metricType)) {
      return NextResponse.json(
        { error: 'Invalid metric type' },
        { status: 400 }
      );
    }

    const tenantId = headersList.get('x-tenant-id') || userInfo.tenantId;

    // Record the metric
    const metric = await securityMetricsService.recordMetric(
      body.metricType,
      body.value,
      tenantId !== 'global' ? tenantId : undefined,
      body.metadata
    );

    return NextResponse.json({
      success: true,
      metric,
      message: 'Security metric recorded successfully'
    });

  } catch (error) {
    console.error('Record security metric API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}