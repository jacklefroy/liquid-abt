// LIQUID ABT - Rate Limiting Middleware

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from 'ioredis';

// Rate limiting configuration
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: NextRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  bypass?: (req: NextRequest) => boolean;
}

// Default configurations for different endpoint types
export const RATE_LIMIT_CONFIGS = {
  API_DEFAULT: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    message: 'Too many API requests, please try again later',
  },
  WEBHOOK: {
    windowMs: 60 * 1000, // 1 minute  
    maxRequests: 1000, // Higher limit for webhooks
    message: 'Webhook rate limit exceeded',
  },
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5, // Stricter for auth endpoints
    message: 'Too many authentication attempts, please try again later',
  },
  REGISTRATION: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3, // Very strict for registration
    message: 'Registration rate limit exceeded, please try again later',
  },
} as const;

// Redis client for distributed rate limiting (optional)
let redisClient: Redis | null = null;

// Initialize Redis client if available
function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  
  if (process.env.REDIS_URL) {
    try {
      redisClient = new Redis(process.env.REDIS_URL);
      console.log('Rate limiter: Connected to Redis for distributed limiting');
      return redisClient;
    } catch (error) {
      console.warn('Rate limiter: Failed to connect to Redis, falling back to memory store:', error);
      return null;
    }
  }
  
  return null;
}

// In-memory store for rate limiting (fallback when Redis not available)
interface MemoryStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const memoryStore: MemoryStore = {};

// Clean up expired entries from memory store
function cleanupMemoryStore() {
  const now = Date.now();
  for (const key in memoryStore) {
    if (memoryStore[key].resetTime <= now) {
      delete memoryStore[key];
    }
  }
}

// Set up periodic cleanup for memory store (every 5 minutes)
setInterval(cleanupMemoryStore, 5 * 60 * 1000);

/**
 * Default key generator - uses IP address and user agent
 */
function defaultKeyGenerator(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for') || 
            req.headers.get('x-real-ip') || 
            'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const path = req.nextUrl.pathname;
  
  // Include path to allow different limits per endpoint
  return `rate_limit:${path}:${ip}:${userAgent.substring(0, 50)}`;
}

/**
 * Check if request should bypass rate limiting
 */
function shouldBypassRateLimit(req: NextRequest): boolean {
  // Bypass for webhook endpoints by default
  const path = req.nextUrl.pathname;
  
  // Webhook endpoints
  if (path.includes('/webhook')) {
    return false; // Don't bypass - use webhook-specific limits
  }
  
  // Health check endpoints
  if (path.includes('/health') || path.includes('/status')) {
    return true;
  }
  
  // Internal requests (if coming from same origin in development)
  if (process.env.NODE_ENV === 'development' && 
      req.headers.get('origin')?.includes('localhost')) {
    return false; // Don't bypass in development to test limits
  }
  
  return false;
}

/**
 * Redis-based rate limiter
 */
async function checkRateLimitRedis(
  redis: Redis,
  key: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; count: number; resetTime: number }> {
  const now = Date.now();
  const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
  const resetTime = windowStart + config.windowMs;
  
  try {
    // Use Redis pipeline for atomic operations
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, Math.ceil(config.windowMs / 1000));
    
    const results = await pipeline.exec();
    const count = results?.[0]?.[1] as number || 0;
    
    return {
      allowed: count <= config.maxRequests,
      count,
      resetTime,
    };
  } catch (error) {
    console.error('Redis rate limit check failed:', error);
    // Fall back to allowing the request on Redis errors
    return { allowed: true, count: 1, resetTime };
  }
}

/**
 * Memory-based rate limiter
 */
function checkRateLimitMemory(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; count: number; resetTime: number } {
  const now = Date.now();
  const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
  const resetTime = windowStart + config.windowMs;
  
  // Clean up expired entries
  if (memoryStore[key] && memoryStore[key].resetTime <= now) {
    delete memoryStore[key];
  }
  
  // Initialize or increment counter
  if (!memoryStore[key]) {
    memoryStore[key] = { count: 1, resetTime };
  } else {
    memoryStore[key].count++;
  }
  
  const count = memoryStore[key].count;
  
  return {
    allowed: count <= config.maxRequests,
    count,
    resetTime,
  };
}

