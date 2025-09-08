// LIQUID ABT - Dashboard Data API

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, AuthenticatedRequest } from '@/lib/auth/middleware';
import { tenantSchemaManager } from '@/lib/database/connection';
import { ExchangeProviderFactory } from '@/lib/integrations/exchanges/interface';
import { UserRole } from '@/types/database';

async function handleGet(req: AuthenticatedRequest): Promise<NextResponse> {
  try {
    const { tenantId } = req.user;

    // Get all dashboard data in parallel
    const [
      transactions,
      bitcoinPurchases,
      treasuryRules,
      integrations,
      processingFailures
    ] = await Promise.all([
      getTransactions(tenantId),
      getBitcoinPurchases(tenantId),
      getTreasuryRules(tenantId),
      getIntegrations(tenantId),
      getProcessingFailures(tenantId)
    ]);

    // Get current Bitcoin price
    let currentPrice = 95000; // Fallback price
    let priceChange24h = 0;
    
    try {
      // Try to get live price from exchange
      const krakenIntegration = integrations.find(i => i.provider === 'kraken' && i.is_active);
      if (krakenIntegration) {
        const exchange = ExchangeProviderFactory.create('kraken', {});
        const marketPrice = await exchange.getCurrentPrice();
        currentPrice = marketPrice.price;
        priceChange24h = marketPrice.changePercent24h || 0;
      }
    } catch (error) {
      console.log('Could not fetch live Bitcoin price, using fallback');
    }

    // Calculate portfolio metrics
    const totalBitcoin = bitcoinPurchases
      .filter(p => p.status === 'filled' || p.status === 'completed')
      .reduce((sum, p) => sum + parseFloat(p.bitcoin_amount || '0'), 0);
    
    const totalSpent = bitcoinPurchases
      .filter(p => p.status === 'filled' || p.status === 'completed')
      .reduce((sum, p) => sum + parseFloat(p.amount_aud || '0'), 0);
    
    const currentValue = totalBitcoin * currentPrice;

    // Format integrations status
    const integrationStatus = {
      stripe: {
        status: integrations.find(i => i.provider === 'stripe')?.is_active ? 'connected' : 'not_configured',
        connectedAt: integrations.find(i => i.provider === 'stripe')?.created_at
      },
      kraken: {
        status: integrations.find(i => i.provider === 'kraken')?.is_active ? 'connected' : 'not_configured',
        connectedAt: integrations.find(i => i.provider === 'kraken')?.created_at
      }
    };

    // Get active treasury rule
    const activeTreasuryRule = treasuryRules.find(rule => rule.is_active);

    // Format response data
    const dashboardData = {
      portfolio: {
        totalBitcoin,
        totalValue: currentValue,
        audValue: currentValue,
        totalSpent,
        unrealizedPnL: currentValue - totalSpent,
        unrealizedPnLPercent: totalSpent > 0 ? ((currentValue - totalSpent) / totalSpent * 100) : 0,
        change24h: priceChange24h,
        currentPrice
      },
      transactions: transactions.map(formatTransaction),
      bitcoinPurchases: bitcoinPurchases.map(formatBitcoinPurchase),
      integrations: integrationStatus,
      treasuryRule: activeTreasuryRule ? formatTreasuryRule(activeTreasuryRule) : null,
      stats: {
        totalTransactions: transactions.length,
        totalBitcoinPurchases: bitcoinPurchases.length,
        failedProcessing: processingFailures.filter(f => !f.is_resolved).length,
        avgPurchaseSize: bitcoinPurchases.length > 0 ? 
          bitcoinPurchases.reduce((sum, p) => sum + parseFloat(p.amount_aud || '0'), 0) / bitcoinPurchases.length : 0
      }
    };

    return NextResponse.json(dashboardData);

  } catch (error) {
    console.error('Dashboard data error:', error);
    return NextResponse.json(
      { error: 'Failed to load dashboard data' },
      { status: 500 }
    );
  }
}

