import { Logger } from '../logging/logger';
import { createRedisCache } from '../cache/redisClient';
import { createConnectionPool } from '../database/connectionPool';
import { createQueryOptimizer } from './queryOptimizer';

interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

interface ResponseTimeMetric {
  endpoint: string;
  method: string;
  statusCode: number;
  duration: number;
  timestamp: number;
  tenantId?: string;
}

interface ThroughputMetric {
  endpoint: string;
  requestCount: number;
  timeWindow: number; // in seconds
  timestamp: number;
}

interface ErrorMetric {
  endpoint: string;
  errorType: string;
  errorMessage: string;
  statusCode: number;
  timestamp: number;
  tenantId?: string;
}

interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    database: { status: string; latency: number };
    redis: { status: string; latency: number };
    exchanges: { [key: string]: { status: string; latency: number } };
  };
  metrics: {
    responseTime: { p50: number; p95: number; p99: number };
    throughput: { requestsPerSecond: number };
    errorRate: number;
  };
  timestamp: number;
}

export class PerformanceMonitor {
  private logger: Logger;
  private cache = createRedisCache();
  private pool = createConnectionPool();
  private optimizer = createQueryOptimizer();
  
  private responseTimes: ResponseTimeMetric[] = [];
  private throughputData: Map<string, number[]> = new Map();
  private errors: ErrorMetric[] = [];
  private maxMetricsRetention = 10000; // Keep last 10k metrics in memory

  constructor() {
    this.logger = new Logger({ module: 'PerformanceMonitor' });
    this.startPeriodicTasks();
  }

  private startPeriodicTasks(): void {
    // Clean up old metrics every 5 minutes
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 5 * 60 * 1000);

    // Collect system metrics every minute
    setInterval(() => {
      this.collectSystemMetrics();
    }, 60 * 1000);

