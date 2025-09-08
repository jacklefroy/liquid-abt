// LIQUID ABT - Stripe Webhook Handler (v1 API)
// Versioned webhook endpoint using the new integration architecture

import { NextRequest, NextResponse } from 'next/server';
import { paymentProcessorFactory } from '@/lib/integrations/payment';
import { headers } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const headersList = headers();
    const signature = headersList.get('stripe-signature');
    
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing Stripe signature' },
        { status: 400 }
      );
    }
    
    // Get Stripe integration from factory
    const stripeProcessor = paymentProcessorFactory.get('stripe');
    if (!stripeProcessor) {
      return NextResponse.json(
        { error: 'Stripe integration not available' },
        { status: 503 }
      );
    }
    
    // Get tenant ID from headers (if multi-tenant)
    const tenantId = headersList.get('x-tenant-id');
    
    // Process webhook using the integration
    const result = await stripeProcessor.handleWebhook(body, signature, tenantId);
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Webhook processing failed' },
        { status: 400 }
      );
    }
    
    const response = {
      success: true,
      processed: result.processed,
      integration: 'stripe',
      version: 'v1',
    };
    
    if (result.transactionId) {
      response.transactionId = result.transactionId;
    }
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Stripe webhook error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}