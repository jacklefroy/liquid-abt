import { Pool, PoolClient, QueryResult } from 'pg';
import { Logger } from '../logging/logger';

interface PoolConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | object;
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  acquireTimeoutMillis: number;
  statementTimeout: number;
  queryTimeout: number;
}

interface QueryOptions {
  timeout?: number;
  retries?: number;
  transactionId?: string;
}

interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxPoolSize: number;
  minPoolSize: number;
  averageAcquireTime: number;
  totalConnections: number;
  totalQueries: number;
  totalErrors: number;
}

export class DatabaseConnectionPool {
  private pool: Pool;
  private logger: Logger;
  private stats: {
    totalConnections: number;
    totalQueries: number;
    totalErrors: number;
    acquireTimes: number[];
  };

  constructor(config: PoolConfig) {
    this.logger = new Logger({ module: 'DatabaseConnectionPool' });
    this.stats = {
      totalConnections: 0,
      totalQueries: 0,
      totalErrors: 0,
      acquireTimes: []
    };

    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      max: config.max,
      min: config.min,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      acquireTimeoutMillis: config.acquireTimeoutMillis,
      statement_timeout: config.statementTimeout,
      query_timeout: config.queryTimeout,
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.pool.on('connect', (client: PoolClient) => {
      this.stats.totalConnections++;
      this.logger.debug('Database client connected', { 
        totalConnections: this.stats.totalConnections 
      });
    });

    this.pool.on('acquire', (client: PoolClient) => {
      const acquireTime = Date.now();
      client.on('release', () => {
        const duration = Date.now() - acquireTime;
        this.stats.acquireTimes.push(duration);
        
        // Keep only last 1000 acquire times for average calculation
        if (this.stats.acquireTimes.length > 1000) {
          this.stats.acquireTimes = this.stats.acquireTimes.slice(-1000);
        }
      });
    });

    this.pool.on('error', (error: Error) => {
      this.stats.totalErrors++;
      this.logger.error('Database pool error', { 
        error: error.message,
        totalErrors: this.stats.totalErrors 
      });
    });

    this.pool.on('remove', (client: PoolClient) => {
      this.logger.debug('Database client removed from pool');
    });
  }

  // Basic query methods
  async query<T = any>(
    text: string, 
    params?: any[], 
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const queryId = Math.random().toString(36).substring(7);
    const startTime = Date.now();
    const maxRetries = options.retries || 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug('Executing query', { 
          queryId, 
          attempt, 
          transactionId: options.transactionId,
          query: text.substring(0, 100) + (text.length > 100 ? '...' : '')
        });

        const result = await this.pool.query<T>(text, params);
        const duration = Date.now() - startTime;
        
        this.stats.totalQueries++;
        this.logger.debug('Query completed', { 
          queryId, 
          duration, 
          rowCount: result.rowCount,
          transactionId: options.transactionId
        });

        return result;
      } catch (error) {
        lastError = error as Error;
        this.stats.totalErrors++;
        
        this.logger.error('Query failed', { 
          queryId, 
          attempt, 
          maxRetries, 
          error: lastError.message,
          transactionId: options.transactionId
        });

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // Transaction support
  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
    options: { timeout?: number } = {}
  ): Promise<T> {
    const transactionId = Math.random().toString(36).substring(7);
    const client = await this.pool.connect();
    const startTime = Date.now();

    try {
      this.logger.debug('Starting transaction', { transactionId });
      
      await client.query('BEGIN');
      
      // Set transaction timeout if specified
      if (options.timeout) {
        await client.query(`SET LOCAL statement_timeout = ${options.timeout}`);
      }

      const result = await callback(client);
      
      await client.query('COMMIT');
      const duration = Date.now() - startTime;
      
      this.logger.debug('Transaction committed', { transactionId, duration });
      
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      const duration = Date.now() - startTime;
      
      this.logger.error('Transaction rolled back', { 
        transactionId, 
        duration, 
        error: (error as Error).message 
      });
      
      throw error;
    } finally {
      client.release();
    }
  }

