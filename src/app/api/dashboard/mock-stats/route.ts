import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';

// Mock dashboard stats data
const mockStats = {
  portfolio: {
    totalBtcBalance: "0.01154615",
    totalAudSpent: "750.00",
    currentPortfolioValue: "780.25",
    unrealizedGains: "30.25",
    performancePercent: "4.03",
    totalFees: "3.75"
  },
  transactions: {
    total: 6,
    last24Hours: 1,
    last7Days: 2,
    last30Days: 6,
    conversionRate: "66.7"
  },
  bitcoinPurchases: {
    total: 4,
    today: 1,
    thisMonth: 4,
    totalBtcAcquired: "0.01154615",
    todayBtc: "0.00076923",
    monthBtc: "0.01154615"
  },
  volume: {
    monthlyUsed: "750.00",
    monthlyLimit: "500000.00",
    utilizationPercent: "0.15",
    dailyLimit: "50000.00",
    maxTransactionLimit: "10000.00"
  },
  account: {
    companyName: "Demo Company Ltd",
    subscriptionTier: "PRO",
    isActive: true,
    totalRules: 1,
    activeRules: 1
  },
  recentActivity: [
    {
      id: "btc_test_1",
      type: "bitcoin_purchase",
      bitcoinAmount: "0.00076923",
      fiatAmount: "500.00",
      exchangeRate: "65000.00",
      fees: "2.50",
      status: "completed",
      timestamp: new Date().toISOString()
    },
    {
      id: "btc_test_2",
      type: "bitcoin_purchase",
      bitcoinAmount: "0.00153846",
      fiatAmount: "1000.00",
      exchangeRate: "65000.00",
      fees: "5.00",
      status: "completed",
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: "btc_test_3",
      type: "bitcoin_purchase",
      bitcoinAmount: "0.00384615",
      fiatAmount: "2500.00",
      exchangeRate: "65000.00",
      fees: "12.50",
      status: "completed",
      timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: "btc_test_failed_5",
      type: "bitcoin_purchase",
      bitcoinAmount: "0.00123077",
      fiatAmount: "800.00",
      exchangeRate: "65000.00",
      fees: "4.00",
      status: "failed",
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    }
  ],
  market: {
    currentBtcPrice: "65000.00",
    currency: "AUD",
    lastUpdated: new Date().toISOString()
  },
  generatedAt: new Date().toISOString(),
  tenantId: "tenant_test_123"
};

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
    
    if (!decoded.user || decoded.user.tenantId !== 'tenant_test_123') {
      return NextResponse.json(
        { error: 'Invalid token or tenant' },
        { status: 401 }
      );
    }

    console.log(`[Mock Dashboard Stats] Generated stats for ${decoded.user.email} (${decoded.user.firstName} ${decoded.user.lastName})`);
    console.log(`[Mock Dashboard Stats] Company: ${mockStats.account.companyName} (${mockStats.account.subscriptionTier})`);

    // Return mock dashboard statistics
    return NextResponse.json(mockStats);

  } catch (error) {
    console.error('Dashboard stats error:', error);
    
    return NextResponse.json(
      { error: 'Failed to fetch dashboard statistics' },
      { status: 500 }
    );
  }
}