// LIQUID ABT - Metrics API Endpoint
// Expose operational metrics for monitoring and alerting

import { NextRequest, NextResponse } from 'next/server';
import { metricsCollector } from '@/lib/monitoring/metrics';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    const since = searchParams.get('since');
    
    const summary = metricsCollector.getMetricsSummary();
    
    if (format === 'prometheus') {
      // Return Prometheus-compatible metrics format
      const prometheusMetrics = formatPrometheusMetrics(summary);
      
      return new NextResponse(prometheusMetrics, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    if (format === 'history') {
      // Return historical metrics
      const sinceTimestamp = since ? parseInt(since) : undefined;
      const history = metricsCollector.getMetricHistory(sinceTimestamp);
      
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        since: sinceTimestamp ? new Date(sinceTimestamp).toISOString() : null,
        metrics: history
      });
    }
    
    // Default JSON format
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      summary,
      alerts: generateAlerts(summary)
    });
    
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}

/**
 * Format metrics for Prometheus scraping
 */
function formatPrometheusMetrics(summary: any): string {
  const lines: string[] = [];
  
  // Transaction processing metrics
  lines.push('# HELP liquid_abt_transaction_success_rate Transaction success rate (0-1)');
  lines.push('# TYPE liquid_abt_transaction_success_rate gauge');
  lines.push(`liquid_abt_transaction_success_rate ${summary.transactionProcessing.successRate}`);
  
  lines.push('# HELP liquid_abt_transaction_processing_time_avg Average transaction processing time in milliseconds');
  lines.push('# TYPE liquid_abt_transaction_processing_time_avg gauge');
  lines.push(`liquid_abt_transaction_processing_time_avg ${summary.transactionProcessing.averageProcessingTime}`);
  
  lines.push('# HELP liquid_abt_transaction_processing_time_p95 95th percentile transaction processing time in milliseconds');
  lines.push('# TYPE liquid_abt_transaction_processing_time_p95 gauge');
  lines.push(`liquid_abt_transaction_processing_time_p95 ${summary.transactionProcessing.p95ProcessingTime}`);
  
  lines.push('# HELP liquid_abt_transactions_total Total number of transactions processed');
  lines.push('# TYPE liquid_abt_transactions_total counter');
  lines.push(`liquid_abt_transactions_total ${summary.transactionProcessing.totalProcessed}`);
  
  // Bitcoin purchase metrics
  lines.push('# HELP liquid_abt_bitcoin_purchase_success_rate Bitcoin purchase success rate (0-1)');
  lines.push('# TYPE liquid_abt_bitcoin_purchase_success_rate gauge');
  lines.push(`liquid_abt_bitcoin_purchase_success_rate ${summary.bitcoinPurchases.successRate}`);
  
  lines.push('# HELP liquid_abt_bitcoin_purchase_amount_avg Average Bitcoin purchase amount in AUD');
  lines.push('# TYPE liquid_abt_bitcoin_purchase_amount_avg gauge');
  lines.push(`liquid_abt_bitcoin_purchase_amount_avg ${summary.bitcoinPurchases.averageAmount}`);
  
  lines.push('# HELP liquid_abt_bitcoin_purchase_latency_avg Average Bitcoin purchase latency in milliseconds');
  lines.push('# TYPE liquid_abt_bitcoin_purchase_latency_avg gauge');
  lines.push(`liquid_abt_bitcoin_purchase_latency_avg ${summary.bitcoinPurchases.averageLatency}`);
  
  lines.push('# HELP liquid_abt_bitcoin_purchases_total Total number of Bitcoin purchases');
  lines.push('# TYPE liquid_abt_bitcoin_purchases_total counter');
  lines.push(`liquid_abt_bitcoin_purchases_total ${summary.bitcoinPurchases.totalPurchases}`);
  
  // Exchange API metrics
  lines.push('# HELP liquid_abt_exchange_api_success_rate Exchange API success rate (0-1)');
  lines.push('# TYPE liquid_abt_exchange_api_success_rate gauge');
  lines.push(`liquid_abt_exchange_api_success_rate ${summary.exchangeApi.successRate}`);
  
  lines.push('# HELP liquid_abt_exchange_api_response_time_avg Average exchange API response time in milliseconds');
  lines.push('# TYPE liquid_abt_exchange_api_response_time_avg gauge');
  lines.push(`liquid_abt_exchange_api_response_time_avg ${summary.exchangeApi.averageResponseTime}`);
  
  lines.push('# HELP liquid_abt_exchange_api_calls_total Total number of exchange API calls');
  lines.push('# TYPE liquid_abt_exchange_api_calls_total counter');
  lines.push(`liquid_abt_exchange_api_calls_total ${summary.exchangeApi.totalCalls}`);
  
  // System metrics
  lines.push('# HELP liquid_abt_memory_usage_mb Average memory usage in megabytes');
  lines.push('# TYPE liquid_abt_memory_usage_mb gauge');
  lines.push(`liquid_abt_memory_usage_mb ${summary.system.averageMemoryUsage}`);
  
  lines.push('# HELP liquid_abt_cpu_usage_seconds Average CPU usage in seconds');
  lines.push('# TYPE liquid_abt_cpu_usage_seconds gauge');
  lines.push(`liquid_abt_cpu_usage_seconds ${summary.system.averageCpuUsage}`);
  
  return lines.join('\n') + '\n';
}

