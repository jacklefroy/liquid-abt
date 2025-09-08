// LIQUID ABT - Stripe Connect OAuth API

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, AuthenticatedRequest } from '@/lib/auth/middleware';
import { tenantSchemaManager } from '@/lib/database/connection';
import { StripeProcessor } from '@/lib/integrations/payments/stripe';
import { UserRole } from '@/types/database';

// POST: Initiate Stripe Connect OAuth flow
async function handlePost(req: AuthenticatedRequest): Promise<NextResponse> {
  try {
    const { tenantId } = req.user;
    const stripeProcessor = new StripeProcessor({});

    // Generate OAuth URL
    const oauthResult = await stripeProcessor.initiateOAuth();

    // Store the state in tenant's database for verification
    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO integrations (type, provider, is_active, settings) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (provider) DO UPDATE SET 
       settings = $4, updated_at = NOW()`,
      [
        'PAYMENT_PROCESSOR',
        'stripe',
        false, // Not active until OAuth is completed
        JSON.stringify({ 
          oauthState: oauthResult.state,
          oauthInitiatedAt: new Date().toISOString()
        })
      ]
    );

    return NextResponse.json({
      authUrl: oauthResult.authUrl,
      state: oauthResult.state
    });

  } catch (error) {
    console.error('Stripe Connect initiation error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Stripe connection' },
      { status: 500 }
    );
  }
}

// GET: Handle OAuth callback and complete connection
async function handleGet(req: AuthenticatedRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.json(
        { error: `Stripe connection failed: ${error}` },
        { status: 400 }
      );
    }

    if (!code || !state) {
      return NextResponse.json(
        { error: 'Missing authorization code or state parameter' },
        { status: 400 }
      );
    }

    const { tenantId } = req.user;

    // Verify state parameter matches what we stored
    const existingIntegration = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      'SELECT settings FROM integrations WHERE provider = $1',
      ['stripe']
    );

    if (!existingIntegration.length) {
      return NextResponse.json(
        { error: 'No pending Stripe integration found' },
        { status: 400 }
      );
    }

    const settings = existingIntegration[0].settings;
    if (settings.oauthState !== state) {
      return NextResponse.json(
        { error: 'Invalid state parameter - possible CSRF attack' },
        { status: 400 }
      );
    }

    // Exchange code for access token
    const stripeProcessor = new StripeProcessor({});
    const connectionResult = await stripeProcessor.handleOAuthCallback(code, state);

    if (!connectionResult.success) {
      return NextResponse.json(
        { error: connectionResult.error || 'Failed to connect Stripe account' },
        { status: 400 }
      );
    }

    // Update integration in tenant database
    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `UPDATE integrations 
       SET is_active = $1, 
           access_token = $2, 
           settings = $3,
           updated_at = NOW()
       WHERE provider = $4`,
      [
        true,
        connectionResult.accessToken,
        JSON.stringify({
          accountId: connectionResult.accountId,
          businessName: connectionResult.metadata?.businessName,
          email: connectionResult.metadata?.email,
          country: connectionResult.metadata?.country,
          capabilities: connectionResult.metadata?.capabilities,
          chargesEnabled: connectionResult.metadata?.chargesEnabled,
          payoutsEnabled: connectionResult.metadata?.payoutsEnabled,
          connectedAt: new Date().toISOString()
        }),
        'stripe'
      ]
    );

    // Get account information for response
    const connectedStripe = new StripeProcessor({
      accessToken: connectionResult.accessToken,
      accountId: connectionResult.accountId
    });

    const accountInfo = await connectedStripe.getAccountInfo();

    return NextResponse.json({
      message: 'Stripe account connected successfully',
      account: {
        id: accountInfo.id,
        businessName: accountInfo.businessName,
        email: accountInfo.email,
        country: accountInfo.country,
        currency: accountInfo.currency,
        isActive: accountInfo.isActive,
        capabilities: accountInfo.capabilities
      }
    });

  } catch (error) {
    console.error('Stripe OAuth callback error:', error);
    return NextResponse.json(
      { error: 'Failed to complete Stripe connection' },
      { status: 500 }
    );
  }
}

// DELETE: Disconnect Stripe account
async function handleDelete(req: AuthenticatedRequest): Promise<NextResponse> {
  try {
    const { tenantId } = req.user;

    // Get current Stripe integration
    const integration = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      'SELECT access_token, settings FROM integrations WHERE provider = $1 AND is_active = true',
      ['stripe']
    );

    if (!integration.length) {
      return NextResponse.json(
        { error: 'No active Stripe integration found' },
        { status: 404 }
      );
    }

    const { access_token, settings } = integration[0];
    
    // Disconnect from Stripe
    const stripeProcessor = new StripeProcessor({
      accessToken: access_token,
      accountId: settings.accountId
    });

    try {
      await stripeProcessor.disconnectAccount();
    } catch (error) {
      console.error('Failed to disconnect from Stripe API:', error);
      // Continue to deactivate in our database even if Stripe API call fails
    }

    // Deactivate integration in database
    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `UPDATE integrations 
       SET is_active = false, 
           access_token = NULL,
           settings = jsonb_set(settings, '{disconnectedAt}', $1)
       WHERE provider = $2`,
      [JSON.stringify(new Date().toISOString()), 'stripe']
    );

    return NextResponse.json({
      message: 'Stripe account disconnected successfully'
    });

  } catch (error) {
    console.error('Stripe disconnect error:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect Stripe account' },
      { status: 500 }
    );
  }
}

// Export handlers with authentication middleware
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withAuth(handlePost, { 
    requiredRole: UserRole.ADMIN,
    requireActiveTenant: true 
  })(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withAuth(handleGet, { 
    requiredRole: UserRole.ADMIN,
    requireActiveTenant: true 
  })(request);
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  return withAuth(handleDelete, { 
    requiredRole: UserRole.ADMIN,
    requireActiveTenant: true 
  })(request);
}