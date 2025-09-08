// LIQUID ABT - Monitoring Metrics API
// Comprehensive system metrics for admin dashboard

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import os from 'os';
import fs from 'fs/promises';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const timeRange = url.searchParams.get('range') || '1h';
    
    // Get system metrics in parallel for better performance
    const [
      healthMetrics,
      stripeMetrics,
      bitcoinMetrics,
      databaseMetrics,
      apiMetrics,
      errorMetrics,
      betaUserMetrics,
      recentEvents
    ] = await Promise.all([
      getHealthMetrics(),
      getStripeMetrics(timeRange),
      getBitcoinMetrics(timeRange),
      getDatabaseMetrics(),
      getAPIMetrics(timeRange),
      getErrorMetrics(timeRange),
      getBetaUserMetrics(),
      getRecentEvents(timeRange)
    ]);

    // Calculate overall system status
    const systemStatus = calculateSystemStatus({
      health: healthMetrics,
      api: apiMetrics,
      errors: errorMetrics,
    });

    // Get user and transaction counts
    const userStats = await getUserStats();
    const transactionStats = await getTransactionStats(timeRange);
    const revenueStats = await getRevenueStats(timeRange);

    const metrics = {
      timestamp: new Date().toISOString(),
      status: systemStatus.status,
      uptime: process.uptime(),
      health: healthMetrics,
      stripe: stripeMetrics,
      bitcoin: bitcoinMetrics,
      database: databaseMetrics,
      api: apiMetrics,
      errors: errorMetrics,
      betaUsers: betaUserMetrics,
      users: userStats,
      transactions: transactionStats,
      revenue: revenueStats,
      recentEvents: recentEvents,
    };

    return NextResponse.json(metrics);

  } catch (error) {
    console.error('Monitoring metrics error:', error);
    
    return NextResponse.json(
      { error: 'Failed to fetch monitoring metrics' },
      { status: 500 }
    );
  }
}

// ==============================================
// Health Metrics
// ==============================================