/**
 * Generate alerts based on metric thresholds
 */
function generateAlerts(summary: any): Array<{
  level: 'warning' | 'critical';
  component: string;
  message: string;
  value: number;
  threshold: number;
}> {
  const alerts = [];
  
  // Transaction success rate alerts
  if (summary.transactionProcessing.successRate < 0.95) {
    alerts.push({
      level: 'critical' as const,
      component: 'transaction_processing',
      message: 'Transaction success rate below 95%',
      value: summary.transactionProcessing.successRate,
      threshold: 0.95
    });
  } else if (summary.transactionProcessing.successRate < 0.98) {
    alerts.push({
      level: 'warning' as const,
      component: 'transaction_processing',
      message: 'Transaction success rate below 98%',
      value: summary.transactionProcessing.successRate,
      threshold: 0.98
    });
  }
  
  // Bitcoin purchase success rate alerts
  if (summary.bitcoinPurchases.successRate < 0.90) {
    alerts.push({
      level: 'critical' as const,
      component: 'bitcoin_purchases',
      message: 'Bitcoin purchase success rate below 90%',
      value: summary.bitcoinPurchases.successRate,
      threshold: 0.90
    });
  } else if (summary.bitcoinPurchases.successRate < 0.95) {
    alerts.push({
      level: 'warning' as const,
      component: 'bitcoin_purchases',
      message: 'Bitcoin purchase success rate below 95%',
      value: summary.bitcoinPurchases.successRate,
      threshold: 0.95
    });
  }
  
  // Exchange API response time alerts
  if (summary.exchangeApi.averageResponseTime > 10000) {
    alerts.push({
      level: 'critical' as const,
      component: 'exchange_api',
      message: 'Exchange API response time above 10 seconds',
      value: summary.exchangeApi.averageResponseTime,
      threshold: 10000
    });
  } else if (summary.exchangeApi.averageResponseTime > 5000) {
    alerts.push({
      level: 'warning' as const,
      component: 'exchange_api',
      message: 'Exchange API response time above 5 seconds',
      value: summary.exchangeApi.averageResponseTime,
      threshold: 5000
    });
  }
  
  // Exchange API success rate alerts
  if (summary.exchangeApi.successRate < 0.85) {
    alerts.push({
      level: 'critical' as const,
      component: 'exchange_api',
      message: 'Exchange API success rate below 85%',
      value: summary.exchangeApi.successRate,
      threshold: 0.85
    });
  } else if (summary.exchangeApi.successRate < 0.95) {
    alerts.push({
      level: 'warning' as const,
      component: 'exchange_api',
      message: 'Exchange API success rate below 95%',
      value: summary.exchangeApi.successRate,
      threshold: 0.95
    });
  }
  
  // Memory usage alerts
  if (summary.system.averageMemoryUsage > 1000) {
    alerts.push({
      level: 'critical' as const,
      component: 'system',
      message: 'Memory usage above 1GB',
      value: summary.system.averageMemoryUsage,
      threshold: 1000
    });
  } else if (summary.system.averageMemoryUsage > 500) {
    alerts.push({
      level: 'warning' as const,
      component: 'system',
      message: 'Memory usage above 500MB',
      value: summary.system.averageMemoryUsage,
      threshold: 500
    });
  }
  
  return alerts;
}