// Helper functions to fetch data from tenant schemas

async function getTransactions(tenantId: string) {
  return await tenantSchemaManager.queryTenantSchema(
    tenantId,
    `SELECT * FROM transactions 
     ORDER BY created_at DESC 
     LIMIT 50`,
    []
  );
}

async function getBitcoinPurchases(tenantId: string) {
  return await tenantSchemaManager.queryTenantSchema(
    tenantId,
    `SELECT bp.*, bw.status as withdrawal_status, bw.tx_id as withdrawal_tx_id
     FROM bitcoin_purchases bp
     LEFT JOIN bitcoin_withdrawals bw ON bp.id = bw.bitcoin_purchase_id
     ORDER BY bp.created_at DESC 
     LIMIT 50`,
    []
  );
}

async function getTreasuryRules(tenantId: string) {
  return await tenantSchemaManager.queryTenantSchema(
    tenantId,
    `SELECT * FROM treasury_rules 
     ORDER BY created_at DESC`,
    []
  );
}

async function getIntegrations(tenantId: string) {
  return await tenantSchemaManager.queryTenantSchema(
    tenantId,
    `SELECT provider, type, is_active, created_at, settings
     FROM integrations`,
    []
  );
}

async function getProcessingFailures(tenantId: string) {
  return await tenantSchemaManager.queryTenantSchema(
    tenantId,
    `SELECT * FROM processing_failures 
     WHERE created_at > NOW() - INTERVAL '30 days'
     ORDER BY created_at DESC`,
    []
  );
}

// Helper functions to format data for response

function formatTransaction(transaction: any) {
  return {
    id: transaction.id,
    externalId: transaction.external_id,
    amount: parseFloat(transaction.amount || '0'),
    currency: transaction.currency,
    description: transaction.description,
    status: transaction.status,
    provider: transaction.provider,
    shouldConvert: transaction.should_convert,
    createdAt: transaction.created_at,
    processedAt: transaction.processed_at
  };
}

function formatBitcoinPurchase(purchase: any) {
  return {
    id: purchase.id,
    transactionId: purchase.transaction_id,
    amountAud: parseFloat(purchase.amount_aud || '0'),
    bitcoinAmount: parseFloat(purchase.bitcoin_amount || '0'),
    pricePerBtc: parseFloat(purchase.price_per_btc || '0'),
    exchangeOrderId: purchase.exchange_order_id,
    exchangeProvider: purchase.exchange_provider,
    status: purchase.status,
    feesAud: parseFloat(purchase.fees_aud || '0'),
    createdAt: purchase.created_at,
    withdrawal: purchase.withdrawal_status ? {
      status: purchase.withdrawal_status,
      txId: purchase.withdrawal_tx_id
    } : null
  };
}

function formatTreasuryRule(rule: any) {
  return {
    id: rule.id,
    name: rule.name,
    isActive: rule.is_active,
    ruleType: rule.rule_type,
    conversionPercentage: rule.conversion_percentage ? parseFloat(rule.conversion_percentage) : null,
    thresholdAmount: rule.threshold_amount ? parseFloat(rule.threshold_amount) : null,
    minimumPurchase: rule.minimum_purchase ? parseFloat(rule.minimum_purchase) : null,
    maximumPurchase: rule.maximum_purchase ? parseFloat(rule.maximum_purchase) : null,
    bufferAmount: rule.buffer_amount ? parseFloat(rule.buffer_amount) : null,
    withdrawalAddress: rule.withdrawal_address,
    isAutoWithdrawal: rule.is_auto_withdrawal,
    exchangeProvider: rule.exchange_provider,
    createdAt: rule.created_at
  };
}

// Export GET handler with authentication
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withAuth(handleGet, { 
    requiredRole: UserRole.USER,
    requireActiveTenant: true 
  })(request);
}