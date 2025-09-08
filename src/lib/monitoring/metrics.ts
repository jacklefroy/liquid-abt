// LIQUID ABT - Operational Metrics Collection
// Production monitoring and alerting for Bitcoin treasury operations

import { performance } from 'perf_hooks';

// Metric types for type safety
type MetricType = 'counter' | 'histogram' | 'gauge' | 'summary';

interface MetricData {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
  timestamp: number;
}

interface OperationalMetrics {
  // Transaction Processing Metrics
  transactionProcessingTime: number[];
  transactionSuccessCount: number;
  transactionFailureCount: number;
  
  // Bitcoin Purchase Metrics
  bitcoinPurchaseSuccessCount: number;
  bitcoinPurchaseFailureCount: number;
  bitcoinPurchaseAmount: number[];
  bitcoinPurchaseLatency: number[];
  
  // API Response Time Metrics
  exchangeApiResponseTime: number[];
  exchangeApiSuccessCount: number;
  exchangeApiFailureCount: number;
  
  // System Performance Metrics
  memoryUsage: number[];
  cpuUsage: number[];
  
  // Queue Depth Metrics (if using queues)
  queueDepth: Record<string, number>;
  queueProcessingTime: number[];
}

class MetricsCollector {
  private metrics: OperationalMetrics;
  private metricHistory: MetricData[];
  private readonly maxHistorySize = 10000; // Keep last 10k metrics
  
  constructor() {
    this.metrics = this.initializeMetrics();
    this.metricHistory = [];
    
    // Start system metrics collection
    this.startSystemMetricsCollection();
  }
  
  private initializeMetrics(): OperationalMetrics {
    return {
      transactionProcessingTime: [],
      transactionSuccessCount: 0,
      transactionFailureCount: 0,
      bitcoinPurchaseSuccessCount: 0,
      bitcoinPurchaseFailureCount: 0,
      bitcoinPurchaseAmount: [],
      bitcoinPurchaseLatency: [],
      exchangeApiResponseTime: [],
      exchangeApiSuccessCount: 0,
      exchangeApiFailureCount: 0,
      memoryUsage: [],
      cpuUsage: [],
      queueDepth: {},
      queueProcessingTime: []
    };
  }
  
  /**
   * Record transaction processing time
   */
  recordTransactionProcessingTime(durationMs: number, success: boolean): void {
    this.metrics.transactionProcessingTime.push(durationMs);
    
    if (success) {
      this.metrics.transactionSuccessCount++;
    } else {
      this.metrics.transactionFailureCount++;
    }
    
    this.recordMetric({
      name: 'transaction_processing_duration',
      type: 'histogram',
      value: durationMs,
      labels: { success: success.toString() },
      timestamp: Date.now()
    });
    
    // Keep only last 1000 measurements
    if (this.metrics.transactionProcessingTime.length > 1000) {
      this.metrics.transactionProcessingTime.shift();
    }
  }
  
  /**
   * Record Bitcoin purchase metrics
   */
  recordBitcoinPurchase(
    amountAUD: number, 
    latencyMs: number, 
    success: boolean, 
    exchangeProvider: string
  ): void {
    if (success) {
      this.metrics.bitcoinPurchaseSuccessCount++;
      this.metrics.bitcoinPurchaseAmount.push(amountAUD);
    } else {
      this.metrics.bitcoinPurchaseFailureCount++;
    }
    
    this.metrics.bitcoinPurchaseLatency.push(latencyMs);
    
    this.recordMetric({
      name: 'bitcoin_purchase_amount',
      type: 'histogram',
      value: amountAUD,
      labels: { 
        success: success.toString(),
        exchange: exchangeProvider 
      },
      timestamp: Date.now()
    });
    
    this.recordMetric({
      name: 'bitcoin_purchase_latency',
      type: 'histogram',
      value: latencyMs,
      labels: { 
        success: success.toString(),
        exchange: exchangeProvider 
      },
      timestamp: Date.now()
    });
    
    // Keep only last 1000 measurements
    if (this.metrics.bitcoinPurchaseAmount.length > 1000) {
      this.metrics.bitcoinPurchaseAmount.shift();
    }
    if (this.metrics.bitcoinPurchaseLatency.length > 1000) {
      this.metrics.bitcoinPurchaseLatency.shift();
    }
  }
  
