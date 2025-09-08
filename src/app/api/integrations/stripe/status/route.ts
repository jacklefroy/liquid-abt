// LIQUID ABT - Stripe Connection Status API Endpoint (Mock for Testing)
// Checks current Stripe integration status for tenant

import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';
import { getConnection } from '@/lib/stripe-storage';

interface StripeStatusResult {
  connected: boolean;
  accountId?: string;
  accountStatus?: 'complete' | 'pending' | 'restricted';
  payoutsEnabled?: boolean;
  chargesEnabled?: boolean;
  details?: {
    businessName?: string;
    country?: string;
    currency?: string;
    email?: string;
    lastConnected?: string;
  };
  requirements?: string[];
  error?: string;
}

export async function GET(request: NextRequest) {
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

    // Check for recent OAuth success from referer header (when called from Settings page after OAuth)
    const referer = request.headers.get('referer');
    const isRecentOAuthSuccess = referer && referer.includes('stripe_connected=true');

    // Also check request body or headers for localStorage success indicators
    // (Note: In a real implementation, we'd check the database for connection status)
    const oauthSuccessHeader = request.headers.get('x-stripe-oauth-success');
    const hasOAuthSuccess = isRecentOAuthSuccess || oauthSuccessHeader === 'true';

    // Check Stripe connection status (mock for testing)
    const status = await checkStripeConnectionStatus(decoded.user.tenantId, hasOAuthSuccess);
    
    return NextResponse.json(status);

  } catch (error) {
    console.error('Stripe status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check Stripe connection status' },
      { status: 500 }
    );
  }
}

/**
 * Check Stripe connection status for a tenant (Mock for Testing)
 */
async function checkStripeConnectionStatus(tenantId: string, isRecentOAuthSuccess?: boolean): Promise<StripeStatusResult> {
  try {
    console.log(`[Stripe Status] Checking connection status for tenant: ${tenantId}`);
    console.log(`[Stripe Status] Recent OAuth success: ${isRecentOAuthSuccess}`);
    
    // Check for stored connection first
    const storedConnection = getConnection(tenantId);
    
    if (storedConnection) {
      const connectedStatus: StripeStatusResult = {
        connected: true,
        accountId: storedConnection.stripeAccountId,
        accountStatus: 'complete',
        payoutsEnabled: true,
        chargesEnabled: true,
        details: {
          businessName: 'Connected Account',
          country: 'AU',
          currency: 'aud',
          email: 'connected@stripe.com',
          lastConnected: storedConnection.connectedAt
        }
      };
      
      console.log(`[Stripe Status] Found stored connection - Account ID: ${storedConnection.stripeAccountId}`);
      return connectedStatus;
    }
    
    // If this is called after a successful OAuth flow but no stored connection, show as connected temporarily
    if (isRecentOAuthSuccess) {
      const connectedStatus: StripeStatusResult = {
        connected: true,
        accountId: 'acct_pending_storage',
        accountStatus: 'complete',
        payoutsEnabled: true,
        chargesEnabled: true,
        details: {
          businessName: 'Demo Company Ltd',
          country: 'AU',
          currency: 'aud',
          email: 'demo@company.com',
          lastConnected: new Date().toISOString()
        }
      };
      
      console.log(`[Stripe Status] OAuth success - returning temporary connected status`);
      return connectedStatus;
    }
    
    // No connection found
    const disconnectedStatus: StripeStatusResult = {
      connected: false,
      error: 'No Stripe integration configured'
    };

    console.log(`[Stripe Status] No connection found for ${tenantId}`);
    return disconnectedStatus;

  } catch (error: any) {
    console.error('Stripe status check error:', error);
    return {
      connected: false,
      error: 'Unable to verify Stripe connection'
    };
  }
}

