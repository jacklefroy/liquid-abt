import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';

// Stripe Connect OAuth integration endpoint

export async function GET(request: NextRequest) {
  return handleStripeConnect(request);
}

export async function POST(request: NextRequest) {
  return handleStripeConnect(request);
}

async function handleStripeConnect(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Access token required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET || 'local-dev-secret-at-least-32-chars-change-in-production';
    
    // Verify and decode the JWT token
    const decoded = verify(token, jwtSecret) as any;
    
    if (!decoded.user) {
      return NextResponse.json(
        { error: 'Invalid token or tenant' },
        { status: 401 }
      );
    }

    // REAL Stripe Connect OAuth flow
    const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;
    const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/stripe/callback`;
    
    if (!STRIPE_CLIENT_ID) {
      return NextResponse.json(
        { error: 'Stripe client ID not configured' },
        { status: 500 }
      );
    }
    
    const state = `${decoded.user.tenantId}_${decoded.user.id}_${Date.now()}`; // Include user context in state
    
    const authUrl = `https://connect.stripe.com/oauth/authorize?` + 
      `response_type=code&` +
      `client_id=${STRIPE_CLIENT_ID}&` +
      `scope=read_write&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `stripe_user[email]=${encodeURIComponent(decoded.user.email || '')}&` +
      `stripe_user[business_name]=LIQUID Treasury sandbox&` +
      `state=${state}`;

    console.log(`[Stripe Connect - REAL] Generated real OAuth flow for ${decoded.user.email}`);
    console.log(`[Stripe Connect - REAL] Auth URL: ${authUrl}`);
    console.log(`[Stripe Connect - REAL] State: ${state}`);
    console.log(`[Stripe Connect - REAL] This will redirect to REAL Stripe OAuth page`);

    return NextResponse.json({
      success: true,
      authUrl: authUrl,  // This will redirect to the REAL Stripe page
      message: 'Redirecting to Stripe Connect...'
    });

  } catch (error) {
    console.error('Stripe connect error:', error);
    
    return NextResponse.json(
      { error: 'Failed to initiate Stripe connection' },
      { status: 500 }
    );
  }
}