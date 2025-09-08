import { Logger } from '../logging/logger';
import { createRedisCache } from '../cache/redisClient';
import { createConnectionPool } from '../database/connectionPool';

interface QueryPlan {
  query: string;
  estimatedCost: number;
  estimatedRows: number;
  executionTime?: number;
  cacheKey?: string;
  cacheTTL?: number;
}

interface IndexSuggestion {
  table: string;
  columns: string[];
  indexName: string;
  estimatedImprovement: number;
  createStatement: string;
}

interface QueryStats {
  query: string;
  totalCalls: number;
  totalTime: number;
  meanTime: number;
  minTime: number;
  maxTime: number;
  stddevTime: number;
  rows: number;
}

export class QueryOptimizer {
  private logger: Logger;
  private cache = createRedisCache();
  private pool = createConnectionPool();
  private queryCache = new Map<string, QueryPlan>();

  constructor() {
    this.logger = new Logger({ module: 'QueryOptimizer' });
  }

  // Query plan analysis
  async analyzeQuery(query: string, params?: any[]): Promise<QueryPlan> {
    const queryHash = this.hashQuery(query);
    
    if (this.queryCache.has(queryHash)) {
      return this.queryCache.get(queryHash)!;
    }

    try {
      const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
      const result = await this.pool.query(explainQuery, params);
      
      const plan = result.rows[0]['QUERY PLAN'][0];
      const queryPlan: QueryPlan = {
        query,
        estimatedCost: plan['Total Cost'],
        estimatedRows: plan['Plan Rows'],
        executionTime: plan['Actual Total Time']
      };

      this.queryCache.set(queryHash, queryPlan);
      
      this.logger.debug('Query analyzed', {
        queryHash,
        cost: queryPlan.estimatedCost,
        rows: queryPlan.estimatedRows,
        executionTime: queryPlan.executionTime
      });

      return queryPlan;
    } catch (error) {
      this.logger.error('Query analysis failed', {
        error: (error as Error).message,
        query: query.substring(0, 100)
      });
      throw error;
    }
  }

  // Smart caching decisions
  async shouldCache(queryPlan: QueryPlan): Promise<{ shouldCache: boolean; ttl?: number }> {
    const { estimatedCost, estimatedRows, executionTime } = queryPlan;

    // Cache expensive queries (cost > 1000 or execution time > 100ms)
    if (estimatedCost > 1000 || (executionTime && executionTime > 100)) {
      return { shouldCache: true, ttl: 300 }; // 5 minutes for expensive queries
    }

    // Cache queries with many rows (> 1000)
    if (estimatedRows > 1000) {
      return { shouldCache: true, ttl: 180 }; // 3 minutes for large result sets
    }

    // Cache aggregate queries (detected by keywords)
    if (this.isAggregateQuery(queryPlan.query)) {
      return { shouldCache: true, ttl: 600 }; // 10 minutes for aggregates
    }

    // Cache read-only queries for reference data
    if (this.isReferenceDataQuery(queryPlan.query)) {
      return { shouldCache: true, ttl: 3600 }; // 1 hour for reference data
    }

    return { shouldCache: false };
  }

  // Cached query execution
  async executeWithCache<T = any>(
    query: string, 
    params?: any[],
    options: { forceFresh?: boolean; customTTL?: number } = {}
  ): Promise<{ data: T[]; fromCache: boolean }> {
    if (options.forceFresh) {
      return this.executeFresh(query, params);
    }

    const queryPlan = await this.analyzeQuery(query, params);
    const cacheDecision = await this.shouldCache(queryPlan);
    
    if (!cacheDecision.shouldCache) {
      return this.executeFresh(query, params);
    }

    const cacheKey = this.generateCacheKey(query, params);
    const cached = await this.cache.get<T[]>(cacheKey);
    
    if (cached) {
      this.logger.debug('Query served from cache', { cacheKey });
      return { data: cached, fromCache: true };
    }

    const fresh = await this.executeFresh(query, params);
    const ttl = options.customTTL || cacheDecision.ttl || 300;
    
    await this.cache.set(cacheKey, fresh.data, { ttl });
    
    return fresh;
  }

