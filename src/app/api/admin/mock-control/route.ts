import { NextRequest, NextResponse } from 'next/server';
import { zeroCapMock } from '@/lib/sandbox/zerocap-mock';
import { getExchangeService, getExchangeServiceInfo, resetExchangeService } from '@/lib/integrations/exchanges/exchange-factory';

// Simple auth check for admin endpoints
function isAdminRequest(request: NextRequest): boolean {
  // In production, this should check proper authentication
  // For now, just check if we're in development or test mode
  const environment = process.env.NODE_ENV;
  const isDevelopment = environment === 'development' || environment === 'test';
  
  // Additional check for admin token if provided
  const authHeader = request.headers.get('authorization');
  const adminToken = process.env.ADMIN_API_TOKEN;
  
  if (adminToken && authHeader) {
    return authHeader === `Bearer ${adminToken}`;
  }
  
  return isDevelopment;
}

function createErrorResponse(message: string, status: number = 400): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status });
}

function createSuccessResponse(data: any, message?: string): NextResponse {
  return NextResponse.json({
    success: true,
    message: message || 'Operation completed successfully',
    data,
    timestamp: new Date().toISOString()
  });
}

// GET - View all mock transactions and configuration
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdminRequest(request)) {
      return createErrorResponse('Unauthorized - Admin access required', 401);
    }

    // Check if we're actually in mock mode
    const serviceInfo = getExchangeServiceInfo();
    if (!serviceInfo.isMock) {
      return createErrorResponse('Mock mode is not active. Set USE_MOCK_EXCHANGE=true to enable.', 400);
    }

    const { searchParams } = new URL(request.url);
    const includeHistory = searchParams.get('history') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');

    // Get mock service statistics and configuration
    const stats = zeroCapMock.getStats();
    const history = includeHistory ? zeroCapMock.getTransactionHistory().slice(-limit) : [];

    const config = {
      mockBtcPrice: process.env.MOCK_BTC_PRICE || '65000',
      mockSuccessRate: process.env.MOCK_SUCCESS_RATE || '0.95',
      mockNetworkDelay: process.env.MOCK_NETWORK_DELAY_MS || '1000'
    };

    return createSuccessResponse({
      serviceInfo,
      config,
      stats,
      history: includeHistory ? history : `Use ?history=true to view transaction history (last ${limit} transactions)`
    });

  } catch (error) {
    console.error('Mock control GET error:', error);
    return createErrorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
}

// POST - Manually trigger a mock Bitcoin purchase
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdminRequest(request)) {
      return createErrorResponse('Unauthorized - Admin access required', 401);
    }

    const serviceInfo = getExchangeServiceInfo();
    if (!serviceInfo.isMock) {
      return createErrorResponse('Mock mode is not active. Set USE_MOCK_EXCHANGE=true to enable.', 400);
    }

    const body = await request.json().catch(() => ({}));
    const {
      amount = 100,
      customerReference = `admin_test_${Date.now()}`,
      withdrawalAddress
    } = body;

    // Validate input
    if (typeof amount !== 'number' || amount <= 0) {
      return createErrorResponse('Amount must be a positive number');
    }

    if (amount > 10000) {
      return createErrorResponse('Amount cannot exceed $10,000 for safety');
    }

    // Execute the mock purchase
    const exchange = getExchangeService();
    const startTime = Date.now();
    
    const result = await exchange.executeBuyOrder({
      amount,
      customerReference,
      withdrawalAddress
    });

    const executionTime = Date.now() - startTime;

    return createSuccessResponse({
      purchaseResult: result,
      executionTime: `${executionTime}ms`,
      transactionLogged: true
    }, `Mock Bitcoin purchase ${result.success ? 'completed' : 'failed'}`);

  } catch (error) {
    console.error('Mock control POST error:', error);
    return createErrorResponse(error instanceof Error ? error.message : 'Failed to execute mock purchase', 500);
  }
}