async function getHealthMetrics() {
  try {
    // CPU usage calculation
    const cpus = os.cpus();
    const cpuUsage = cpus.reduce((acc, cpu, index) => {
      const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    // Memory usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;

    // Disk usage (rough estimate)
    let diskUsage = 0;
    try {
      const stats = await fs.stat('.');
      // This is a simplified disk usage calculation
      diskUsage = Math.min(50 + Math.random() * 30, 85); // Mock disk usage for now
    } catch (error) {
      diskUsage = 45; // Default fallback
    }

    // Determine overall health status
    const maxUsage = Math.max(cpuUsage, memoryUsage, diskUsage);
    let status = 'healthy';
    if (maxUsage > 90) status = 'critical';
    else if (maxUsage > 75) status = 'warning';

    return {
      cpu: Math.round(cpuUsage),
      memory: Math.round(memoryUsage),
      disk: Math.round(diskUsage),
      status,
    };
  } catch (error) {
    console.error('Health metrics error:', error);
    return {
      cpu: 0,
      memory: 0,
      disk: 0,
      status: 'unknown',
    };
  }
}

// ==============================================
// Stripe Metrics
// ==============================================

async function getStripeMetrics(timeRange: string) {
  try {
    const db = await getDatabase('public');
    const timeFilter = getTimeFilter(timeRange);

    // Get webhook metrics
    const webhookStats = await db.query(`
      SELECT 
        COUNT(*) as total_received,
        COUNT(*) FILTER (WHERE processed = true) as processed,
        COUNT(*) FILTER (WHERE error_message IS NULL) as successful
      FROM webhook_events 
      WHERE integration_provider = 'stripe' 
        AND created_at >= NOW() - INTERVAL '${timeFilter}'
    `);

    const webhooks = webhookStats.rows[0];
    const webhookSuccessRate = webhooks.total_received > 0 
      ? Math.round((webhooks.successful / webhooks.total_received) * 100)
      : 100;

    // Get payment metrics
    const paymentStats = await db.query(`
      SELECT 
        COUNT(*) as payments_today,
        COALESCE(SUM(amount), 0) as volume_today,
        COALESCE(AVG(amount), 0) as average_amount
      FROM transactions 
      WHERE payment_processor = 'stripe' 
        AND created_at >= NOW() - INTERVAL '${timeFilter}'
        AND status = 'completed'
    `);

    const payments = paymentStats.rows[0];

    // Get recent transactions
    const recentTx = await db.query(`
      SELECT external_id, amount, status, processed_at
      FROM transactions 
      WHERE payment_processor = 'stripe' 
      ORDER BY processed_at DESC 
      LIMIT 5
    `);

    return {
      webhooksReceived: parseInt(webhooks.total_received) || 0,
      webhooksProcessed: parseInt(webhooks.processed) || 0,
      webhookSuccessRate,
      paymentsToday: parseInt(payments.payments_today) || 0,
      volumeToday: parseFloat(payments.volume_today) || 0,
      averageAmount: parseFloat(payments.average_amount) || 0,
      topCountries: [
        { country: 'AU', count: 45 },
        { country: 'US', count: 12 },
        { country: 'GB', count: 8 },
      ], // Mock data for now
      recentTransactions: recentTx.rows.map(tx => ({
        id: tx.external_id,
        amount: tx.amount,
        status: tx.status,
        timestamp: tx.processed_at?.toISOString() || new Date().toISOString(),
      })),
    };
  } catch (error) {
    console.error('Stripe metrics error:', error);
    return {
      webhooksReceived: 0,
      webhooksProcessed: 0,
      webhookSuccessRate: 0,
      paymentsToday: 0,
      volumeToday: 0,
      averageAmount: 0,
      topCountries: [],
      recentTransactions: [],
    };
  }
}

// ==============================================
// Bitcoin Metrics
// ==============================================

async function getBitcoinMetrics(timeRange: string) {
  try {
    const db = await getDatabase('public');
    const timeFilter = getTimeFilter(timeRange);

    // Get Bitcoin purchase metrics
    const purchaseStats = await db.query(`
      SELECT 
        COUNT(*) as purchases_today,
        COALESCE(SUM(bitcoin_amount), 0) as total_purchased,
        COALESCE(AVG(payment_amount), 0) as average_purchase,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_purchases
      FROM bitcoin_purchases 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
    `);

    const purchases = purchaseStats.rows[0];
    const successRate = purchases.purchases_today > 0 
      ? Math.round((purchases.successful_purchases / purchases.purchases_today) * 100)
      : 100;

    // Get current Bitcoin price (mock data for now)
    const currentPrice = 65000 + (Math.random() * 2000 - 1000); // Mock BTC price around $65k
    const priceChange24h = (Math.random() * 10 - 5); // Mock 24h change

    return {
      purchasesToday: parseInt(purchases.purchases_today) || 0,
      totalPurchased: parseFloat(purchases.total_purchased) || 0,
      averagePurchase: parseFloat(purchases.average_purchase) || 0,
      successRate,
      currentPrice: Math.round(currentPrice),
      priceChange24h: Number(priceChange24h.toFixed(2)),
      exchangeStatus: {
        kraken: 'online' as const, // Will be dynamic when exchange health checks are implemented
      },
    };
  } catch (error) {
    console.error('Bitcoin metrics error:', error);
    return {
      purchasesToday: 0,
      totalPurchased: 0,
      averagePurchase: 0,
      successRate: 0,
      currentPrice: 65000,
      priceChange24h: 0,
      exchangeStatus: {
        kraken: 'offline' as const,
      },
    };
  }
}

// ==============================================
// Database Metrics
// ==============================================

async function getDatabaseMetrics() {
  try {
    const db = await getDatabase('public');

    // Get connection info
    const connectionStats = await db.query(`
      SELECT 
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections
    `);

    // Get query performance
    const queryStats = await db.query(`
      SELECT 
        COALESCE(AVG(mean_exec_time), 0) as avg_query_time,
        COUNT(*) FILTER (WHERE mean_exec_time > 1000) as slow_queries
      FROM pg_stat_statements 
      WHERE calls > 0
      LIMIT 100
    `);

    // Count tenant schemas
    const schemaStats = await db.query(`
      SELECT COUNT(*) as tenant_schemas
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'tenant_%'
    `);

    const connections = connectionStats.rows[0];
    const queries = queryStats.rows[0];
    const schemas = schemaStats.rows[0];

    return {
      connections: parseInt(connections.active_connections) || 0,
      maxConnections: parseInt(connections.max_connections) || 100,
      queryTime: Math.round(parseFloat(queries.avg_query_time) || 0),
      slowQueries: parseInt(queries.slow_queries) || 0,
      tenantSchemas: parseInt(schemas.tenant_schemas) || 0,
    };
  } catch (error) {
    console.error('Database metrics error:', error);
    return {
      connections: 0,
      maxConnections: 100,
      queryTime: 0,
      slowQueries: 0,
      tenantSchemas: 0,
    };
  }
}

// ==============================================
// API Metrics
// ==============================================

async function getAPIMetrics(timeRange: string) {
  try {
    const db = await getDatabase('public');
    const timeFilter = getTimeFilter(timeRange);

    // Get API request metrics
    const apiStats = await db.query(`
      SELECT 
        COUNT(*) as total_requests,
        COALESCE(AVG(response_time), 0) as avg_response_time,
        COUNT(*) FILTER (WHERE status_code >= 400) as error_requests,
        COUNT(*) FILTER (WHERE response_time > 1000) as slow_requests
      FROM api_requests 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
    `);

    // Get top endpoints
    const endpointStats = await db.query(`
      SELECT 
        endpoint_path,
        COUNT(*) as request_count,
        AVG(response_time) as avg_time
      FROM api_requests 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
      GROUP BY endpoint_path
      ORDER BY request_count DESC
      LIMIT 5
    `);

    const api = apiStats.rows[0];
    const totalRequests = parseInt(api.total_requests) || 0;
    const errorRate = totalRequests > 0 
      ? (parseInt(api.error_requests) || 0) / totalRequests 
      : 0;

    // Calculate requests per minute
    const minutes = getMinutesFromTimeRange(timeRange);
    const requestsPerMinute = minutes > 0 ? Math.round(totalRequests / minutes) : 0;

    return {
      requestsPerMinute,
      averageResponseTime: Math.round(parseFloat(api.avg_response_time) || 0),
      errorRate: Number(errorRate.toFixed(4)),
      slowRequests: parseInt(api.slow_requests) || 0,
      topEndpoints: endpointStats.rows.map(ep => ({
        path: ep.endpoint_path,
        count: parseInt(ep.request_count),
        avgTime: Math.round(parseFloat(ep.avg_time)),
      })),
    };
  } catch (error) {
    console.error('API metrics error:', error);
    return {
      requestsPerMinute: 0,
      averageResponseTime: 0,
      errorRate: 0,
      slowRequests: 0,
      topEndpoints: [],
    };
  }
}

// ==============================================
// Error Metrics
// ==============================================

async function getErrorMetrics(timeRange: string) {
  try {
    const db = await getDatabase('public');
    const timeFilter = getTimeFilter(timeRange);

    // Get error counts
    const errorStats = await db.query(`
      SELECT 
        COUNT(*) as total_errors,
        COUNT(*) FILTER (WHERE level = 'error' OR level = 'critical') as critical_errors
      FROM error_logs 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
    `);

    // Get top errors
    const topErrors = await db.query(`
      SELECT 
        error_message,
        COUNT(*) as error_count,
        MAX(created_at) as last_seen
      FROM error_logs 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
      GROUP BY error_message
      ORDER BY error_count DESC
      LIMIT 5
    `);

    // Get error trend data
    const errorTrend = await db.query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as time,
        COUNT(*) as count
      FROM error_logs 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY time DESC
      LIMIT 24
    `);

    const errors = errorStats.rows[0];
    const totalRequests = await getTotalRequestCount(timeRange);
    const errorRate = totalRequests > 0 
      ? (parseInt(errors.total_errors) || 0) / totalRequests 
      : 0;

    return {
      totalToday: parseInt(errors.total_errors) || 0,
      criticalToday: parseInt(errors.critical_errors) || 0,
      errorRate: Number(errorRate.toFixed(4)),
      topErrors: topErrors.rows.map(error => ({
        message: error.error_message,
        count: parseInt(error.error_count),
        lastSeen: error.last_seen?.toISOString() || new Date().toISOString(),
      })),
      errorTrend: errorTrend.rows.map(trend => ({
        time: trend.time?.toISOString() || new Date().toISOString(),
        count: parseInt(trend.count),
      })),
    };
  } catch (error) {
    console.error('Error metrics error:', error);
    return {
      totalToday: 0,
      criticalToday: 0,
      errorRate: 0,
      topErrors: [],
      errorTrend: [],
    };
  }
}

// ==============================================
// Beta User Metrics
// ==============================================

async function getBetaUserMetrics() {
  try {
    const db = await getDatabase('public');

    // Get beta user stats
    const betaStats = await db.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE last_active_at >= NOW() - INTERVAL '24 hours') as active_today,
        COUNT(*) FILTER (WHERE onboarding_completed_at IS NOT NULL) as completed_onboarding
      FROM beta_users 
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    // Get recent signups
    const recentSignups = await db.query(`
      SELECT 
        company_name,
        industry,
        created_at,
        CASE 
          WHEN onboarding_completed_at IS NOT NULL THEN 'completed'
          WHEN onboarding_step > 3 THEN 'in-progress'
          ELSE 'started'
        END as status
      FROM beta_users 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    const beta = betaStats.rows[0];
    const totalUsers = parseInt(beta.total_users) || 0;
    const completedOnboarding = parseInt(beta.completed_onboarding) || 0;
    const completionRate = totalUsers > 0 
      ? Math.round((completedOnboarding / totalUsers) * 100)
      : 0;

    return {
      totalUsers,
      activeToday: parseInt(beta.active_today) || 0,
      onboardingCompletionRate: completionRate,
      averageOnboardingTime: 15, // Mock data - average minutes to complete
      recentSignups: recentSignups.rows.map(signup => ({
        company: signup.company_name,
        industry: signup.industry,
        timestamp: signup.created_at?.toISOString() || new Date().toISOString(),
        status: signup.status,
      })),
    };
  } catch (error) {
    console.error('Beta user metrics error:', error);
    return {
      totalUsers: 0,
      activeToday: 0,
      onboardingCompletionRate: 0,
      averageOnboardingTime: 0,
      recentSignups: [],
    };
  }
}

// ==============================================
// Recent Events
// ==============================================

async function getRecentEvents(timeRange: string) {
  try {
    const db = await getDatabase('public');
    const timeFilter = getTimeFilter(timeRange);

    const events = await db.query(`
      SELECT 
        id,
        event_type as type,
        message,
        details,
        created_at
      FROM system_events 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
      ORDER BY created_at DESC 
      LIMIT 20
    `);

    return events.rows.map(event => ({
      id: event.id,
      type: event.type,
      message: event.message,
      timestamp: event.created_at?.toISOString() || new Date().toISOString(),
      details: event.details,
    }));
  } catch (error) {
    console.error('Recent events error:', error);
    return [];
  }
}

// ==============================================
// Helper Functions
// ==============================================

async function getUserStats() {
  try {
    const db = await getDatabase('public');
    
    const userStats = await db.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE last_active_at >= NOW() - INTERVAL '24 hours') as active_users
      FROM users
    `);

    const stats = userStats.rows[0];
    return {
      active: parseInt(stats.active_users) || 0,
      total: parseInt(stats.total_users) || 0,
    };
  } catch (error) {
    return { active: 0, total: 0 };
  }
}

async function getTransactionStats(timeRange: string) {
  try {
    const db = await getDatabase('public');
    const timeFilter = getTimeFilter(timeRange);

    const txStats = await db.query(`
      SELECT 
        COUNT(*) as total_today,
        (SELECT COUNT(*) FROM transactions) as total_all_time
      FROM transactions 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
    `);

    const stats = txStats.rows[0];
    return {
      today: parseInt(stats.total_today) || 0,
      total: parseInt(stats.total_all_time) || 0,
    };
  } catch (error) {
    return { today: 0, total: 0 };
  }
}

async function getRevenueStats(timeRange: string) {
  try {
    const db = await getDatabase('public');
    const timeFilter = getTimeFilter(timeRange);

    const revenueStats = await db.query(`
      SELECT 
        COALESCE(SUM(fee_amount), 0) as revenue_today,
        (SELECT COALESCE(SUM(fee_amount), 0) FROM transactions) as total_revenue
      FROM transactions 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
        AND status = 'completed'
    `);

    const stats = revenueStats.rows[0];
    return {
      today: parseFloat(stats.revenue_today) || 0,
      total: parseFloat(stats.total_revenue) || 0,
    };
  } catch (error) {
    return { today: 0, total: 0 };
  }
}

async function getTotalRequestCount(timeRange: string): Promise<number> {
  try {
    const db = await getDatabase('public');
    const timeFilter = getTimeFilter(timeRange);

    const result = await db.query(`
      SELECT COUNT(*) as total_requests
      FROM api_requests 
      WHERE created_at >= NOW() - INTERVAL '${timeFilter}'
    `);

    return parseInt(result.rows[0].total_requests) || 0;
  } catch (error) {
    return 0;
  }
}

function getTimeFilter(timeRange: string): string {
  switch (timeRange) {
    case '5m': return '5 minutes';
    case '1h': return '1 hour';
    case '24h': return '24 hours';
    case '7d': return '7 days';
    default: return '1 hour';
  }
}

function getMinutesFromTimeRange(timeRange: string): number {
  switch (timeRange) {
    case '5m': return 5;
    case '1h': return 60;
    case '24h': return 1440;
    case '7d': return 10080;
    default: return 60;
  }
}

function calculateSystemStatus(metrics: {
  health: any;
  api: any;
  errors: any;
}): { status: 'healthy' | 'warning' | 'critical' } {
  // Critical conditions
  if (
    metrics.health.status === 'critical' ||
    metrics.api.errorRate > 0.05 || // More than 5% error rate
    metrics.errors.criticalToday > 10
  ) {
    return { status: 'critical' };
  }

  // Warning conditions
  if (
    metrics.health.status === 'warning' ||
    metrics.api.errorRate > 0.01 || // More than 1% error rate
    metrics.api.averageResponseTime > 1000 || // Slow responses
    metrics.errors.totalToday > 50
  ) {
    return { status: 'warning' };
  }

  return { status: 'healthy' };
}