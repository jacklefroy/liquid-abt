import { NextRequest, NextResponse } from 'next/server';
import { getMasterPrisma, getTenantPrisma } from '@/lib/database/connection';
import { authenticateToken } from '@/lib/middleware/authSecurity';
import { createRateLimit } from '@/lib/middleware/rateLimiter';
import Decimal from 'decimal.js';

export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitHandler = createRateLimit({
      windowMs: 60000, // 1 minute
      maxRequests: 30,
      message: 'Too many dashboard requests'
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

    // Calculate date ranges
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch aggregated stats
    const [
      totalBitcoinPurchases,
      todayBitcoinPurchases,
      monthBitcoinPurchases,
      totalTransactions,
      last24HTransactions,
      last7DaysTransactions,
      last30DaysTransactions,
      recentBitcoinPurchases,
      activeIntegrations,
      treasuryRules
    ] = await Promise.all([
      // Total Bitcoin purchases
      tenantPrisma.bitcoinPurchase.aggregate({
        _sum: {
          bitcoinAmount: true,
          fiatAmount: true,
          fees: true
        },
        _count: true,
        where: {
          status: 'completed'
        }
      }),

      // Today's Bitcoin purchases
      tenantPrisma.bitcoinPurchase.aggregate({
        _sum: {
          bitcoinAmount: true,
          fiatAmount: true
        },
        _count: true,
        where: {
          status: 'completed',
          createdAt: {
            gte: todayStart
          }
        }
      }),

      // This month's Bitcoin purchases
      tenantPrisma.bitcoinPurchase.aggregate({
        _sum: {
          bitcoinAmount: true,
          fiatAmount: true
        },
        _count: true,
        where: {
          status: 'completed',
          createdAt: {
            gte: monthStart
          }
        }
      }),

      // Total transactions (Stripe payments)
      tenantPrisma.stripePayment.count({
        where: {
          status: 'succeeded'
        }
      }),

      // Last 24 hours transactions
      tenantPrisma.stripePayment.count({
        where: {
          status: 'succeeded',
          createdAt: {
            gte: last24Hours
          }
        }
      }),

      // Last 7 days transactions
      tenantPrisma.stripePayment.count({
        where: {
          status: 'succeeded',
          createdAt: {
            gte: last7Days
          }
        }
      }),

      // Last 30 days transactions
      tenantPrisma.stripePayment.count({
        where: {
          status: 'succeeded',
          createdAt: {
            gte: last30Days
          }
        }
      }),

      // Recent Bitcoin purchases (last 10)
      tenantPrisma.bitcoinPurchase.findMany({
        take: 10,
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true,
          bitcoinAmount: true,
          fiatAmount: true,
          exchangeRate: true,
          fees: true,
          status: true,
          createdAt: true
        }
      }),

      // Active integrations count (from master schema)
      masterPrisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          subscriptionTier: true,
          monthlyVolumeLimit: true,
          dailyVolumeLimit: true,
          maxTransactionLimit: true
        }
      }),

      // Active treasury rules
      tenantPrisma.$queryRaw`
        SELECT 
          COUNT(*) as total_rules,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_rules
        FROM treasury_rules
      ` as any[]
    ]);

    // Calculate conversion rate (Bitcoin purchases / Stripe payments)
    const conversionRate = totalTransactions > 0 
      ? (totalBitcoinPurchases._count / totalTransactions) * 100 
      : 0;

    // Calculate total Bitcoin balance and AUD value
    const totalBtcBalance = new Decimal(totalBitcoinPurchases._sum.bitcoinAmount?.toString() || '0');
    const totalAudSpent = new Decimal(totalBitcoinPurchases._sum.fiatAmount?.toString() || '0');
    const totalFees = new Decimal(totalBitcoinPurchases._sum.fees?.toString() || '0');

    // Get current Bitcoin price (mock for now - in production would fetch from exchange)
    const currentBtcPrice = new Decimal('65000'); // Mock price in AUD
    const currentPortfolioValue = totalBtcBalance.mul(currentBtcPrice);
    const unrealizedGains = currentPortfolioValue.sub(totalAudSpent);
    const performancePercent = totalAudSpent.gt(0) 
      ? unrealizedGains.div(totalAudSpent).mul(100)
      : new Decimal(0);

    // Monthly volume tracking
    const monthlyVolumeUsed = new Decimal(monthBitcoinPurchases._sum.fiatAmount?.toString() || '0');
    const volumeLimit = new Decimal(tenant.monthlyVolumeLimit);
    const volumeUtilization = volumeLimit.gt(0) 
      ? monthlyVolumeUsed.div(volumeLimit).mul(100) 
      : new Decimal(0);

    const stats = {
      // Portfolio Overview
      portfolio: {
        totalBtcBalance: totalBtcBalance.toFixed(8),
        totalAudSpent: totalAudSpent.toFixed(2),
        currentPortfolioValue: currentPortfolioValue.toFixed(2),
        unrealizedGains: unrealizedGains.toFixed(2),
        performancePercent: performancePercent.toFixed(2),
        totalFees: totalFees.toFixed(2)
      },

      // Transaction Stats
      transactions: {
        total: totalTransactions,
        last24Hours: last24HTransactions,
        last7Days: last7DaysTransactions,
        last30Days: last30DaysTransactions,
        conversionRate: conversionRate.toFixed(2)
      },

      // Bitcoin Purchase Stats
      bitcoinPurchases: {
        total: totalBitcoinPurchases._count,
        today: todayBitcoinPurchases._count,
        thisMonth: monthBitcoinPurchases._count,
        totalBtcAcquired: totalBtcBalance.toFixed(8),
        todayBtc: new Decimal(todayBitcoinPurchases._sum.bitcoinAmount?.toString() || '0').toFixed(8),
        monthBtc: new Decimal(monthBitcoinPurchases._sum.bitcoinAmount?.toString() || '0').toFixed(8)
      },

      // Volume Tracking
      volume: {
        monthlyUsed: monthlyVolumeUsed.toFixed(2),
        monthlyLimit: volumeLimit.toFixed(2),
        utilizationPercent: Math.min(volumeUtilization.toNumber(), 100).toFixed(1),
        dailyLimit: tenant.dailyVolumeLimit.toFixed(2),
        maxTransactionLimit: tenant.maxTransactionLimit.toFixed(2)
      },

      // Account Info
      account: {
        companyName: tenant.companyName,
        subscriptionTier: tenant.subscriptionTier,
        isActive: tenant.isActive,
        totalRules: treasuryRules[0]?.total_rules || 0,
        activeRules: treasuryRules[0]?.active_rules || 0
      },

      // Recent Activity
      recentActivity: recentBitcoinPurchases.map(purchase => ({
        id: purchase.id,
        type: 'bitcoin_purchase',
        bitcoinAmount: purchase.bitcoinAmount.toFixed(8),
        fiatAmount: purchase.fiatAmount.toFixed(2),
        exchangeRate: purchase.exchangeRate.toFixed(2),
        fees: purchase.fees.toFixed(2),
        status: purchase.status,
        timestamp: purchase.createdAt.toISOString()
      })),

      // Market Data (mock)
      market: {
        currentBtcPrice: currentBtcPrice.toFixed(2),
        currency: 'AUD',
        lastUpdated: now.toISOString()
      },

      // Metadata
      generatedAt: now.toISOString(),
      tenantId: tenantId
    };

    return NextResponse.json(stats);

  } catch (error) {
    console.error('Dashboard stats error:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch dashboard statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}