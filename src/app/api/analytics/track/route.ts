// LIQUID ABT - Analytics Tracking Endpoint
// Track user events and onboarding progress

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';

export async function POST(request: NextRequest) {
  try {
    const { event, properties } = await request.json();
    
    if (!event) {
      return NextResponse.json(
        { error: 'Missing event name' },
        { status: 400 }
      );
    }

    // Get client information
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';
    const referer = request.headers.get('referer') || null;

    // Get database connection (using public schema for analytics)
    const db = await getDatabase('public');
    
    // Store analytics event
    await db.query(`
      INSERT INTO analytics_events (
        event_name,
        properties,
        user_agent,
        ip_address,
        referer,
        timestamp,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW()
      )
    `, [
      event,
      JSON.stringify(properties || {}),
      userAgent,
      ip,
      referer,
      new Date(),
    ]);

    // Special handling for beta onboarding events
    if (event.startsWith('beta_onboarding')) {
      await handleBetaOnboardingEvent(event, properties, db);
    }

    // Special handling for integration events
    if (event.startsWith('integration_')) {
      await handleIntegrationEvent(event, properties, db);
    }

    // Log important events to console for development
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 Analytics: ${event}`, properties);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Event tracked successfully' 
    });
    
  } catch (error) {
    console.error('Analytics tracking error:', error);
    
    // Don't fail requests due to analytics errors
    return NextResponse.json({ 
      success: false, 
      message: 'Analytics tracking failed' 
    });
  }
}

// Handle beta onboarding specific analytics
async function handleBetaOnboardingEvent(
  event: string, 
  properties: any, 
  db: any
) {
  try {
    if (event === 'beta_onboarding_progress') {
      // Track step completion rates
      await db.query(`
        INSERT INTO beta_onboarding_metrics (
          step_number,
          status,
          session_id,
          timestamp,
          created_at
        ) VALUES (
          $1, $2, $3, $4, NOW()
        )
      `, [
        properties.step,
        properties.status,
        properties.sessionId || 'anonymous',
        new Date(),
      ]);
    }

    if (event === 'beta_onboarding_completed') {
      // Track successful completions
      await db.query(`
        INSERT INTO beta_completion_metrics (
          tenant_id,
          company_name,
          industry,
          monthly_revenue,
          conversion_percentage,
          wallet_type,
          completion_time,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW()
        )
      `, [
        properties.tenantId,
        properties.companyName,
        properties.industry,
        properties.monthlyRevenue,
        properties.conversionPercentage,
        properties.walletType,
        new Date(),
      ]);
    }
  } catch (error) {
    console.error('Beta onboarding event tracking error:', error);
  }
}

// Handle integration specific analytics
async function handleIntegrationEvent(
  event: string,
  properties: any,
  db: any
) {
  try {
    await db.query(`
      INSERT INTO integration_metrics (
        event_type,
        integration_provider,
        tenant_id,
        success,
        error_message,
        properties,
        timestamp,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW()
      )
    `, [
      event,
      properties.provider || 'unknown',
      properties.tenantId || null,
      properties.success || false,
      properties.error || null,
      JSON.stringify(properties),
      new Date(),
    ]);
  } catch (error) {
    console.error('Integration event tracking error:', error);
  }
}

// GET endpoint for analytics dashboard (future use)
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const eventType = url.searchParams.get('event');
    const timeframe = url.searchParams.get('timeframe') || '7d';
    
    const db = await getDatabase('public');
    
    // Basic analytics query
    const result = await db.query(`
      SELECT 
        event_name,
        COUNT(*) as count,
        DATE(created_at) as date
      FROM analytics_events 
      WHERE 
        created_at >= NOW() - INTERVAL '${timeframe}'
        ${eventType ? `AND event_name = '${eventType}'` : ''}
      GROUP BY event_name, DATE(created_at)
      ORDER BY date DESC
      LIMIT 100
    `);

    return NextResponse.json({
      success: true,
      data: result.rows,
      timeframe,
    });

  } catch (error) {
    console.error('Analytics query error:', error);
    
    return NextResponse.json(
      { error: 'Failed to fetch analytics data' },
      { status: 500 }
    );
  }
}