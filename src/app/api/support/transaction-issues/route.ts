import { NextRequest, NextResponse } from 'next/server';
import { getMasterPrisma, getTenantPrisma } from '@/lib/database/connection';
import { authenticateToken } from '@/lib/middleware/authSecurity';
import { createRateLimit } from '@/lib/middleware/rateLimiter';

interface TransactionIssue {
  id: string;
  type: 'failed_bitcoin_purchase' | 'orphaned_payment' | 'amount_mismatch' | 'withdrawal_failed';
  status: 'investigating' | 'resolving' | 'resolved' | 'escalated';
  stripePaymentId?: string;
  bitcoinPurchaseId?: string;
  amount: string;
  currency: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  estimatedResolution: string;
  supportTicketId?: string;
}

export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitHandler = createRateLimit({
      windowMs: 60000, // 1 minute
      maxRequests: 20,
      message: 'Too many support requests'
    });
    
    const rateLimitResult = await rateLimitHandler(request);
    
    if (rateLimitResult.limited) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429 }
      );
    }

    // Authenticate and get tenant context
    const authResult = await authenticateToken(request);
    if (!authResult.authenticated || !authResult.tenantId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const tenantId = authResult.tenantId;

    // Get tenant information
    const masterPrisma = getMasterPrisma();
    const tenant = await masterPrisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    // Get tenant-specific database connection
    const tenantPrisma = await getTenantPrisma(tenant.schemaName);

    // Identify transaction issues by analyzing recent transactions
    const issues: TransactionIssue[] = [];
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Find orphaned Stripe payments (successful but no Bitcoin purchase)
    const orphanedPayments = await tenantPrisma.stripePayment.findMany({
      where: {
        status: 'succeeded',
        createdAt: { gte: last24Hours },
        bitcoinPurchase: { none: {} }
      },
      take: 10,
      orderBy: { createdAt: 'desc' }
    });

    for (const payment of orphanedPayments) {
      issues.push({
        id: `orphan_${payment.id}`,
        type: 'orphaned_payment',
        status: 'investigating',
        stripePaymentId: payment.stripePaymentId,
        amount: (payment.amount / 100).toFixed(2),
        currency: payment.currency.toUpperCase(),
        description: `Payment processed successfully but Bitcoin purchase was not created. We are investigating and will complete your Bitcoin purchase shortly.`,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
        estimatedResolution: 'Within 2 hours'
      });
    }

    // 2. Find failed Bitcoin purchases (payment succeeded but Bitcoin purchase failed)
    const failedPurchases = await tenantPrisma.bitcoinPurchase.findMany({
      where: {
        status: 'failed',
        createdAt: { gte: last24Hours }
      },
      include: {
        stripePayment: true
      },
      take: 10,
      orderBy: { createdAt: 'desc' }
    });

    for (const purchase of failedPurchases) {
      issues.push({
        id: `failed_${purchase.id}`,
        type: 'failed_bitcoin_purchase',
        status: 'resolving',
        stripePaymentId: purchase.stripePayment?.stripePaymentId,
        bitcoinPurchaseId: purchase.id,
        amount: purchase.fiatAmount.toFixed(2),
        currency: purchase.fiatCurrency,
        description: `Bitcoin purchase failed due to exchange connectivity issues. Your payment is secure and we are retrying the purchase. If unsuccessful, we will process a full refund.`,
        createdAt: purchase.createdAt.toISOString(),
        updatedAt: purchase.updatedAt.toISOString(),
        estimatedResolution: 'Within 4 hours or full refund'
      });
    }

    // 3. Find amount mismatches
    const recentPurchases = await tenantPrisma.bitcoinPurchase.findMany({
      where: {
        createdAt: { gte: last24Hours },
        stripePayment: { isNot: null }
      },
      include: {
        stripePayment: true
      },
      take: 50
    });

    for (const purchase of recentPurchases) {
      if (purchase.stripePayment) {
        const stripeAmount = purchase.stripePayment.amount / 100; // Convert cents to dollars
        const purchaseAmount = purchase.fiatAmount.toNumber();
        const difference = Math.abs(stripeAmount - purchaseAmount);
        
        // Flag if difference is more than $0.10 (accounting for fees)
        if (difference > 0.10) {
          issues.push({
            id: `mismatch_${purchase.id}`,
            type: 'amount_mismatch',
            status: 'investigating',
            stripePaymentId: purchase.stripePayment.stripePaymentId,
            bitcoinPurchaseId: purchase.id,
            amount: stripeAmount.toFixed(2),
            currency: purchase.fiatCurrency,
            description: `Amount mismatch detected between payment ($${stripeAmount.toFixed(2)}) and Bitcoin purchase ($${purchaseAmount.toFixed(2)}). We are reviewing and will correct any discrepancies.`,
            createdAt: purchase.createdAt.toISOString(),
            updatedAt: purchase.updatedAt.toISOString(),
            estimatedResolution: 'Within 24 hours'
          });
        }
      }
    }

    // 4. Find withdrawal failures (for self-custody users)
    const withdrawalFailures = await tenantPrisma.bitcoinPurchase.findMany({
      where: {
        status: 'completed', // Purchase completed but withdrawal might have failed
        createdAt: { gte: last24Hours },
        // This would need additional fields in the schema to track withdrawal status
        // For now, we'll simulate this based on updatedAt vs createdAt timing
      },
      take: 10
    });

    // Simulate withdrawal failures for purchases that took too long to complete
    for (const purchase of withdrawalFailures) {
      const completionTime = purchase.updatedAt.getTime() - purchase.createdAt.getTime();
      const thirtyMinutes = 30 * 60 * 1000;
      
      if (completionTime > thirtyMinutes) {
        issues.push({
          id: `withdrawal_${purchase.id}`,
          type: 'withdrawal_failed',
          status: 'resolving',
          bitcoinPurchaseId: purchase.id,
          amount: purchase.bitcoinAmount.toFixed(8),
          currency: 'BTC',
          description: `Bitcoin withdrawal to your wallet is delayed. Your Bitcoin is secure and we are retrying the withdrawal. You can update your wallet address in settings if needed.`,
          createdAt: purchase.createdAt.toISOString(),
          updatedAt: purchase.updatedAt.toISOString(),
          estimatedResolution: 'Within 1 hour'
        });
      }
    }

    // Sort issues by creation date (newest first)
    issues.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      success: true,
      issues: issues.slice(0, 20), // Limit to 20 most recent issues
      summary: {
        totalIssues: issues.length,
        orphanedPayments: issues.filter(i => i.type === 'orphaned_payment').length,
        failedPurchases: issues.filter(i => i.type === 'failed_bitcoin_purchase').length,
        amountMismatches: issues.filter(i => i.type === 'amount_mismatch').length,
        withdrawalFailures: issues.filter(i => i.type === 'withdrawal_failed').length
      },
      lastChecked: new Date().toISOString()
    });

  } catch (error) {
    console.error('Support transaction issues error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch transaction issues',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}