// LIQUID ABT - Stripe Webhook Handler

import { NextRequest, NextResponse } from 'next/server';
import { getMasterPrisma, tenantSchemaManager } from '@/lib/database/connection';
import { StripeProcessor } from '@/lib/integrations/payments/stripe';
import { TreasuryProcessor } from '@/lib/treasury-engine/processor';
import { 
  webhookIdempotencyMiddleware,
  completeWebhookProcessing 
} from '@/lib/middleware/webhookIdempotency';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let webhookEventId: string | null = null;
  const provider = 'stripe';
  
  try {
    // Get raw payload for signature verification
    const payload = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      console.error('Missing Stripe signature');
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 400 }
      );
    }

    // Parse payload to check idempotency
    const webhookEvent = JSON.parse(payload);
    
    // Check for duplicate webhook events
    const idempotencyCheck = await webhookIdempotencyMiddleware(req, webhookEvent);
    
    if (!idempotencyCheck.shouldProcess) {
      console.info(`Duplicate Stripe webhook ${idempotencyCheck.eventId}, returning success`);
      return NextResponse.json({ 
        received: true, 
        message: 'Event already processed',
        eventId: idempotencyCheck.eventId 
      });
    }
    
    webhookEventId = idempotencyCheck.eventId;

    // Process webhook with Stripe processor (this handles signature verification)
    const stripeProcessor = new StripeProcessor({});
    const transactions = await stripeProcessor.handleWebhook(payload, signature);

    if (transactions.length === 0) {
      // Mark webhook as processed even if no transactions
      if (webhookEventId) {
        await completeWebhookProcessing(webhookEventId, provider);
      }
      return NextResponse.json({ received: true });
    }

    // For each transaction, find the associated tenant and process
    const processingResults = [];

    for (const transaction of transactions) {
      try {
        // Extract account ID from Stripe event to identify tenant
        const accountId = extractAccountIdFromWebhook(payload);
        
        if (!accountId) {
          console.error('Could not extract account ID from webhook');
          continue;
        }

        // Find tenant by Stripe account ID
        const tenant = await findTenantByStripeAccount(accountId);
        
        if (!tenant) {
          console.error(`No tenant found for Stripe account ${accountId}`);
          continue;
        }

        // Store transaction in tenant's database
        const storedTransaction = await storeTransactionInTenantDB(
          tenant.id,
          transaction
        );

        // Process treasury rules for this transaction
        const treasuryProcessor = new TreasuryProcessor(tenant.id);
        const processingResult = await treasuryProcessor.processTransaction(
          storedTransaction
        );

        processingResults.push({
          transactionId: transaction.id,
          tenantId: tenant.id,
          processed: true,
          bitcoinPurchase: processingResult?.bitcoinPurchaseId || null
        });

      } catch (error) {
        console.error(`Error processing transaction ${transaction.id}:`, error);
        processingResults.push({
          transactionId: transaction.id,
          processed: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Mark webhook as successfully processed
    if (webhookEventId) {
      await completeWebhookProcessing(webhookEventId, provider);
    }

    return NextResponse.json({
      received: true,
      processed: processingResults.length,
      results: processingResults,
      eventId: webhookEventId
    });

  } catch (error) {
    console.error('Stripe webhook processing error:', error);
    
    if (error instanceof Error && error.message.includes('signature')) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// Helper function to extract account ID from webhook payload
function extractAccountIdFromWebhook(payload: string): string | null {
  try {
    const event = JSON.parse(payload);
    
    // For Connect webhooks, account ID is in the event
    if (event.account) {
      return event.account;
    }
    
    // For some events, it might be in the data object
    if (event.data?.object?.on_behalf_of) {
      return event.data.object.on_behalf_of;
    }
    
    // For transfer events
    if (event.data?.object?.destination) {
      return event.data.object.destination;
    }
    
    return null;
  } catch (error) {
    console.error('Failed to parse webhook payload:', error);
    return null;
  }
}

// Helper function to find tenant by Stripe account ID
async function findTenantByStripeAccount(accountId: string) {
  const prisma = getMasterPrisma();
  
  // First, get all tenants (we'll need to check their integrations)
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, schemaName: true }
  });

  // Check each tenant's integrations for matching Stripe account
  for (const tenant of tenants) {
    try {
      const integrations = await tenantSchemaManager.queryTenantSchema(
        tenant.id,
        `SELECT settings FROM integrations 
         WHERE provider = 'stripe' 
         AND is_active = true 
         AND settings->>'accountId' = $1`,
        [accountId]
      );

      if (integrations.length > 0) {
        return tenant;
      }
    } catch (error) {
      console.error(`Error checking tenant ${tenant.id} for Stripe account:`, error);
      continue;
    }
  }

  return null;
}

// Helper function to store transaction in tenant's database
async function storeTransactionInTenantDB(tenantId: string, transaction: any) {
  // Find the integration ID for Stripe
  const integration = await tenantSchemaManager.queryTenantSchema(
    tenantId,
    'SELECT id FROM integrations WHERE provider = $1 AND is_active = true',
    ['stripe']
  );

  const integrationId = integration.length > 0 ? integration[0].id : null;

  // Insert transaction
  const result = await tenantSchemaManager.queryTenantSchema(
    tenantId,
    `INSERT INTO transactions (
      integration_id, external_id, amount, currency, description,
      status, should_convert, provider, provider_data,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
    RETURNING *`,
    [
      integrationId,
      transaction.externalId,
      transaction.amount,
      transaction.currency,
      transaction.description,
      transaction.status,
      true, // Mark for conversion by default
      'stripe',
      JSON.stringify(transaction.rawData),
      new Date()
    ]
  );

  return result[0];
}