    // Generate performance reports every 15 minutes
    setInterval(() => {
      this.generatePerformanceReport();
    }, 15 * 60 * 1000);
  }

  // Request tracking
  recordResponseTime(metric: Omit<ResponseTimeMetric, 'timestamp'>): void {
    const responseTimeMetric: ResponseTimeMetric = {
      ...metric,
      timestamp: Date.now()
    };

    this.responseTimes.push(responseTimeMetric);
    
    // Also store in Redis for cross-instance metrics
    this.cache.set(
      `metrics:response_time:${Date.now()}:${Math.random()}`,
      responseTimeMetric,
      { ttl: 3600 }
    );

    // Log slow requests
    if (metric.duration > 5000) { // 5 seconds
      this.logger.warn('Slow request detected', {
        endpoint: metric.endpoint,
        method: metric.method,
        duration: metric.duration,
        tenantId: metric.tenantId
      });
    }
  }

  recordThroughput(endpoint: string): void {
    const key = `${endpoint}:${Math.floor(Date.now() / 60000)}`; // Per minute
    
    if (!this.throughputData.has(key)) {
      this.throughputData.set(key, []);
    }
    
    this.throughputData.get(key)!.push(Date.now());
  }

  recordError(metric: Omit<ErrorMetric, 'timestamp'>): void {
    const errorMetric: ErrorMetric = {
      ...metric,
      timestamp: Date.now()
    };

    this.errors.push(errorMetric);
    
    // Store in Redis for alerting
    this.cache.set(
      `metrics:error:${Date.now()}:${Math.random()}`,
      errorMetric,
      { ttl: 3600 }
    );

    this.logger.error('Application error recorded', errorMetric);
  }

  // Performance calculations
  calculateResponseTimePercentiles(timeWindow: number = 300000): { p50: number; p95: number; p99: number } {
    const cutoff = Date.now() - timeWindow;
    const recentResponses = this.responseTimes
      .filter(rt => rt.timestamp > cutoff)
      .map(rt => rt.duration)
      .sort((a, b) => a - b);

    if (recentResponses.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const p50Index = Math.floor(recentResponses.length * 0.5);
    const p95Index = Math.floor(recentResponses.length * 0.95);
    const p99Index = Math.floor(recentResponses.length * 0.99);

    return {
      p50: recentResponses[p50Index] || 0,
      p95: recentResponses[p95Index] || 0,
      p99: recentResponses[p99Index] || 0
    };
  }

  calculateThroughput(timeWindow: number = 60000): number {
    const cutoff = Date.now() - timeWindow;
    const recentRequests = this.responseTimes
      .filter(rt => rt.timestamp > cutoff)
      .length;

    return Math.round(recentRequests / (timeWindow / 1000));
  }

  calculateErrorRate(timeWindow: number = 300000): number {
    const cutoff = Date.now() - timeWindow;
    const totalRequests = this.responseTimes.filter(rt => rt.timestamp > cutoff).length;
    const errorRequests = this.errors.filter(e => e.timestamp > cutoff).length;

    return totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
  }

  // Business metrics
  async recordBitcoinPurchase(
    tenantId: string, 
    amount: number, 
    processingTime: number
  ): Promise<void> {
    const metric: PerformanceMetric = {
      name: 'bitcoin_purchase',
      value: amount,
      timestamp: Date.now(),
      tags: {
        tenant_id: tenantId,
        processing_time: processingTime.toString()
      }
    };

    await this.cache.set(
      `business_metrics:bitcoin_purchase:${Date.now()}`,
      metric,
      { ttl: 86400, tags: ['business_metrics', `tenant:${tenantId}`] }
    );

    this.logger.info('Bitcoin purchase metrics recorded', {
      tenantId,
      amount,
      processingTime
    });
  }

  async recordExchangeApiCall(
    exchange: string, 
    operation: string, 
    duration: number, 
    success: boolean
  ): Promise<void> {
    const metric: PerformanceMetric = {
      name: 'exchange_api_call',
      value: duration,
      timestamp: Date.now(),
      tags: {
        exchange,
        operation,
        success: success.toString()
      }
    };

    await this.cache.set(
      `api_metrics:${exchange}:${Date.now()}`,
      metric,
      { ttl: 3600, tags: ['api_metrics', `exchange:${exchange}`] }
    );
  }

  // System health monitoring
  async checkSystemHealth(): Promise<SystemHealth> {
    const [databaseHealth, redisHealth] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth()
    ]);

    const responseTimeMetrics = this.calculateResponseTimePercentiles();
    const throughput = this.calculateThroughput();
    const errorRate = this.calculateErrorRate();

    const overallStatus = this.determineOverallStatus(
      databaseHealth.healthy,
      redisHealth.healthy,
      errorRate
    );

    return {
      status: overallStatus,
      services: {
        database: {
          status: databaseHealth.healthy ? 'healthy' : 'unhealthy',
          latency: databaseHealth.latency || 0
        },
        redis: {
          status: redisHealth.healthy ? 'healthy' : 'unhealthy',
          latency: redisHealth.latency || 0
        },
        exchanges: await this.checkExchangeHealth()
      },
      metrics: {
        responseTime: responseTimeMetrics,
        throughput: { requestsPerSecond: throughput },
        errorRate
      },
      timestamp: Date.now()
    };
  }

  private async checkDatabaseHealth(): Promise<{ healthy: boolean; latency?: number }> {
    return await this.pool.healthCheck();
  }

  private async checkRedisHealth(): Promise<{ healthy: boolean; latency?: number }> {
    return await this.cache.healthCheck();
  }

  private async checkExchangeHealth(): Promise<{ [key: string]: { status: string; latency: number } }> {
    // This would integrate with exchange providers to check their health
    return {
      kraken: { status: 'healthy', latency: 150 },
      swyftx: { status: 'healthy', latency: 200 }
    };
  }

  private determineOverallStatus(
    dbHealthy: boolean,
    redisHealthy: boolean,
    errorRate: number
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (!dbHealthy) return 'unhealthy';
    if (errorRate > 5) return 'unhealthy';
    if (!redisHealthy || errorRate > 1) return 'degraded';
    return 'healthy';
  }

  // Performance optimization suggestions
  async getOptimizationSuggestions(): Promise<any[]> {
    const suggestions = [];

    // Check slow endpoints
    const slowEndpoints = this.getSlowEndpoints();
    if (slowEndpoints.length > 0) {
      suggestions.push({
        type: 'slow_endpoints',
        priority: 'high',
        description: 'Some endpoints are consistently slow',
        details: slowEndpoints,
        recommendations: [
          'Add caching for expensive operations',
          'Optimize database queries',
          'Consider pagination for large result sets'
        ]
      });
    }

    // Check high error rates
    const highErrorEndpoints = this.getHighErrorRateEndpoints();
    if (highErrorEndpoints.length > 0) {
      suggestions.push({
        type: 'high_error_rate',
        priority: 'critical',
        description: 'Some endpoints have high error rates',
        details: highErrorEndpoints,
        recommendations: [
          'Review error handling logic',
          'Add circuit breakers for external APIs',
          'Implement retry mechanisms'
        ]
      });
    }

    // Database optimization suggestions
    const dbSuggestions = await this.optimizer.getIndexRecommendations();
    if (dbSuggestions.length > 0) {
      suggestions.push({
        type: 'database_optimization',
        priority: 'medium',
        description: 'Database performance can be improved with additional indexes',
        details: dbSuggestions,
        recommendations: dbSuggestions.map(s => s.createStatement)
      });
    }

    return suggestions;
  }

  private getSlowEndpoints(): any[] {
    const endpointStats = new Map<string, number[]>();
    
    this.responseTimes.forEach(rt => {
      const key = `${rt.method} ${rt.endpoint}`;
      if (!endpointStats.has(key)) {
        endpointStats.set(key, []);
      }
      endpointStats.get(key)!.push(rt.duration);
    });

    const slowEndpoints = [];
    for (const [endpoint, durations] of endpointStats) {
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      if (avgDuration > 2000) { // More than 2 seconds average
        slowEndpoints.push({
          endpoint,
          averageDuration: avgDuration,
          requestCount: durations.length
        });
      }
    }

    return slowEndpoints;
  }

  private getHighErrorRateEndpoints(): any[] {
    const endpointErrors = new Map<string, number>();
    const endpointRequests = new Map<string, number>();

    this.errors.forEach(error => {
      const key = error.endpoint;
      endpointErrors.set(key, (endpointErrors.get(key) || 0) + 1);
    });

    this.responseTimes.forEach(rt => {
      const key = rt.endpoint;
      endpointRequests.set(key, (endpointRequests.get(key) || 0) + 1);
    });

    const highErrorEndpoints = [];
    for (const [endpoint, errorCount] of endpointErrors) {
      const requestCount = endpointRequests.get(endpoint) || 0;
      const errorRate = requestCount > 0 ? (errorCount / requestCount) * 100 : 0;
      
      if (errorRate > 2) { // More than 2% error rate
        highErrorEndpoints.push({
          endpoint,
          errorRate,
          errorCount,
          requestCount
        });
      }
    }

    return highErrorEndpoints;
  }

  // Cleanup and maintenance
  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours

    this.responseTimes = this.responseTimes.filter(rt => rt.timestamp > cutoff);
    this.errors = this.errors.filter(e => e.timestamp > cutoff);

    // Clean up throughput data
    const outdatedKeys = Array.from(this.throughputData.keys()).filter(key => {
      const [, timestamp] = key.split(':');
      return parseInt(timestamp) * 60000 < cutoff;
    });
    
    outdatedKeys.forEach(key => this.throughputData.delete(key));

    this.logger.debug('Performance metrics cleaned up', {
      responseTimeMetrics: this.responseTimes.length,
      errorMetrics: this.errors.length,
      throughputKeys: this.throughputData.size
    });
  }

  private async collectSystemMetrics(): Promise<void> {
    try {
      const [poolStats, cacheStats, optimizerStats] = await Promise.all([
        this.pool.getPoolStats(),
        this.cache.getStats(),
        this.optimizer.getPerformanceStats()
      ]);

      await this.cache.set('system_metrics:database_pool', poolStats, { ttl: 300 });
      await this.cache.set('system_metrics:redis_cache', cacheStats, { ttl: 300 });
      await this.cache.set('system_metrics:query_optimizer', optimizerStats, { ttl: 300 });

    } catch (error) {
      this.logger.error('Failed to collect system metrics', { 
        error: (error as Error).message 
      });
    }
  }

  private async generatePerformanceReport(): Promise<void> {
    try {
      const health = await this.checkSystemHealth();
      const suggestions = await this.getOptimizationSuggestions();

      const report = {
        timestamp: Date.now(),
        health,
        suggestions,
        summary: {
          totalRequests: this.responseTimes.length,
          totalErrors: this.errors.length,
          averageResponseTime: this.responseTimes.length > 0 
            ? this.responseTimes.reduce((sum, rt) => sum + rt.duration, 0) / this.responseTimes.length 
            : 0
        }
      };

      await this.cache.set(`performance_report:${Date.now()}`, report, { 
        ttl: 86400,
        tags: ['performance_reports'] 
      });

      this.logger.info('Performance report generated', {
        overallStatus: health.status,
        suggestionsCount: suggestions.length
      });

    } catch (error) {
      this.logger.error('Failed to generate performance report', { 
        error: (error as Error).message 
      });
    }
  }

  // Public API for getting metrics
  async getMetrics(): Promise<any> {
    return {
      responseTime: this.calculateResponseTimePercentiles(),
      throughput: this.calculateThroughput(),
      errorRate: this.calculateErrorRate(),
      systemHealth: await this.checkSystemHealth(),
      optimizationSuggestions: await this.getOptimizationSuggestions()
    };
  }
}

// Singleton instance
let performanceMonitorInstance: PerformanceMonitor | null = null;

export function createPerformanceMonitor(): PerformanceMonitor {
  if (!performanceMonitorInstance) {
    performanceMonitorInstance = new PerformanceMonitor();
  }
  
  return performanceMonitorInstance;
}