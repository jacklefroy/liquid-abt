import Redis from 'ioredis';
import { Logger } from '../logging/logger';

interface CacheConfig {
  host: string;
  port: number;
  password?: string;
  keyPrefix: string;
  retryDelayOnFailover: number;
  maxRetriesPerRequest: number;
  lazyConnect: boolean;
  keepAlive: number;
}

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  compress?: boolean;
  tags?: string[];
}

export class RedisCache {
  private client: Redis;
  private logger: Logger;
  private isConnected: boolean = false;

  constructor(config: CacheConfig) {
    this.logger = new Logger({ module: 'RedisCache' });
    
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      keyPrefix: config.keyPrefix,
      retryDelayOnFailover: config.retryDelayOnFailover,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      lazyConnect: config.lazyConnect,
      keepAlive: config.keepAlive,
      connectTimeout: 10000,
      commandTimeout: 5000,
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.client.on('connect', () => {
      this.isConnected = true;
      this.logger.info('Redis connected successfully');
    });

    this.client.on('error', (error) => {
      this.isConnected = false;
      this.logger.error('Redis connection error', { error: error.message });
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      this.logger.info('Redis reconnecting...');
    });
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  // Generic cache operations
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error('Cache get error', { key, error: (error as Error).message });
      return null;
    }
  }

  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      const ttl = options.ttl || 3600; // Default 1 hour
      
      if (options.ttl) {
        await this.client.setex(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      
      // Store tags for cache invalidation
      if (options.tags && options.tags.length > 0) {
        await this.tagKey(key, options.tags);
      }
      
      return true;
    } catch (error) {
      this.logger.error('Cache set error', { key, error: (error as Error).message });
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      this.logger.error('Cache delete error', { key, error: (error as Error).message });
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error('Cache exists check error', { key, error: (error as Error).message });
      return false;
    }
  }

  // Cache invalidation by tags
  private async tagKey(key: string, tags: string[]): Promise<void> {
    const pipeline = this.client.pipeline();
    
    for (const tag of tags) {
      const tagKey = `tag:${tag}`;
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, 86400); // Tags expire in 24 hours
    }
    
    await pipeline.exec();
  }

  async invalidateByTag(tag: string): Promise<number> {
    try {
      const tagKey = `tag:${tag}`;
      const keys = await this.client.smembers(tagKey);
      
      if (keys.length > 0) {
        const pipeline = this.client.pipeline();
        keys.forEach(key => pipeline.del(key));
        await pipeline.exec();
        
        // Clean up the tag set
        await this.client.del(tagKey);
        
        this.logger.info('Cache invalidated by tag', { tag, keysCount: keys.length });
        return keys.length;
      }
      
      return 0;
    } catch (error) {
      this.logger.error('Cache tag invalidation error', { tag, error: (error as Error).message });
      return 0;
    }
  }

  // Business-specific cache methods
  async cacheExchangeRate(pair: string, rate: number, ttl: number = 300): Promise<void> {
    const key = `exchange_rate:${pair}`;
    await this.set(key, { rate, timestamp: Date.now() }, { 
      ttl, 
      tags: ['exchange_rates', `pair:${pair}`] 
    });
  }

  async getExchangeRate(pair: string): Promise<{ rate: number; timestamp: number } | null> {
    const key = `exchange_rate:${pair}`;
    return await this.get(key);
  }

  async cacheUserSession(userId: string, sessionData: any, ttl: number = 86400): Promise<void> {
    const key = `session:${userId}`;
    await this.set(key, sessionData, { 
      ttl, 
      tags: ['sessions', `user:${userId}`] 
    });
  }

  async getUserSession(userId: string): Promise<any | null> {
    const key = `session:${userId}`;
    return await this.get(key);
  }

  async cacheBitcoinPrice(price: number, ttl: number = 60): Promise<void> {
    const key = 'bitcoin_price:latest';
    await this.set(key, { price, timestamp: Date.now() }, { 
      ttl, 
      tags: ['bitcoin_prices'] 
    });
  }

  async getBitcoinPrice(): Promise<{ price: number; timestamp: number } | null> {
    const key = 'bitcoin_price:latest';
    return await this.get(key);
  }

  async cacheTreasuryBalance(tenantId: string, balance: any, ttl: number = 300): Promise<void> {
    const key = `treasury_balance:${tenantId}`;
    await this.set(key, balance, { 
      ttl, 
      tags: ['treasury_balances', `tenant:${tenantId}`] 
    });
  }

  async getTreasuryBalance(tenantId: string): Promise<any | null> {
    const key = `treasury_balance:${tenantId}`;
    return await this.get(key);
  }

  // Performance monitoring
  async getStats(): Promise<any> {
    try {
      const info = await this.client.info('memory');
      const keyspace = await this.client.info('keyspace');
      
      return {
        connected: this.isConnected,
        memory: info,
        keyspace: keyspace,
        uptime: await this.client.info('server')
      };
    } catch (error) {
      this.logger.error('Failed to get Redis stats', { error: (error as Error).message });
      return { connected: false, error: (error as Error).message };
    }
  }

  // Health check
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      await this.client.ping();
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
}

// Singleton instance
let redisInstance: RedisCache | null = null;

export function createRedisCache(config?: Partial<CacheConfig>): RedisCache {
  if (!redisInstance) {
    const defaultConfig: CacheConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'liquid_abt:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
    };
    
    redisInstance = new RedisCache({ ...defaultConfig, ...config });
  }
  
  return redisInstance;
}

export { redisInstance };