  // Prepared statements for performance
  private preparedStatements = new Map<string, string>();

  async prepareStatement(name: string, query: string): Promise<void> {
    try {
      const client = await this.pool.connect();
      await client.query(`PREPARE ${name} AS ${query}`);
      this.preparedStatements.set(name, query);
      client.release();
      
      this.logger.debug('Statement prepared', { name });
    } catch (error) {
      this.logger.error('Failed to prepare statement', { 
        name, 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  async executePrepared<T = any>(
    name: string, 
    params?: any[], 
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    if (!this.preparedStatements.has(name)) {
      throw new Error(`Prepared statement '${name}' not found`);
    }

    const query = `EXECUTE ${name}${params && params.length > 0 ? ` (${params.map(() => '?').join(', ')})` : ''}`;
    return this.query<T>(query, params, options);
  }

  // Batch operations
  async batchInsert(
    table: string, 
    columns: string[], 
    rows: any[][], 
    options: { batchSize?: number; onConflict?: string } = {}
  ): Promise<void> {
    const batchSize = options.batchSize || 1000;
    const onConflictClause = options.onConflict || '';
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      const placeholders = batch.map((_, rowIndex) => 
        `(${columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(', ')})`
      ).join(', ');
      
      const values = batch.flat();
      const query = `
        INSERT INTO ${table} (${columns.join(', ')}) 
        VALUES ${placeholders} 
        ${onConflictClause}
      `;
      
      await this.query(query, values);
      
      this.logger.debug('Batch insert completed', { 
        table, 
        batchNumber: Math.floor(i / batchSize) + 1, 
        rowsInserted: batch.length 
      });
    }
  }

  // Connection pool management
  async getPoolStats(): Promise<PoolStats> {
    const averageAcquireTime = this.stats.acquireTimes.length > 0 
      ? this.stats.acquireTimes.reduce((a, b) => a + b, 0) / this.stats.acquireTimes.length 
      : 0;

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      maxPoolSize: this.pool.options.max || 10,
      minPoolSize: this.pool.options.min || 0,
      averageAcquireTime,
      totalConnections: this.stats.totalConnections,
      totalQueries: this.stats.totalQueries,
      totalErrors: this.stats.totalErrors
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      await this.query('SELECT 1');
      const latency = Date.now() - startTime;
      
      return {
        healthy: true,
        latency
      };
    } catch (error) {
      return {
        healthy: false,
        error: (error as Error).message
      };
    }
  }

  async close(): Promise<void> {
    this.logger.info('Closing database connection pool');
    await this.pool.end();
  }

  // Maintenance operations
  async vacuum(table?: string): Promise<void> {
    const query = table ? `VACUUM ANALYZE ${table}` : 'VACUUM ANALYZE';
    await this.query(query);
    this.logger.info('Database vacuum completed', { table });
  }

  async getSlowQueries(limit: number = 10): Promise<any[]> {
    const query = `
      SELECT query, mean_exec_time, calls, total_exec_time
      FROM pg_stat_statements
      ORDER BY mean_exec_time DESC
      LIMIT $1
    `;
    
    try {
      const result = await this.query(query, [limit]);
      return result.rows;
    } catch (error) {
      this.logger.warn('Could not fetch slow queries - pg_stat_statements may not be enabled');
      return [];
    }
  }
}

// Connection pool factory
let poolInstance: DatabaseConnectionPool | null = null;

export function createConnectionPool(config?: Partial<PoolConfig>): DatabaseConnectionPool {
  if (!poolInstance) {
    const defaultConfig: PoolConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'liquid_abt',
      user: process.env.DB_USER || 'liquid_user',
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      min: parseInt(process.env.DB_POOL_MIN || '5'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      acquireTimeoutMillis: 60000,
      statementTimeout: 60000,
      queryTimeout: 30000,
    };
    
    poolInstance = new DatabaseConnectionPool({ ...defaultConfig, ...config });
  }
  
  return poolInstance;
}

export { poolInstance };