  /**
   * Record Exchange API response time
   */
  recordExchangeApiCall(
    endpoint: string,
    responseTimeMs: number,
    success: boolean,
    httpStatus?: number
  ): void {
    this.metrics.exchangeApiResponseTime.push(responseTimeMs);
    
    if (success) {
      this.metrics.exchangeApiSuccessCount++;
    } else {
      this.metrics.exchangeApiFailureCount++;
    }
    
    this.recordMetric({
      name: 'exchange_api_response_time',
      type: 'histogram',
      value: responseTimeMs,
      labels: {
        endpoint,
        success: success.toString(),
        status: httpStatus?.toString() || 'unknown'
      },
      timestamp: Date.now()
    });
    
    // Keep only last 1000 measurements
    if (this.metrics.exchangeApiResponseTime.length > 1000) {
      this.metrics.exchangeApiResponseTime.shift();
    }
  }
  
  /**
   * Record queue depth (if using message queues)
   */
  recordQueueDepth(queueName: string, depth: number): void {
    this.metrics.queueDepth[queueName] = depth;
    
    this.recordMetric({
      name: 'queue_depth',
      type: 'gauge',
      value: depth,
      labels: { queue: queueName },
      timestamp: Date.now()
    });
  }
  
  /**
   * Record queue processing time
   */
  recordQueueProcessingTime(queueName: string, processingTimeMs: number): void {
    this.metrics.queueProcessingTime.push(processingTimeMs);
    
    this.recordMetric({
      name: 'queue_processing_time',
      type: 'histogram',
      value: processingTimeMs,
      labels: { queue: queueName },
      timestamp: Date.now()
    });
    
    // Keep only last 1000 measurements
    if (this.metrics.queueProcessingTime.length > 1000) {
      this.metrics.queueProcessingTime.shift();
    }
  }
  
  /**
   * Get current metrics summary
   */
  getMetricsSummary(): {
    transactionProcessing: {
      successRate: number;
      averageProcessingTime: number;
      p95ProcessingTime: number;
      totalProcessed: number;
    };
    bitcoinPurchases: {
      successRate: number;
      averageAmount: number;
      averageLatency: number;
      p95Latency: number;
      totalPurchases: number;
    };
    exchangeApi: {
      successRate: number;
      averageResponseTime: number;
      p95ResponseTime: number;
      totalCalls: number;
    };
    system: {
      averageMemoryUsage: number;
      averageCpuUsage: number;
    };
  } {
    const totalTransactions = this.metrics.transactionSuccessCount + this.metrics.transactionFailureCount;
    const totalPurchases = this.metrics.bitcoinPurchaseSuccessCount + this.metrics.bitcoinPurchaseFailureCount;
    const totalApiCalls = this.metrics.exchangeApiSuccessCount + this.metrics.exchangeApiFailureCount;
    
    return {
      transactionProcessing: {
        successRate: totalTransactions > 0 ? this.metrics.transactionSuccessCount / totalTransactions : 0,
        averageProcessingTime: this.calculateAverage(this.metrics.transactionProcessingTime),
        p95ProcessingTime: this.calculatePercentile(this.metrics.transactionProcessingTime, 0.95),
        totalProcessed: totalTransactions
      },
      bitcoinPurchases: {
        successRate: totalPurchases > 0 ? this.metrics.bitcoinPurchaseSuccessCount / totalPurchases : 0,
        averageAmount: this.calculateAverage(this.metrics.bitcoinPurchaseAmount),
        averageLatency: this.calculateAverage(this.metrics.bitcoinPurchaseLatency),
        p95Latency: this.calculatePercentile(this.metrics.bitcoinPurchaseLatency, 0.95),
        totalPurchases
      },
      exchangeApi: {
        successRate: totalApiCalls > 0 ? this.metrics.exchangeApiSuccessCount / totalApiCalls : 0,
        averageResponseTime: this.calculateAverage(this.metrics.exchangeApiResponseTime),
        p95ResponseTime: this.calculatePercentile(this.metrics.exchangeApiResponseTime, 0.95),
        totalCalls: totalApiCalls
      },
      system: {
        averageMemoryUsage: this.calculateAverage(this.metrics.memoryUsage),
        averageCpuUsage: this.calculateAverage(this.metrics.cpuUsage)
      }
    };
  }
  