  private async executeFresh<T = any>(query: string, params?: any[]): Promise<{ data: T[]; fromCache: boolean }> {
    const result = await this.pool.query<T>(query, params);
    return { data: result.rows, fromCache: false };
  }

  // Index recommendations
  async getIndexRecommendations(schema: string = 'public'): Promise<IndexSuggestion[]> {
    const suggestions: IndexSuggestion[] = [];

    // Find missing indexes for foreign keys
    const foreignKeyQuery = `
      SELECT 
        schemaname,
        tablename,
        column_name,
        referenced_table_name,
        referenced_column_name
      FROM information_schema.key_column_usage k
      JOIN information_schema.table_constraints t ON k.constraint_name = t.constraint_name
      WHERE t.constraint_type = 'FOREIGN KEY'
        AND k.table_schema = $1
        AND NOT EXISTS (
          SELECT 1 FROM pg_indexes 
          WHERE schemaname = k.table_schema 
            AND tablename = k.table_name 
            AND indexdef LIKE '%' || k.column_name || '%'
        )
    `;

    const fkResult = await this.pool.query(foreignKeyQuery, [schema]);
    
    for (const row of fkResult.rows) {
      suggestions.push({
        table: row.tablename,
        columns: [row.column_name],
        indexName: `idx_${row.tablename}_${row.column_name}_fk`,
        estimatedImprovement: 0.7, // Estimated 70% improvement
        createStatement: `CREATE INDEX idx_${row.tablename}_${row.column_name}_fk ON ${row.tablename} (${row.column_name})`
      });
    }

    // Find slow queries that could benefit from indexes
    const slowQueries = await this.getSlowQueries();
    
    for (const slowQuery of slowQueries) {
      const whereColumns = this.extractWhereColumns(slowQuery.query);
      const orderColumns = this.extractOrderByColumns(slowQuery.query);
      const tableName = this.extractTableName(slowQuery.query);
      
      if (tableName && (whereColumns.length > 0 || orderColumns.length > 0)) {
        const indexColumns = [...whereColumns, ...orderColumns];
        const indexName = `idx_${tableName}_${indexColumns.join('_')}_auto`;
        
        suggestions.push({
          table: tableName,
          columns: indexColumns,
          indexName,
          estimatedImprovement: Math.min(slowQuery.meanTime / 1000, 0.8), // Max 80% improvement
          createStatement: `CREATE INDEX ${indexName} ON ${tableName} (${indexColumns.join(', ')})`
        });
      }
    }

    return suggestions;
  }

  // Query statistics
  async getSlowQueries(limit: number = 20): Promise<QueryStats[]> {
    const query = `
      SELECT 
        query,
        calls as total_calls,
        total_exec_time as total_time,
        mean_exec_time as mean_time,
        min_exec_time as min_time,
        max_exec_time as max_time,
        stddev_exec_time as stddev_time,
        rows
      FROM pg_stat_statements
      WHERE calls > 100 -- Only queries called more than 100 times
      ORDER BY mean_exec_time DESC
      LIMIT $1
    `;

    try {
      const result = await this.pool.query(query, [limit]);
      return result.rows.map(row => ({
        query: row.query.substring(0, 200) + (row.query.length > 200 ? '...' : ''),
        totalCalls: parseInt(row.total_calls),
        totalTime: parseFloat(row.total_time),
        meanTime: parseFloat(row.mean_time),
        minTime: parseFloat(row.min_time),
        maxTime: parseFloat(row.max_time),
        stddevTime: parseFloat(row.stddev_time),
        rows: parseInt(row.rows)
      }));
    } catch (error) {
      this.logger.warn('Could not fetch slow queries - pg_stat_statements extension may not be enabled');
      return [];
    }
  }

  // Business-specific optimized queries
  async getTreasuryBalance(tenantId: string, useCache: boolean = true): Promise<any> {
    const query = `
      SELECT 
        t.tenant_id,
        COALESCE(SUM(bp.bitcoin_amount), 0) as total_bitcoin,
        COALESCE(SUM(bp.fiat_amount), 0) as total_fiat_invested,
        COUNT(bp.id) as total_purchases,
        MAX(bp.created_at) as last_purchase_date
      FROM tenants t
      LEFT JOIN bitcoin_purchases bp ON t.id = bp.tenant_id
      WHERE t.tenant_id = $1
      GROUP BY t.tenant_id
    `;

    if (useCache) {
      const result = await this.executeWithCache(query, [tenantId], { customTTL: 300 });
      return result.data[0];
    } else {
      const result = await this.pool.query(query, [tenantId]);
      return result.rows[0];
    }
  }

