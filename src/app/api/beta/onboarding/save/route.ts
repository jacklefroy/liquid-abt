// LIQUID ABT - Beta Onboarding Save Endpoint
// Save onboarding progress data

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';

export async function POST(request: NextRequest) {
  try {
    const { step, data } = await request.json();
    
    // Validate request
    if (!step || !data) {
      return NextResponse.json(
        { error: 'Missing step or data' },
        { status: 400 }
      );
    }

    // Get database connection
    const db = await getDatabase('public'); // Using public schema for beta onboarding
    
    // Save onboarding progress
    const result = await db.query(`
      INSERT INTO beta_onboarding (
        session_id,
        current_step,
        business_data,
        integration_data,
        treasury_data,
        wallet_data,
        verification_data,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW()
      )
      ON CONFLICT (session_id) 
      DO UPDATE SET
        current_step = $2,
        business_data = $3,
        integration_data = $4,
        treasury_data = $5,
        wallet_data = $6,
        verification_data = $7,
        updated_at = NOW()
      RETURNING id
    `, [
      'beta-session-' + Date.now(), // Simple session ID for beta
      step,
      JSON.stringify(data.business || {}),
      JSON.stringify(data.integration || {}),
      JSON.stringify(data.treasury || {}),
      JSON.stringify(data.wallet || {}),
      JSON.stringify(data.verification || {}),
    ]);

    // Track analytics
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'beta_onboarding_step_saved',
        properties: {
          step,
          sessionId: result.rows[0].id,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Onboarding progress saved',
      sessionId: result.rows[0].id
    });
    
  } catch (error) {
    console.error('Beta onboarding save error:', error);
    
    return NextResponse.json(
      { error: 'Failed to save onboarding progress' },
      { status: 500 }
    );
  }
}