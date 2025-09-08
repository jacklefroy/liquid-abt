// LIQUID ABT - Webhook Idempotency Middleware

import { NextRequest } from 'next/server';
import { getMasterPrisma } from '@/lib/database/connection';

/**
 * Webhook event storage for idempotency
 */
interface WebhookEvent {
  id: string;
  eventId: string;
  provider: string;
  eventType: string;
  processed: boolean;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Extract event ID from webhook payload based on provider
 */
function extractEventId(payload: any, provider: string): string | null {
  try {
    switch (provider.toLowerCase()) {
      case 'stripe':
        return payload.id || null;
      case 'square':
        return payload.event_id || payload.id || null;
      case 'paypal':
        return payload.id || payload.event_id || null;
      default:
        // Generic fallback - look for common event ID fields
        return payload.id || payload.event_id || payload.eventId || null;
    }
  } catch (error) {
    console.error('Failed to extract event ID:', error);
    return null;
  }
}

/**
 * Determine provider from request path or headers
 */
function determineProvider(req: NextRequest): string {
  const path = req.nextUrl.pathname;
  
  if (path.includes('/stripe')) return 'stripe';
  if (path.includes('/square')) return 'square';
  if (path.includes('/paypal')) return 'paypal';
  if (path.includes('/shopify')) return 'shopify';
  if (path.includes('/tyro')) return 'tyro';
  
  // Check headers for provider-specific signatures
  if (req.headers.get('stripe-signature')) return 'stripe';
  if (req.headers.get('square-signature')) return 'square';
  if (req.headers.get('paypal-transmission-sig')) return 'paypal';
  
  return 'unknown';
}

/**
 * Check if webhook event has already been processed
 */
export async function isWebhookProcessed(
  eventId: string, 
  provider: string
): Promise<boolean> {
  try {
    const prisma = getMasterPrisma();
    
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: {
        eventId_provider: {
          eventId,
          provider,
        },
      },
    });
    
    return existingEvent?.processed || false;
  } catch (error) {
    console.error('Failed to check webhook idempotency:', error);
    // On error, allow processing to continue (safer than blocking)
    return false;
  }
}

/**
 * Store webhook event for idempotency tracking
 */
export async function storeWebhookEvent(
  eventId: string,
  provider: string,
  eventType: string,
  processed: boolean = false
): Promise<boolean> {
  try {
    const prisma = getMasterPrisma();
    
    // Set expiry to 24 hours from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    await prisma.webhookEvent.upsert({
      where: {
        eventId_provider: {
          eventId,
          provider,
        },
      },
      update: {
        processed,
        eventType,
        expiresAt,
      },
      create: {
        eventId,
        provider,
        eventType,
        processed,
        expiresAt,
      },
    });
    
    return true;
  } catch (error) {
    console.error('Failed to store webhook event:', error);
    return false;
  }
}

/**
 * Mark webhook event as processed
 */
export async function markWebhookProcessed(
  eventId: string,
  provider: string
): Promise<boolean> {
  try {
    const prisma = getMasterPrisma();
    
    await prisma.webhookEvent.update({
      where: {
        eventId_provider: {
          eventId,
          provider,
        },
      },
      data: {
        processed: true,
      },
    });
    
    return true;
  } catch (error) {
    console.error('Failed to mark webhook as processed:', error);
    return false;
  }
}

/**
 * Clean up expired webhook events (run periodically)
 */
export async function cleanupExpiredWebhookEvents(): Promise<number> {
  try {
    const prisma = getMasterPrisma();
    
    const result = await prisma.webhookEvent.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    
    console.log(`Cleaned up ${result.count} expired webhook events`);
    return result.count;
  } catch (error) {
    console.error('Failed to cleanup expired webhook events:', error);
    return 0;
  }
}

/**
 * Webhook idempotency middleware
 */