  async getBitcoinPriceHistory(days: number = 30): Promise<any[]> {
    const query = `
      SELECT 
        DATE(created_at) as date,
        AVG(bitcoin_price_aud) as avg_price,
        MIN(bitcoin_price_aud) as min_price,
        MAX(bitcoin_price_aud) as max_price,
        COUNT(*) as transaction_count
      FROM bitcoin_purchases
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    const result = await this.executeWithCache(query, [], { customTTL: 3600 });
    return result.data;
  }

  async getTenantActivitySummary(tenantId: string): Promise<any> {
    const query = `
      SELECT 
        COUNT(DISTINCT DATE(bp.created_at)) as active_days,
        AVG(bp.fiat_amount) as avg_purchase_amount,
        SUM(CASE WHEN bp.created_at >= NOW() - INTERVAL '7 days' THEN bp.fiat_amount ELSE 0 END) as weekly_volume,
        SUM(CASE WHEN bp.created_at >= NOW() - INTERVAL '30 days' THEN bp.fiat_amount ELSE 0 END) as monthly_volume
      FROM bitcoin_purchases bp
      WHERE bp.tenant_id = $1
        AND bp.created_at >= NOW() - INTERVAL '90 days'
    `;

    const result = await this.executeWithCache(query, [tenantId], { customTTL: 1800 });
    return result.data[0];
  }

  // Utility methods
  private hashQuery(query: string, params?: any[]): string {
    const crypto = require('crypto');
    const content = query + (params ? JSON.stringify(params) : '');
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  private generateCacheKey(query: string, params?: any[]): string {
    const hash = this.hashQuery(query, params);
    return `query:${hash}`;
  }

  private isAggregateQuery(query: string): boolean {
    const aggregateKeywords = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP BY'];
    return aggregateKeywords.some(keyword => 
      query.toUpperCase().includes(keyword)
    );
  }

  private isReferenceDataQuery(query: string): boolean {
    const referenceKeywords = ['settings', 'config', 'lookup', 'reference'];
    return referenceKeywords.some(keyword => 
      query.toLowerCase().includes(keyword)
    );
  }

  private extractWhereColumns(query: string): string[] {
    // Simple regex to extract column names from WHERE clauses
    const whereMatch = query.match(/WHERE\s+(.+?)(?:GROUP|ORDER|LIMIT|$)/i);
    if (!whereMatch) return [];
    
    const whereClause = whereMatch[1];
    const columnMatches = whereClause.match(/(\w+)\s*[=<>]/g);
    
    return columnMatches 
      ? columnMatches.map(match => match.replace(/\s*[=<>].*/, '').trim())
      : [];
  }

  private extractOrderByColumns(query: string): string[] {
    const orderMatch = query.match(/ORDER BY\s+(.+?)(?:LIMIT|$)/i);
    if (!orderMatch) return [];
    
    const orderClause = orderMatch[1];
    return orderClause.split(',').map(col => 
      col.trim().replace(/\s+(ASC|DESC)$/i, '').trim()
    );
  }

  private extractTableName(query: string): string | null {
    const fromMatch = query.match(/FROM\s+(\w+)/i);
    return fromMatch ? fromMatch[1] : null;
  }

  // Performance monitoring
  async getPerformanceStats(): Promise<any> {
    const poolStats = await this.pool.getPoolStats();
    const cacheStats = await this.cache.getStats();
    
    return {
      database: poolStats,
      cache: cacheStats,
      queryCache: {
        size: this.queryCache.size,
        hitRate: this.calculateCacheHitRate()
      }
    };
  }

  private calculateCacheHitRate(): number {
    // This would need to be implemented with actual hit/miss counters
    return 0.85; // Placeholder
  }
}

// Singleton instance
let optimizerInstance: QueryOptimizer | null = null;

export function createQueryOptimizer(): QueryOptimizer {
  if (!optimizerInstance) {
    optimizerInstance = new QueryOptimizer();
  }
  
  return optimizerInstance;
}