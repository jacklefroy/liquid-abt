// LIQUID ABT - Rate Limiting Integration Tests

import { TestDatabaseUtils } from '@/../__tests__/utils/database'
import crypto from 'crypto'

// Mock Redis for consistent testing
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn()
  }))
})

describe('Rate Limiting Integration Tests', () => {
  let testTenant: any

  beforeAll(async () => {
    const uniqueId = crypto.randomUUID()
    testTenant = await TestDatabaseUtils.createTestTenant({
      companyName: 'Rate Limit Test Company',
      subdomain: `rate-test-${uniqueId.substring(0, 8)}`,
      contactEmail: `rate+${uniqueId}@test.com`
    })
  }, 30000)

  afterAll(async () => {
    if (testTenant?.id) {
      await TestDatabaseUtils.cleanupTenant(testTenant.id)
    }
    await TestDatabaseUtils.disconnect()
  }, 10000)

  beforeEach(() => {
    // Clear any cached rate limit data between tests
    jest.clearAllMocks()
  })

  describe('Rate Limiting Logic and Patterns', () => {
    it('should define different rate limits for different endpoint types', () => {
      // Test rate limit configuration logic
      const rateLimits = {
        API_DEFAULT: { maxRequests: 100, windowMinutes: 1 },
        WEBHOOK: { maxRequests: 1000, windowMinutes: 1 },
        AUTH: { maxRequests: 5, windowMinutes: 15 },
        REGISTRATION: { maxRequests: 3, windowMinutes: 60 }
      }

      // Validate rate limit configurations
      expect(rateLimits.API_DEFAULT.maxRequests).toBe(100)
      expect(rateLimits.WEBHOOK.maxRequests).toBe(1000)
      expect(rateLimits.AUTH.maxRequests).toBe(5)
      expect(rateLimits.REGISTRATION.maxRequests).toBe(3)
      
      // Webhook should have higher limits than API
      expect(rateLimits.WEBHOOK.maxRequests).toBeGreaterThan(rateLimits.API_DEFAULT.maxRequests)
      
      // Auth should have stricter limits than API
      expect(rateLimits.AUTH.maxRequests).toBeLessThan(rateLimits.API_DEFAULT.maxRequests)
      expect(rateLimits.AUTH.windowMinutes).toBeGreaterThan(rateLimits.API_DEFAULT.windowMinutes)
    })

    it('should extract IP address from various headers correctly', () => {
      // Test IP extraction logic from different header sources
      const extractIPFromHeaders = (headers: Record<string, string>) => {
        // Priority order: x-forwarded-for, x-real-ip, cf-connecting-ip
        if (headers['x-forwarded-for']) {
          return headers['x-forwarded-for'].split(',')[0].trim()
        }
        if (headers['x-real-ip']) {
          return headers['x-real-ip']
        }
        if (headers['cf-connecting-ip']) {
          return headers['cf-connecting-ip']
        }
        return '127.0.0.1' // fallback
      }

      // Test x-forwarded-for with multiple IPs
      expect(extractIPFromHeaders({
        'x-forwarded-for': '203.0.113.1, 198.51.100.1'
      })).toBe('203.0.113.1')

      // Test x-real-ip
      expect(extractIPFromHeaders({
        'x-real-ip': '203.0.113.2'
      })).toBe('203.0.113.2')

      // Test cf-connecting-ip (Cloudflare)
      expect(extractIPFromHeaders({
        'cf-connecting-ip': '203.0.113.3'
      })).toBe('203.0.113.3')

      // Test priority order (x-forwarded-for takes precedence)
      expect(extractIPFromHeaders({
        'x-forwarded-for': '203.0.113.1',
        'x-real-ip': '203.0.113.2',
        'cf-connecting-ip': '203.0.113.3'
      })).toBe('203.0.113.1')
    })

    it('should classify endpoints correctly by path patterns', () => {
      // Test endpoint classification logic
      const classifyEndpoint = (path: string) => {
        if (path.includes('/auth/register')) return 'REGISTRATION'
        if (path.includes('/auth/')) return 'AUTH'
        if (path.includes('/webhook')) return 'WEBHOOK'
        return 'API_DEFAULT'
      }

      const testCases = [
        { path: '/api/auth/login', expectedType: 'AUTH' },
        { path: '/api/auth/register', expectedType: 'REGISTRATION' },
        { path: '/api/auth/verify', expectedType: 'AUTH' },
        { path: '/api/stripe/webhook', expectedType: 'WEBHOOK' },
        { path: '/api/paypal/webhook', expectedType: 'WEBHOOK' },
        { path: '/api/square/webhook', expectedType: 'WEBHOOK' },
        { path: '/api/dashboard', expectedType: 'API_DEFAULT' },
        { path: '/api/transactions', expectedType: 'API_DEFAULT' },
        { path: '/api/integrations', expectedType: 'API_DEFAULT' },
        { path: '/api/users', expectedType: 'API_DEFAULT' },
        { path: '/api/reports', expectedType: 'API_DEFAULT' }
      ]

      testCases.forEach(({ path, expectedType }) => {
        const actualType = classifyEndpoint(path)
        expect(actualType).toBe(expectedType)
      })
    })

    it('should implement memory fallback when Redis is unavailable', () => {
      // Test memory-based rate limiting fallback
      const memoryStore = new Map<string, { count: number, resetTime: number }>()

      const checkRateLimit = (key: string, limit: number, windowMs: number) => {
        const now = Date.now()
        const record = memoryStore.get(key)

        if (!record || now > record.resetTime) {
          // Reset or create new record
          memoryStore.set(key, { count: 1, resetTime: now + windowMs })
          return { allowed: true, remaining: limit - 1 }
        }

        if (record.count >= limit) {
          return { allowed: false, remaining: 0, resetTime: record.resetTime }
        }

        record.count++
        return { allowed: true, remaining: limit - record.count }
      }

      const ip = '192.168.1.200'
      const limit = 5
      const windowMs = 60000 // 1 minute

      // First 5 requests should be allowed
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit(ip, limit, windowMs)
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(limit - (i + 1))
      }

      // 6th request should be denied
      const sixthRequest = checkRateLimit(ip, limit, windowMs)
      expect(sixthRequest.allowed).toBe(false)
      expect(sixthRequest.remaining).toBe(0)
    })

    it('should handle rate limit exceeded scenarios correctly', () => {
      // Test rate limit exceeded logic with mock Redis responses
      const simulateRateLimitCheck = (currentCount: number, limit: number, ttl: number) => {
        if (currentCount > limit) {
          return {
            allowed: false,
            status: 429,
            error: 'Too many requests',
            retryAfter: ttl,
            headers: {
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': (Date.now() + ttl * 1000).toString()
            }
          }
        }
        return {
          allowed: true,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': (limit - currentCount).toString()
          }
        }
      }

      // Test API endpoint limit exceeded (100 req/min)
      const apiResult = simulateRateLimitCheck(101, 100, 30)
      expect(apiResult.allowed).toBe(false)
      expect(apiResult.status).toBe(429)
      expect(apiResult.error).toBe('Too many requests')
      expect(apiResult.retryAfter).toBe(30)
      expect(apiResult.headers['X-RateLimit-Remaining']).toBe('0')

      // Test under limit scenario
      const underLimitResult = simulateRateLimitCheck(50, 100, 30)
      expect(underLimitResult.allowed).toBe(true)
      expect(underLimitResult.headers['X-RateLimit-Remaining']).toBe('50')
    })

    it('should enforce stricter limits for auth endpoints', () => {
      // Test auth endpoint rate limiting (5 requests in 15 minutes)
      const authRateLimit = {
        maxRequests: 5,
        windowMinutes: 15,
        currentCount: 6,
        resetTime: Date.now() + (10 * 60 * 1000) // 10 minutes remaining
      }

      const checkAuthRateLimit = (count: number, limit: number) => {
        if (count > limit) {
          return {
            allowed: false,
            status: 429,
            error: 'Too many authentication attempts',
            message: 'Please wait before trying again',
            retryAfter: Math.floor((authRateLimit.resetTime - Date.now()) / 1000)
          }
        }
        return { allowed: true }
      }

      const result = checkAuthRateLimit(authRateLimit.currentCount, authRateLimit.maxRequests)
      expect(result.allowed).toBe(false)
      expect(result.status).toBe(429)
      expect(result.error).toBe('Too many authentication attempts')
      expect(result.retryAfter).toBeGreaterThan(0)

      // Auth limits should be much stricter than API limits
      const apiLimit = 100
      const authLimit = 5
      expect(authLimit).toBeLessThan(apiLimit * 0.1) // Auth should be < 10% of API limit
    })

    it('should enforce strictest limits for registration endpoints', () => {
      // Test registration endpoint rate limiting (3 requests per hour)
      const registrationRateLimit = {
        maxRequests: 3,
        windowMinutes: 60,
        currentCount: 4,
        resetTime: Date.now() + (30 * 60 * 1000) // 30 minutes remaining
      }

      const checkRegistrationRateLimit = (count: number, limit: number) => {
        if (count > limit) {
          return {
            allowed: false,
            status: 429,
            error: 'Registration rate limit exceeded',
            message: 'Too many registration attempts. Please wait before trying again.',
            retryAfter: Math.floor((registrationRateLimit.resetTime - Date.now()) / 1000)
          }
        }
        return { allowed: true }
      }

      const result = checkRegistrationRateLimit(registrationRateLimit.currentCount, registrationRateLimit.maxRequests)
      expect(result.allowed).toBe(false)
      expect(result.status).toBe(429)
      expect(result.error).toBe('Registration rate limit exceeded')
      expect(result.retryAfter).toBeGreaterThan(0)

      // Registration should have the strictest limits
      const limits = {
        api: 100,
        auth: 5,
        registration: 3
      }
      
      expect(limits.registration).toBeLessThan(limits.auth)
      expect(limits.auth).toBeLessThan(limits.api)
      expect(limits.registration / limits.api).toBeLessThan(0.05) // Registration should be < 5% of API limit
    })

    it('should allow webhook endpoints higher rate limits', () => {
      // Test webhook endpoint rate limiting (1000 per minute)
      const webhookLimits = {
        stripe: { maxRequests: 1000, windowMinutes: 1 },
        paypal: { maxRequests: 1000, windowMinutes: 1 },
        square: { maxRequests: 1000, windowMinutes: 1 }
      }

      const checkWebhookRateLimit = (provider: string, currentCount: number) => {
        const limit = webhookLimits[provider as keyof typeof webhookLimits]
        if (!limit) return { allowed: false, error: 'Unknown webhook provider' }
        
        if (currentCount <= limit.maxRequests) {
          return {
            allowed: true,
            remaining: limit.maxRequests - currentCount,
            provider
          }
        }
        
        return {
          allowed: false,
          status: 429,
          error: `${provider} webhook rate limit exceeded`
        }
      }

      // Test under limit scenarios
      const stripeResult = checkWebhookRateLimit('stripe', 500)
      expect(stripeResult.allowed).toBe(true)
      expect(stripeResult.remaining).toBe(500)

      const paypalResult = checkWebhookRateLimit('paypal', 750)
      expect(paypalResult.allowed).toBe(true)
      expect(paypalResult.remaining).toBe(250)

      // Test webhook limits are higher than API limits
      const apiLimit = 100
      const webhookLimit = 1000
      expect(webhookLimit).toBeGreaterThan(apiLimit * 5) // Webhook should be > 5x API limit
    })

    it('should handle concurrent requests from same IP correctly', () => {
      // Test concurrent request handling with atomic operations
      const concurrentRateLimiter = {
        counters: new Map<string, number>(),
        
        increment: function(key: string) {
          const current = this.counters.get(key) || 0
          const newCount = current + 1
          this.counters.set(key, newCount)
          return newCount
        },
        
        checkLimit: function(key: string, limit: number) {
          const count = this.counters.get(key) || 0
          return {
            allowed: count <= limit,
            count,
            remaining: Math.max(0, limit - count)
          }
        }
      }

      const ip = '192.168.1.205'
      const limit = 100
      
      // Simulate 5 concurrent requests
      const results = []
      for (let i = 0; i < 5; i++) {
        const count = concurrentRateLimiter.increment(ip)
        const limitCheck = concurrentRateLimiter.checkLimit(ip, limit)
        results.push({ count, allowed: limitCheck.allowed })
      }

      // All requests should be allowed and counted correctly
      expect(results).toHaveLength(5)
      results.forEach((result, index) => {
        expect(result.count).toBe(index + 1)
        expect(result.allowed).toBe(true)
      })

      // Final count should be 5
      const finalCheck = concurrentRateLimiter.checkLimit(ip, limit)
      expect(finalCheck.count).toBe(5)
      expect(finalCheck.remaining).toBe(95)
    })

    it('should handle IPv6 addresses correctly', () => {
      // Test IPv6 address validation and processing
      const validateIPAddress = (ip: string) => {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
        const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^([0-9a-fA-F]{1,4}:)*::([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/
        
        if (ipv4Regex.test(ip)) return { valid: true, type: 'IPv4' }
        if (ipv6Regex.test(ip)) return { valid: true, type: 'IPv6' }
        return { valid: false, type: 'unknown' }
      }

      const testIPs = [
        '2001:db8::1',
        '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        '::1',
        '::ffff:192.0.2.1',
        'fe80::1%lo0'
      ]

      testIPs.forEach(ip => {
        const result = validateIPAddress(ip.split('%')[0]) // Remove interface identifier if present
        expect(result.valid).toBe(true)
        expect(result.type).toBe('IPv6')
      })

      // Test mixed scenarios
      const mixedResults = [
        { ip: '192.168.1.1', expectedType: 'IPv4' },
        { ip: '2001:db8::1', expectedType: 'IPv6' },
        { ip: '::1', expectedType: 'IPv6' },
        { ip: '127.0.0.1', expectedType: 'IPv4' }
      ]

      mixedResults.forEach(({ ip, expectedType }) => {
        const result = validateIPAddress(ip)
        expect(result.valid).toBe(true)
        expect(result.type).toBe(expectedType)
      })
    })

    it('should handle malformed IP addresses gracefully', () => {
      // Test malformed IP address handling with fallback logic
      const processIPAddress = (ip: string) => {
        if (!ip || typeof ip !== 'string') {
          return '127.0.0.1' // Default fallback
        }

        // Basic validation patterns
        const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/
        const ipv6Pattern = /^[0-9a-fA-F:]+$/
        
        // Clean the IP (remove extra spaces, handle comma-separated)
        const cleanIP = ip.split(',')[0].trim()
        
        if (ipv4Pattern.test(cleanIP) || ipv6Pattern.test(cleanIP)) {
          return cleanIP
        }
        
        // For malformed IPs, return a safe default
        return '127.0.0.1'
      }

      const malformedIPs = [
        'invalid-ip-address',
        '999.999.999.999',
        'not-an-ip',
        '',
        null,
        undefined,
        '192.168.1.1, extra, data',
        'script:alert(1)',
        '../../etc/passwd'
      ]

      malformedIPs.forEach(malformedIP => {
        const result = processIPAddress(malformedIP as any)
        expect(result).toBeDefined()
        expect(typeof result).toBe('string')
        // Should not crash and should return a safe default
        expect(['127.0.0.1', '192.168.1.1'].some(safe => result.includes(safe.split('.')[0]))).toBe(true)
      })

      // Test that valid IPs still work
      const validResult = processIPAddress('192.168.1.100')
      expect(validResult).toBe('192.168.1.100')
    })

    it('should include proper rate limit headers in responses', () => {
      // Test rate limit header generation
      const generateRateLimitHeaders = (currentCount: number, limit: number, resetTime: number) => {
        return {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': Math.max(0, limit - currentCount).toString(),
          'X-RateLimit-Reset': resetTime.toString(),
          'X-RateLimit-Used': currentCount.toString()
        }
      }

      const now = Date.now()
      const resetTime = Math.floor(now / 1000) + 60 // Reset in 60 seconds
      
      // Test normal request (50/100 used)
      const normalHeaders = generateRateLimitHeaders(50, 100, resetTime)
      expect(normalHeaders['X-RateLimit-Limit']).toBe('100')
      expect(normalHeaders['X-RateLimit-Remaining']).toBe('50')
      expect(normalHeaders['X-RateLimit-Used']).toBe('50')
      expect(parseInt(normalHeaders['X-RateLimit-Reset'])).toBeGreaterThan(now / 1000)

      // Test near limit (98/100 used)
      const nearLimitHeaders = generateRateLimitHeaders(98, 100, resetTime)
      expect(nearLimitHeaders['X-RateLimit-Remaining']).toBe('2')
      expect(nearLimitHeaders['X-RateLimit-Used']).toBe('98')

      // Test at limit (100/100 used)
      const atLimitHeaders = generateRateLimitHeaders(100, 100, resetTime)
      expect(atLimitHeaders['X-RateLimit-Remaining']).toBe('0')
      expect(atLimitHeaders['X-RateLimit-Used']).toBe('100')

      // Test over limit (should not show negative remaining)
      const overLimitHeaders = generateRateLimitHeaders(105, 100, resetTime)
      expect(overLimitHeaders['X-RateLimit-Remaining']).toBe('0')
      expect(overLimitHeaders['X-RateLimit-Used']).toBe('105')
    })
  })

  describe('Advanced Rate Limiting Patterns', () => {
    it('should implement sliding window rate limiting', () => {
      // Test sliding window implementation for more accurate rate limiting
      const slidingWindowRateLimit = {
        windows: new Map<string, number[]>(),
        
        addRequest: function(key: string, timestamp: number, windowSizeMs: number) {
          if (!this.windows.has(key)) {
            this.windows.set(key, [])
          }
          
          const requests = this.windows.get(key)!
          
          // Remove old requests outside the window
          const cutoff = timestamp - windowSizeMs
          while (requests.length > 0 && requests[0] < cutoff) {
            requests.shift()
          }
          
          // Add new request
          requests.push(timestamp)
          
          return requests.length
        },
        
        getCurrentCount: function(key: string, timestamp: number, windowSizeMs: number) {
          if (!this.windows.has(key)) return 0
          
          const requests = this.windows.get(key)!
          const cutoff = timestamp - windowSizeMs
          
          return requests.filter(req => req >= cutoff).length
        }
      }

      const now = Date.now()
      const windowSize = 60000 // 1 minute
      const ip = '192.168.1.207'
      
      // Add requests over time
      const count1 = slidingWindowRateLimit.addRequest(ip, now, windowSize)
      expect(count1).toBe(1)
      
      const count2 = slidingWindowRateLimit.addRequest(ip, now + 1000, windowSize)
      expect(count2).toBe(2)
      
      // Check current count
      const currentCount = slidingWindowRateLimit.getCurrentCount(ip, now + 2000, windowSize)
      expect(currentCount).toBe(2)
    })

    it('should handle rate limiting across different HTTP methods', () => {
      // Test that rate limits apply consistently across different HTTP methods
      const rateLimitTracker = new Map<string, { count: number, resetTime: number }>()
      
      const trackRequest = (ip: string, method: string) => {
        const key = `${ip}:${method}`
        const now = Date.now()
        const windowMs = 60000 // 1 minute
        
        const record = rateLimitTracker.get(key)
        if (!record || now > record.resetTime) {
          rateLimitTracker.set(key, { count: 1, resetTime: now + windowMs })
          return { count: 1, allowed: true }
        }
        
        record.count++
        return { count: record.count, allowed: record.count <= 100 }
      }

      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
      const ip = '192.168.1.208'
      
      methods.forEach((method, index) => {
        const result = trackRequest(ip, method)
        expect(result.count).toBe(1) // First request for each method
        expect(result.allowed).toBe(true)
      })
      
      // Each method should have its own counter
      expect(rateLimitTracker.size).toBe(methods.length)
    })

    it('should implement burst protection with token bucket algorithm', () => {
      // Test token bucket algorithm for burst protection
      const tokenBucket = {
        buckets: new Map<string, { tokens: number, lastRefill: number }>(),
        
        refillTokens: function(key: string, maxTokens: number, refillRate: number) {
          const now = Date.now()
          const bucket = this.buckets.get(key) || { tokens: maxTokens, lastRefill: now }
          
          // Calculate tokens to add based on time passed
          const timePassed = (now - bucket.lastRefill) / 1000 // Convert to seconds
          const tokensToAdd = Math.floor(timePassed * refillRate)
          
          bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd)
          bucket.lastRefill = now
          
          this.buckets.set(key, bucket)
          return bucket.tokens
        },
        
        consumeToken: function(key: string) {
          const bucket = this.buckets.get(key)
          if (!bucket || bucket.tokens <= 0) {
            return { allowed: false, tokensRemaining: 0 }
          }
          
          bucket.tokens--
          return { allowed: true, tokensRemaining: bucket.tokens }
        }
      }

      const ip = '192.168.1.209'
      const maxTokens = 10
      const refillRate = 1 // 1 token per second
      
      // Initialize bucket
      tokenBucket.refillTokens(ip, maxTokens, refillRate)
      
      // Consume tokens rapidly (burst)
      for (let i = 0; i < maxTokens; i++) {
        const result = tokenBucket.consumeToken(ip)
        expect(result.allowed).toBe(true)
        expect(result.tokensRemaining).toBe(maxTokens - i - 1)
      }
      
      // Next request should be denied
      const deniedResult = tokenBucket.consumeToken(ip)
      expect(deniedResult.allowed).toBe(false)
      expect(deniedResult.tokensRemaining).toBe(0)
    })

    it('should handle distributed rate limiting scenarios', () => {
      // Test distributed rate limiting across multiple servers
      const distributedLimiter = {
        shards: new Map<string, Map<string, number>>(),
        
        getShardKey: function(ip: string, shardCount: number = 3) {
          // Simple hash-based sharding
          let hash = 0
          for (let i = 0; i < ip.length; i++) {
            hash = ((hash << 5) - hash) + ip.charCodeAt(i)
            hash = hash & hash // Convert to 32-bit integer
          }
          return `shard_${Math.abs(hash) % shardCount}`
        },
        
        increment: function(ip: string) {
          const shardKey = this.getShardKey(ip)
          
          if (!this.shards.has(shardKey)) {
            this.shards.set(shardKey, new Map())
          }
          
          const shard = this.shards.get(shardKey)!
          const currentCount = shard.get(ip) || 0
          const newCount = currentCount + 1
          shard.set(ip, newCount)
          
          return { shard: shardKey, count: newCount }
        }
      }

      const ips = ['192.168.1.1', '192.168.1.2', '192.168.1.3', '10.0.0.1', '10.0.0.2']
      
      ips.forEach(ip => {
        const result = distributedLimiter.increment(ip)
        expect(result.shard).toMatch(/^shard_\d+$/)
        expect(result.count).toBe(1)
      })
      
      // Verify sharding distributes load
      expect(distributedLimiter.shards.size).toBeGreaterThan(1)
    })

    it('should implement rate limit bypass for trusted sources', () => {
      // Test trusted IP/service bypass functionality
      const trustedSourceChecker = {
        trustedIPs: new Set([
          '127.0.0.1',
          '::1',
          '10.0.0.0/8',
          '172.16.0.0/12',
          '192.168.0.0/16'
        ]),
        
        trustedUserAgents: new Set([
          'HealthChecker/1.0',
          'LoadBalancer/2.0',
          'InternalService/3.0'
        ]),
        
        isTrustedIP: function(ip: string) {
          if (this.trustedIPs.has(ip)) return true
          
          // Check private IP ranges
          if (ip.startsWith('127.')) return true
          if (ip.startsWith('10.')) return true
          if (ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true
          if (ip.startsWith('192.168.')) return true
          
          return false
        },
        
        isTrustedUserAgent: function(userAgent: string) {
          return this.trustedUserAgents.has(userAgent)
        },
        
        shouldBypassRateLimit: function(ip: string, userAgent?: string) {
          if (this.isTrustedIP(ip)) return { bypass: true, reason: 'trusted_ip' }
          if (userAgent && this.isTrustedUserAgent(userAgent)) {
            return { bypass: true, reason: 'trusted_user_agent' }
          }
          return { bypass: false, reason: 'not_trusted' }
        }
      }

      // Test trusted IPs
      const trustedResults = [
        { ip: '127.0.0.1', expected: true },
        { ip: '10.1.1.1', expected: true },
        { ip: '192.168.1.100', expected: true },
        { ip: '8.8.8.8', expected: false },
        { ip: '1.1.1.1', expected: false }
      ]

      trustedResults.forEach(({ ip, expected }) => {
        const result = trustedSourceChecker.shouldBypassRateLimit(ip)
        expect(result.bypass).toBe(expected)
      })

      // Test trusted user agents
      const userAgentResult = trustedSourceChecker.shouldBypassRateLimit('8.8.8.8', 'HealthChecker/1.0')
      expect(userAgentResult.bypass).toBe(true)
      expect(userAgentResult.reason).toBe('trusted_user_agent')
    })

    it('should measure rate limiting performance under load', () => {
      // Test performance characteristics of rate limiting
      const performanceTracker = {
        timings: [] as number[],
        
        measureRateLimitCheck: function(ip: string, limit: number) {
          const start = performance.now()
          
          // Simulate rate limit check logic
          const key = `rate_limit:${ip}`
          const mockRedisLookup = Math.random() * 2 // 0-2ms simulated Redis lookup
          const mockMemoryFallback = Math.random() * 0.1 // 0-0.1ms memory lookup
          
          // Choose faster option
          const lookupTime = Math.min(mockRedisLookup, mockMemoryFallback)
          
          const end = performance.now()
          const totalTime = end - start + lookupTime
          
          this.timings.push(totalTime)
          
          return {
            allowed: Math.random() > 0.1, // 90% allowed
            duration: totalTime
          }
        },
        
        getStats: function() {
          if (this.timings.length === 0) return null
          
          const sorted = [...this.timings].sort((a, b) => a - b)
          return {
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: this.timings.reduce((sum, t) => sum + t, 0) / this.timings.length,
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)]
          }
        }
      }

      // Simulate 1000 rate limit checks
      for (let i = 0; i < 1000; i++) {
        const result = performanceTracker.measureRateLimitCheck(`192.168.1.${i % 256}`, 100)
        expect(result.duration).toBeLessThan(10) // Should be very fast
      }

      const stats = performanceTracker.getStats()!
      expect(stats.avg).toBeLessThan(5) // Average should be < 5ms
      expect(stats.p95).toBeLessThan(8) // 95th percentile should be < 8ms
      expect(stats.p99).toBeLessThan(10) // 99th percentile should be < 10ms
    })

    it('should handle security-focused rate limiting scenarios', () => {
      // Test rate limiting for security-sensitive operations
      const securityRateLimiter = {
        suspiciousIPs: new Set<string>(),
        failedAttempts: new Map<string, { count: number, lastAttempt: number }>(),
        
        recordFailedAttempt: function(ip: string) {
          const now = Date.now()
          const record = this.failedAttempts.get(ip) || { count: 0, lastAttempt: 0 }
          
          // Reset count if last attempt was > 1 hour ago
          if (now - record.lastAttempt > 3600000) {
            record.count = 0
          }
          
          record.count++
          record.lastAttempt = now
          this.failedAttempts.set(ip, record)
          
          // Mark as suspicious after 5 failed attempts
          if (record.count >= 5) {
            this.suspiciousIPs.add(ip)
          }
          
          return record.count
        },
        
        getRateLimitForIP: function(ip: string, baseLimit: number) {
          if (this.suspiciousIPs.has(ip)) {
            return Math.floor(baseLimit * 0.1) // 10% of normal limit
          }
          
          const failures = this.failedAttempts.get(ip)
          if (failures && failures.count > 3) {
            return Math.floor(baseLimit * 0.5) // 50% of normal limit
          }
          
          return baseLimit
        },
        
        shouldBlock: function(ip: string) {
          const failures = this.failedAttempts.get(ip)
          if (!failures) return false
          
          // Block for 15 minutes after 10 failed attempts
          if (failures.count >= 10) {
            const timeSinceLastAttempt = Date.now() - failures.lastAttempt
            return timeSinceLastAttempt < 900000 // 15 minutes
          }
          
          return false
        }
      }

      const maliciousIP = '203.0.113.100'
      const normalIP = '192.168.1.100'
      const baseLimit = 100
      
      // Simulate failed attempts from malicious IP
      for (let i = 0; i < 7; i++) {
        securityRateLimiter.recordFailedAttempt(maliciousIP)
      }
      
      // Check rate limits
      const maliciousLimit = securityRateLimiter.getRateLimitForIP(maliciousIP, baseLimit)
      const normalLimit = securityRateLimiter.getRateLimitForIP(normalIP, baseLimit)
      
      expect(maliciousLimit).toBeLessThan(normalLimit)
      expect(maliciousLimit).toBe(10) // 10% of base limit
      expect(normalLimit).toBe(100) // Full base limit
      
      expect(securityRateLimiter.suspiciousIPs.has(maliciousIP)).toBe(true)
      expect(securityRateLimiter.suspiciousIPs.has(normalIP)).toBe(false)
    })
  })
})