  /**
   * Get raw metrics for external monitoring systems
   */
  getRawMetrics(): OperationalMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get metric history for analysis
   */
  getMetricHistory(since?: number): MetricData[] {
    if (since) {
      return this.metricHistory.filter(m => m.timestamp >= since);
    }
    return [...this.metricHistory];
  }
  
  /**
   * Reset metrics (useful for testing)
   */
  reset(): void {
    this.metrics = this.initializeMetrics();
    this.metricHistory = [];
  }
  
  /**
   * Record a generic metric
   */
  private recordMetric(metric: MetricData): void {
    this.metricHistory.push(metric);
    
    // Trim history if too large
    if (this.metricHistory.length > this.maxHistorySize) {
      this.metricHistory.splice(0, this.metricHistory.length - this.maxHistorySize);
    }
  }
  
  /**
   * Start collecting system metrics
   */
  private startSystemMetricsCollection(): void {
    // Collect system metrics every 30 seconds
    setInterval(() => {
      // Memory usage
      const memUsage = process.memoryUsage();
      const memUsageMB = memUsage.heapUsed / 1024 / 1024;
      this.metrics.memoryUsage.push(memUsageMB);
      
      // Keep only last 100 measurements (50 minutes worth)
      if (this.metrics.memoryUsage.length > 100) {
        this.metrics.memoryUsage.shift();
      }
      
      this.recordMetric({
        name: 'memory_usage_mb',
        type: 'gauge',
        value: memUsageMB,
        timestamp: Date.now()
      });
      
      // CPU usage (simplified - would need more complex calculation for real CPU%)
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      this.metrics.cpuUsage.push(cpuPercent);
      
      // Keep only last 100 measurements
      if (this.metrics.cpuUsage.length > 100) {
        this.metrics.cpuUsage.shift();
      }
      
      this.recordMetric({
        name: 'cpu_usage_seconds',
        type: 'gauge',
        value: cpuPercent,
        timestamp: Date.now()
      });
      
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Calculate average of an array
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  /**
   * Calculate percentile of an array
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)];
  }
}

// Performance timing helper
export class PerformanceTimer {
  private startTime: number;
  private name: string;
  
  constructor(name: string) {
    this.name = name;
    this.startTime = performance.now();
  }
  
  finish(): number {
    const duration = performance.now() - this.startTime;
    console.log(`⏱️ ${this.name}: ${duration.toFixed(2)}ms`);
    return duration;
  }
  
  static measure<T>(name: string, fn: () => T): T {
    const timer = new PerformanceTimer(name);
    try {
      const result = fn();
      timer.finish();
      return result;
    } catch (error) {
      timer.finish();
      throw error;
    }
  }
  
  static async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const timer = new PerformanceTimer(name);
    try {
      const result = await fn();
      timer.finish();
      return result;
    } catch (error) {
      timer.finish();
      throw error;
    }
  }
}

// Singleton metrics collector
export const metricsCollector = new MetricsCollector();

// Export types for use in other modules
export type { MetricData, OperationalMetrics };