/**
 * Create a rate limiting middleware
 */
export function createRateLimit(config: RateLimitConfig) {
  const keyGenerator = config.keyGenerator || defaultKeyGenerator;
  
  return async function rateLimitMiddleware(req: NextRequest): Promise<NextResponse | null> {
    // Check if request should bypass rate limiting
    if (config.bypass?.(req) || shouldBypassRateLimit(req)) {
      return null; // Continue to next handler
    }
    
    // Generate unique key for this request
    const key = keyGenerator(req);
    
    // Check rate limit using Redis or memory store
    const redis = getRedisClient();
    const result = redis 
      ? await checkRateLimitRedis(redis, key, config)
      : checkRateLimitMemory(key, config);
    
    // Create response with rate limit headers
    const headers = new Headers({
      'X-RateLimit-Limit': config.maxRequests.toString(),
      'X-RateLimit-Remaining': Math.max(0, config.maxRequests - result.count).toString(),
      'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
    });
    
    if (!result.allowed) {
      // Rate limit exceeded
      headers.set('Retry-After', Math.ceil((result.resetTime - Date.now()) / 1000).toString());
      
      return new NextResponse(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: config.message || 'Too many requests',
          retryAfter: result.resetTime,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...Object.fromEntries(headers.entries()),
          },
        }
      );
    }
    
    // Request is allowed - add headers to track usage
    return NextResponse.next({
      headers,
    });
  };
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const apiRateLimit = createRateLimit(RATE_LIMIT_CONFIGS.API_DEFAULT);

export const webhookRateLimit = createRateLimit({
  ...RATE_LIMIT_CONFIGS.WEBHOOK,
  bypass: (req) => !req.nextUrl.pathname.includes('/webhook'),
});

export const authRateLimit = createRateLimit({
  ...RATE_LIMIT_CONFIGS.AUTH,
  bypass: (req) => {
    const path = req.nextUrl.pathname;
    return !path.includes('/auth/') && !path.includes('/login') && !path.includes('/signin');
  },
});

export const registrationRateLimit = createRateLimit({
  ...RATE_LIMIT_CONFIGS.REGISTRATION,
  bypass: (req) => {
    const path = req.nextUrl.pathname;
    return !path.includes('/register') && !path.includes('/signup');
  },
});

/**
 * Middleware factory for specific endpoints
 */
export function createEndpointRateLimit(
  maxRequests: number,
  windowMs: number = 60 * 1000,
  message?: string
) {
  return createRateLimit({
    maxRequests,
    windowMs,
    message,
  });
}

/**
 * Get rate limit status for a key (useful for monitoring)
 */
export async function getRateLimitStatus(req: NextRequest, config: RateLimitConfig) {
  const keyGenerator = config.keyGenerator || defaultKeyGenerator;
  const key = keyGenerator(req);
  
  const redis = getRedisClient();
  
  if (redis) {
    try {
      const count = await redis.get(key);
      const ttl = await redis.ttl(key);
      
      return {
        key,
        count: count ? parseInt(count) : 0,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - (count ? parseInt(count) : 0)),
        resetTime: ttl > 0 ? Date.now() + (ttl * 1000) : null,
      };
    } catch (error) {
      console.error('Failed to get rate limit status:', error);
      return null;
    }
  } else {
    const entry = memoryStore[key];
    return {
      key,
      count: entry?.count || 0,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - (entry?.count || 0)),
      resetTime: entry?.resetTime || null,
    };
  }
}

/**
 * Clear rate limit for a key (useful for testing or admin override)
 */
export async function clearRateLimit(key: string): Promise<boolean> {
  const redis = getRedisClient();
  
  if (redis) {
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      console.error('Failed to clear rate limit:', error);
      return false;
    }
  } else {
    delete memoryStore[key];
    return true;
  }
}

/**
 * Cleanup function for graceful shutdown
 */
export async function closeRateLimiter(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}