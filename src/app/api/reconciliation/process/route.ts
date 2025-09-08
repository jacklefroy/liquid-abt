import { NextRequest, NextResponse } from 'next/server';

interface ReconciliationProcessResult {
  success: boolean;
  status: {
    isHealthy: boolean;
    hasRecentReconciliation: boolean;
    lastReconciliationTime: string;
  };
  reconciliationSummary: {
    totalPayments: number;
    totalBitcoinPurchases: number;
    matchedPairs: number;
    orphanedPayments: number;
    orphanedPurchases: number;
    amountMismatches: number;
    totalDiscrepancyValue: string;
    reconciliationAccuracy: string;
    processingTimeMs: number;
  };
  recommendations: {
    urgency: string;
    message: string;
  };
}

export async function GET(request: NextRequest) {
  console.log('[Reconciliation] Mock reconciliation process started');
  
  const mockResult: ReconciliationProcessResult = {
    success: true,
    status: {
      isHealthy: true,
      hasRecentReconciliation: true,
      lastReconciliationTime: new Date().toISOString()
    },
    reconciliationSummary: {
      totalPayments: 0,
      totalBitcoinPurchases: 0,
      matchedPairs: 0,
      orphanedPayments: 0,
      orphanedPurchases: 0,
      amountMismatches: 0,
      totalDiscrepancyValue: '0.00',
      reconciliationAccuracy: '100.00',
      processingTimeMs: 50
    },
    recommendations: {
      urgency: 'normal',
      message: 'System healthy'
    }
  };

  console.log('[Reconciliation] Mock reconciliation completed successfully');
  return NextResponse.json(mockResult);
}

export async function POST(request: NextRequest) {
  return GET(request); // Same mock response for both GET and POST
}