export async function webhookIdempotencyMiddleware(
  req: NextRequest,
  payload: any
): Promise<{
  shouldProcess: boolean;
  eventId: string | null;
  provider: string;
  reason?: string;
}> {
  const provider = determineProvider(req);
  const eventId = extractEventId(payload, provider);
  
  // If we can't extract an event ID, we have to allow processing
  if (!eventId) {
    console.warn(`No event ID found for ${provider} webhook`);
    return {
      shouldProcess: true,
      eventId: null,
      provider,
      reason: 'no_event_id',
    };
  }
  
  // Check if this event has already been processed
  const alreadyProcessed = await isWebhookProcessed(eventId, provider);
  
  if (alreadyProcessed) {
    console.info(`Webhook event ${eventId} from ${provider} already processed, skipping`);
    return {
      shouldProcess: false,
      eventId,
      provider,
      reason: 'already_processed',
    };
  }
  
  // Store the event as being processed (but not yet completed)
  const eventType = payload.type || payload.event_type || 'unknown';
  await storeWebhookEvent(eventId, provider, eventType, false);
  
  return {
    shouldProcess: true,
    eventId,
    provider,
  };
}

/**
 * Complete webhook processing (mark as processed)
 */
export async function completeWebhookProcessing(
  eventId: string,
  provider: string
): Promise<void> {
  await markWebhookProcessed(eventId, provider);
}

/**
 * Get webhook processing statistics
 */
export async function getWebhookStats(): Promise<{
  total: number;
  processed: number;
  pending: number;
  expired: number;
  byProvider: Record<string, number>;
}> {
  try {
    const prisma = getMasterPrisma();
    
    const [total, processed, expired, byProvider] = await Promise.all([
      prisma.webhookEvent.count(),
      prisma.webhookEvent.count({ where: { processed: true } }),
      prisma.webhookEvent.count({ where: { expiresAt: { lt: new Date() } } }),
      prisma.webhookEvent.groupBy({
        by: ['provider'],
        _count: {
          provider: true,
        },
      }),
    ]);
    
    const providerStats = byProvider.reduce((acc, item) => {
      acc[item.provider] = item._count.provider;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      total,
      processed,
      pending: total - processed,
      expired,
      byProvider: providerStats,
    };
  } catch (error) {
    console.error('Failed to get webhook stats:', error);
    return {
      total: 0,
      processed: 0,
      pending: 0,
      expired: 0,
      byProvider: {},
    };
  }
}

/**
 * Setup periodic cleanup (call this on app startup)
 */
export function setupWebhookCleanup(): void {
  // Clean up expired events every hour
  const cleanupInterval = setInterval(async () => {
    try {
      await cleanupExpiredWebhookEvents();
    } catch (error) {
      console.error('Scheduled webhook cleanup failed:', error);
    }
  }, 60 * 60 * 1000); // 1 hour
  
  // Clean up on process exit
  process.on('SIGTERM', () => {
    clearInterval(cleanupInterval);
  });
  
  process.on('SIGINT', () => {
    clearInterval(cleanupInterval);
  });
  
  console.log('Webhook cleanup scheduled every hour');
}

/**
 * Webhook replay attack detection
 */
export function isWebhookReplay(
  timestamp: number,
  toleranceSeconds: number = 300 // 5 minutes
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;
  
  return age > toleranceSeconds;
}

/**
 * Extract timestamp from webhook headers
 */
export function extractWebhookTimestamp(req: NextRequest): number | null {
  // Stripe format: t=1234567890,v1=...
  const stripeSignature = req.headers.get('stripe-signature');
  if (stripeSignature) {
    const timestampMatch = stripeSignature.match(/t=(\d+)/);
    if (timestampMatch) {
      return parseInt(timestampMatch[1]);
    }
  }
  
  // Generic timestamp header
  const timestamp = req.headers.get('x-timestamp');
  if (timestamp) {
    return parseInt(timestamp);
  }
  
  // PayPal format
  const paypalTimestamp = req.headers.get('paypal-transmission-time');
  if (paypalTimestamp) {
    return Math.floor(new Date(paypalTimestamp).getTime() / 1000);
  }
  
  return null;
}

/**
 * Comprehensive webhook security check
 */
export function validateWebhookSecurity(req: NextRequest): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  // Check for timestamp to prevent replay attacks
  const timestamp = extractWebhookTimestamp(req);
  if (!timestamp) {
    issues.push('No timestamp found in webhook headers');
  } else if (isWebhookReplay(timestamp)) {
    issues.push('Webhook timestamp indicates potential replay attack');
  }
  
  // Check for signature
  const hasSignature = req.headers.get('stripe-signature') ||
                      req.headers.get('square-signature') ||
                      req.headers.get('paypal-transmission-sig') ||
                      req.headers.get('x-signature');
                      
  if (!hasSignature) {
    issues.push('No webhook signature found');
  }
  
  // Check content type
  const contentType = req.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    issues.push('Invalid content type for webhook');
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}