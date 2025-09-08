import { NextRequest, NextResponse } from 'next/server';
import { getMasterPrisma, getTenantPrisma } from '@/lib/database/connection';
import { authenticateToken } from '@/lib/middleware/authSecurity';
import { createRateLimit } from '@/lib/middleware/rateLimiter';

export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitHandler = createRateLimit({
      windowMs: 60000, // 1 minute
      maxRequests: 60,
      message: 'Too many transaction requests'
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

    // Get URL parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100); // Max 100 per page
    const type = searchParams.get('type') || 'all'; // 'all', 'payments', 'purchases'
    const status = searchParams.get('status') || 'all';
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

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

    const offset = (page - 1) * limit;

    let transactions: any[] = [];
    let totalCount = 0;

    if (type === 'all' || type === 'payments') {
      // Get Stripe payments
      const paymentWhere: any = {};
      if (status !== 'all') {
        paymentWhere.status = status;
      }

      const [stripePayments, stripeCount] = await Promise.all([
        tenantPrisma.stripePayment.findMany({
          where: paymentWhere,
          include: {
            bitcoinPurchase: true
          },
          orderBy: {
            [sortBy]: sortOrder as 'asc' | 'desc'
          },
          take: type === 'payments' ? limit : Math.floor(limit / 2),
          skip: type === 'payments' ? offset : 0
        }),
        tenantPrisma.stripePayment.count({
          where: paymentWhere
        })
      ]);

      const formattedPayments = stripePayments.map(payment => ({
        id: payment.id,
        type: 'payment',
        amount: (payment.amount / 100).toFixed(2), // Convert cents to dollars
        currency: payment.currency.toUpperCase(),
        status: payment.status,
        provider: 'stripe',
        stripePaymentId: payment.stripePaymentId,
        customerId: payment.customerId,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
        bitcoinPurchase: payment.bitcoinPurchase.length > 0 ? {
          id: payment.bitcoinPurchase[0].id,
          bitcoinAmount: payment.bitcoinPurchase[0].bitcoinAmount.toFixed(8),
          fiatAmount: payment.bitcoinPurchase[0].fiatAmount.toFixed(2),
          exchangeRate: payment.bitcoinPurchase[0].exchangeRate.toFixed(2),
          status: payment.bitcoinPurchase[0].status
        } : null
      }));

      transactions.push(...formattedPayments);
      if (type === 'payments') {
        totalCount = stripeCount;
      }
    }

    if (type === 'all' || type === 'purchases') {
      // Get Bitcoin purchases
      const purchaseWhere: any = {};
      if (status !== 'all') {
        purchaseWhere.status = status;
      }

      const [bitcoinPurchases, purchaseCount] = await Promise.all([
        tenantPrisma.bitcoinPurchase.findMany({
          where: purchaseWhere,
          include: {
            stripePayment: true
          },
          orderBy: {
            [sortBy]: sortOrder as 'asc' | 'desc'
          },
          take: type === 'purchases' ? limit : Math.floor(limit / 2),
          skip: type === 'purchases' ? offset : 0
        }),
        tenantPrisma.bitcoinPurchase.count({
          where: purchaseWhere
        })
      ]);

      const formattedPurchases = bitcoinPurchases.map(purchase => ({
        id: purchase.id,
        type: 'bitcoin_purchase',
        bitcoinAmount: purchase.bitcoinAmount.toFixed(8),
        fiatAmount: purchase.fiatAmount.toFixed(2),
        fiatCurrency: purchase.fiatCurrency,
        exchangeRate: purchase.exchangeRate.toFixed(2),
        fees: purchase.fees.toFixed(2),
        status: purchase.status,
        transactionId: purchase.transactionId,
        customerId: purchase.customerId,
        stripePaymentId: purchase.stripePaymentId,
        createdAt: purchase.createdAt.toISOString(),
        updatedAt: purchase.updatedAt.toISOString(),
        stripePayment: purchase.stripePayment ? {
          id: purchase.stripePayment.id,
          stripePaymentId: purchase.stripePayment.stripePaymentId,
          amount: (purchase.stripePayment.amount / 100).toFixed(2),
          currency: purchase.stripePayment.currency.toUpperCase(),
          status: purchase.stripePayment.status
        } : null
      }));

      transactions.push(...formattedPurchases);
      if (type === 'purchases') {
        totalCount = purchaseCount;
      }
    }

    // If showing all types, sort the combined results
    if (type === 'all') {
      transactions.sort((a, b) => {
        const aValue = new Date(a.createdAt).getTime();
        const bValue = new Date(b.createdAt).getTime();
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
      });
      
      // Get approximate total count for pagination
      const [stripeTotal, purchaseTotal] = await Promise.all([
        tenantPrisma.stripePayment.count(),
        tenantPrisma.bitcoinPurchase.count()
      ]);
      totalCount = stripeTotal + purchaseTotal;
      
      // Apply pagination to combined results
      transactions = transactions.slice(offset, offset + limit);
    }

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    const response = {
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage
      },
      filters: {
        type,
        status,
        sortBy,
        sortOrder
      },
      metadata: {
        tenantId,
        generatedAt: new Date().toISOString()
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Dashboard transactions error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch transactions',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}