// PUT - Change mock parameters
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdminRequest(request)) {
      return createErrorResponse('Unauthorized - Admin access required', 401);
    }

    const serviceInfo = getExchangeServiceInfo();
    if (!serviceInfo.isMock) {
      return createErrorResponse('Mock mode is not active. Set USE_MOCK_EXCHANGE=true to enable.', 400);
    }

    const body = await request.json().catch(() => ({}));
    const {
      btcPrice,
      successRate,
      networkDelay
    } = body;

    const changes: string[] = [];

    // Update BTC price
    if (typeof btcPrice === 'number' && btcPrice > 0) {
      if (btcPrice < 10000 || btcPrice > 200000) {
        return createErrorResponse('BTC price must be between $10,000 and $200,000');
      }
      zeroCapMock.setBaseBtcPrice(btcPrice);
      changes.push(`BTC price set to $${btcPrice}`);
    }

    // Update success rate
    if (typeof successRate === 'number') {
      if (successRate < 0 || successRate > 1) {
        return createErrorResponse('Success rate must be between 0 and 1');
      }
      zeroCapMock.setSuccessRate(successRate);
      changes.push(`Success rate set to ${(successRate * 100).toFixed(1)}%`);
    }

    // Update network delay
    if (typeof networkDelay === 'number' && networkDelay >= 0) {
      if (networkDelay > 10000) {
        return createErrorResponse('Network delay cannot exceed 10 seconds (10000ms)');
      }
      zeroCapMock.setNetworkDelay(networkDelay);
      changes.push(`Network delay set to ${networkDelay}ms`);
    }

    if (changes.length === 0) {
      return createErrorResponse('No valid parameters provided. Use btcPrice, successRate, or networkDelay.');
    }

    return createSuccessResponse({
      changes,
      newStats: zeroCapMock.getStats()
    }, `Mock parameters updated: ${changes.join(', ')}`);

  } catch (error) {
    console.error('Mock control PUT error:', error);
    return createErrorResponse(error instanceof Error ? error.message : 'Failed to update mock parameters', 500);
  }
}

// DELETE - Clear mock transaction history
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdminRequest(request)) {
      return createErrorResponse('Unauthorized - Admin access required', 401);
    }

    const serviceInfo = getExchangeServiceInfo();
    if (!serviceInfo.isMock) {
      return createErrorResponse('Mock mode is not active. Set USE_MOCK_EXCHANGE=true to enable.', 400);
    }

    const { searchParams } = new URL(request.url);
    const confirmDeletion = searchParams.get('confirm') === 'true';

    if (!confirmDeletion) {
      return createErrorResponse('Add ?confirm=true to confirm deletion of transaction history');
    }

    const statsBeforeClear = zeroCapMock.getStats();
    zeroCapMock.clearTransactionHistory();
    const statsAfterClear = zeroCapMock.getStats();

    return createSuccessResponse({
      transactionsCleared: statsBeforeClear.totalTransactions,
      statsBeforeClear,
      statsAfterClear
    }, `Cleared ${statsBeforeClear.totalTransactions} mock transactions`);

  } catch (error) {
    console.error('Mock control DELETE error:', error);
    return createErrorResponse(error instanceof Error ? error.message : 'Failed to clear transaction history', 500);
  }
}

// PATCH - Advanced mock operations (reset service, bulk transactions, etc.)
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdminRequest(request)) {
      return createErrorResponse('Unauthorized - Admin access required', 401);
    }

    const serviceInfo = getExchangeServiceInfo();
    if (!serviceInfo.isMock) {
      return createErrorResponse('Mock mode is not active. Set USE_MOCK_EXCHANGE=true to enable.', 400);
    }

    const body = await request.json().catch(() => ({}));
    const { operation, ...params } = body;

    switch (operation) {
      case 'reset_service':
        resetExchangeService();
        return createSuccessResponse({
          serviceReset: true,
          newServiceInfo: getExchangeServiceInfo()
        }, 'Exchange service singleton reset');

      case 'bulk_test':
        const count = Math.min(params.count || 10, 50); // Max 50 for safety
        const bulkResults = [];
        
        for (let i = 0; i < count; i++) {
          const exchange = getExchangeService();
          const result = await exchange.executeBuyOrder({
            amount: 100 + (i * 10),
            customerReference: `bulk_test_${i}`
          });
          bulkResults.push({
            index: i,
            success: result.success,
            orderId: result.orderId,
            bitcoinAmount: result.bitcoinAmount
          });
        }

        return createSuccessResponse({
          bulkResults,
          totalExecuted: count,
          successful: bulkResults.filter(r => r.success).length,
          newStats: zeroCapMock.getStats()
        }, `Bulk test completed: ${count} transactions executed`);

      case 'simulate_failure':
        // Temporarily set success rate to 0 and execute a transaction
        const originalSuccessRate = zeroCapMock.getStats().successRate;
        zeroCapMock.setSuccessRate(0);
        
        const exchange = getExchangeService();
        const failureResult = await exchange.executeBuyOrder({
          amount: params.amount || 100,
          customerReference: 'simulate_failure_test'
        });
        
        // Restore original success rate
        zeroCapMock.setSuccessRate(originalSuccessRate);
        
        return createSuccessResponse({
          simulatedFailure: failureResult,
          successRateRestored: originalSuccessRate
        }, 'Failure simulation completed');

      default:
        return createErrorResponse('Invalid operation. Supported: reset_service, bulk_test, simulate_failure');
    }

  } catch (error) {
    console.error('Mock control PATCH error:', error);
    return createErrorResponse(error instanceof Error ? error.message : 'Failed to execute mock operation', 500);
  }
}