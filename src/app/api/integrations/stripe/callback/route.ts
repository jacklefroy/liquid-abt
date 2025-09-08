import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { setConnection, type StripeConnection } from '@/lib/stripe-storage';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    console.log('[Stripe OAuth Callback] Received callback with:', { code: !!code, state, error, errorDescription });

    // Handle OAuth errors
    if (error) {
      console.error(`[Stripe OAuth] Error: ${error} - ${errorDescription}`);
      const redirectUrl = new URL('/dashboard/settings', request.url);
      redirectUrl.searchParams.set('stripe_error', error);
      redirectUrl.searchParams.set('message', errorDescription || 'Failed to connect to Stripe');
      
      return NextResponse.redirect(redirectUrl);
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('[Stripe OAuth] Missing required parameters');
      const redirectUrl = new URL('/dashboard/settings', request.url);
      redirectUrl.searchParams.set('stripe_error', 'invalid_request');
      redirectUrl.searchParams.set('message', 'Missing authorization code or state parameter');
      
      return NextResponse.redirect(redirectUrl);
    }

    // Parse state to get user context
    const [tenantId, userId, timestamp] = state.split('_');
    
    if (!tenantId || !userId) {
      console.error('[Stripe OAuth] Invalid state parameter');
      const redirectUrl = new URL('/dashboard/settings', request.url);
      redirectUrl.searchParams.set('stripe_error', 'invalid_state');
      redirectUrl.searchParams.set('message', 'Invalid state parameter');
      
      return NextResponse.redirect(redirectUrl);
    }

    // Initialize Stripe with secret key
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
    });

    console.log(`[Stripe OAuth] Processing REAL authorization code for tenant: ${tenantId}, user: ${userId}`);
    console.log(`[Stripe OAuth] Authorization code: ${code}`);

    try {
      // Exchange authorization code for access token
      console.log('[Stripe OAuth] Exchanging authorization code for access tokens...');
      const tokenResponse = await stripe.oauth.token({
        grant_type: 'authorization_code',
        code: code,
      });

      console.log('[Stripe OAuth] Token exchange successful!');
      console.log('[Stripe OAuth] Connected Account ID:', tokenResponse.stripe_user_id);
      console.log('[Stripe OAuth] Scope:', tokenResponse.scope);

      // Store the connection details in memory
      const connectionDetails: StripeConnection = {
        tenantId,
        userId,
        stripeAccountId: tokenResponse.stripe_user_id,
        accessToken: tokenResponse.access_token, // Should be encrypted in production
        refreshToken: tokenResponse.refresh_token, // Should be encrypted in production
        scope: tokenResponse.scope,
        livemode: tokenResponse.livemode,
        connectedAt: new Date().toISOString(),
      };

      // Store using shared storage module
      setConnection(tenantId, connectionDetails);

      console.log('[Stripe OAuth] Connection stored for tenant:', tenantId);

      const realAccountId = tokenResponse.stripe_user_id;

      // Redirect back to settings with success
      const redirectUrl = new URL('/dashboard/settings', request.url);
      redirectUrl.searchParams.set('stripe_connected', 'true');
      redirectUrl.searchParams.set('account_id', realAccountId);
      redirectUrl.searchParams.set('message', 'Stripe account connected successfully!');
      
      return NextResponse.redirect(redirectUrl);

    } catch (tokenError) {
      console.error('[Stripe OAuth] Token exchange failed:', tokenError);
      
      // Handle specific Stripe errors
      let errorMessage = 'Failed to complete Stripe connection';
      
      if (tokenError instanceof Error) {
        if (tokenError.message.includes('authorization_code is invalid')) {
          errorMessage = 'Authorization code expired or invalid. Please try connecting again.';
        } else if (tokenError.message.includes('client_id')) {
          errorMessage = 'Invalid client configuration. Please contact support.';
        } else {
          errorMessage = `Connection failed: ${tokenError.message}`;
        }
      }

      const redirectUrl = new URL('/dashboard/settings', request.url);
      redirectUrl.searchParams.set('stripe_error', 'token_exchange_failed');
      redirectUrl.searchParams.set('message', errorMessage);
      
      return NextResponse.redirect(redirectUrl);
    }

  } catch (error) {
    console.error('Stripe OAuth callback error:', error);
    
    const redirectUrl = new URL('/dashboard/settings', request.url);
    redirectUrl.searchParams.set('stripe_error', 'callback_error');
    redirectUrl.searchParams.set('message', 'An error occurred during Stripe connection');
    
    return NextResponse.redirect(redirectUrl);
  }
}