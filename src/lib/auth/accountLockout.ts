// LIQUID ABT - Account Lockout Security System
// Implementation of threat model account lockout requirements

import { createRedisCache } from '../cache/redisClient';

export interface LockoutAttempt {
  identifier: string; // email or IP address
  timestamp: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface LockoutStatus {
  isLocked: boolean;
  remainingTime?: number; // milliseconds until unlock
  attemptCount: number;
  lastAttemptAt?: Date;
  lockoutExpiresAt?: Date;
}

export class AccountLockoutManager {
  private redis = createRedisCache();
  
  // Threat model requirements
  private readonly MAX_ATTEMPTS = 5; // 5 failed attempts before lockout
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  private readonly ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5-minute sliding window
  private readonly PROGRESSIVE_LOCKOUT = true; // Exponential backoff
  
  private readonly REDIS_PREFIX = 'auth_lockout';
  private readonly ATTEMPT_PREFIX = 'auth_attempts';

  /**
   * Record a failed login attempt
   */
  async recordFailedAttempt(attempt: LockoutAttempt): Promise<LockoutStatus> {
    const { identifier } = attempt;
    const now = Date.now();
    
    // Get current lockout status
    const currentStatus = await this.getLockoutStatus(identifier);
    
    // If already locked, extend lockout time (progressive lockout)
    if (currentStatus.isLocked) {
      if (this.PROGRESSIVE_LOCKOUT) {
        const newLockoutDuration = Math.min(
          this.LOCKOUT_DURATION_MS * Math.pow(2, Math.floor(currentStatus.attemptCount / this.MAX_ATTEMPTS)),
          4 * 60 * 60 * 1000 // Maximum 4 hours
        );
        
        const lockoutKey = `${this.REDIS_PREFIX}:${identifier}`;
        await this.redis.setex(lockoutKey, Math.floor(newLockoutDuration / 1000), JSON.stringify({
          lockedAt: now,
          attemptCount: currentStatus.attemptCount + 1,
          reason: 'repeated_failed_attempts'
        }));
        
        console.warn('Progressive lockout extended:', {
          identifier: this.maskIdentifier(identifier),
          attemptCount: currentStatus.attemptCount + 1,
          lockoutDurationMs: newLockoutDuration,
          ipAddress: attempt.ipAddress
        });
      }
      
      return this.getLockoutStatus(identifier);
    }

    // Store the failed attempt with timestamp
    const attemptKey = `${this.ATTEMPT_PREFIX}:${identifier}`;
    const attempts = await this.getRecentAttempts(identifier);
    
    attempts.push({
      timestamp: new Date(now),
      userAgent: attempt.userAgent,
      ipAddress: attempt.ipAddress
    });

    // Store attempts with TTL
    await this.redis.setex(
      attemptKey, 
      Math.floor(this.ATTEMPT_WINDOW_MS / 1000), 
      JSON.stringify(attempts)
    );

    // Check if lockout threshold reached
    if (attempts.length >= this.MAX_ATTEMPTS) {
      await this.lockAccount(identifier, attempts.length);
      
      console.warn('Account locked due to failed attempts:', {
        identifier: this.maskIdentifier(identifier),
        attemptCount: attempts.length,
        lockoutDurationMs: this.LOCKOUT_DURATION_MS,
        ipAddress: attempt.ipAddress,
        userAgent: attempt.userAgent
      });
    }

    return this.getLockoutStatus(identifier);
  }

  /**
   * Record a successful login (clears attempt counter)
   */
  async recordSuccessfulLogin(identifier: string): Promise<void> {
    const attemptKey = `${this.ATTEMPT_PREFIX}:${identifier}`;
    const lockoutKey = `${this.REDIS_PREFIX}:${identifier}`;
    
    // Clear both attempt history and any lockout
    await Promise.all([
      this.redis.del(attemptKey),
      this.redis.del(lockoutKey)
    ]);

    console.log('Successful login, cleared lockout:', {
      identifier: this.maskIdentifier(identifier)
    });
  }

  /**
   * Get current lockout status for an identifier
   */
  async getLockoutStatus(identifier: string): Promise<LockoutStatus> {
    const lockoutKey = `${this.REDIS_PREFIX}:${identifier}`;
    const attemptKey = `${this.ATTEMPT_PREFIX}:${identifier}`;
    
    const [lockoutData, attempts] = await Promise.all([
      this.redis.get(lockoutKey),
      this.getRecentAttempts(identifier)
    ]);

    if (lockoutData) {
      const lockout = JSON.parse(lockoutData);
      const lockoutExpiresAt = new Date(lockout.lockedAt + this.LOCKOUT_DURATION_MS);
      const remainingTime = Math.max(0, lockoutExpiresAt.getTime() - Date.now());
      
      return {
        isLocked: remainingTime > 0,
        remainingTime,
        attemptCount: lockout.attemptCount || attempts.length,
        lastAttemptAt: attempts.length > 0 ? attempts[attempts.length - 1].timestamp : undefined,
        lockoutExpiresAt
      };
    }

    return {
      isLocked: false,
      attemptCount: attempts.length,
      lastAttemptAt: attempts.length > 0 ? attempts[attempts.length - 1].timestamp : undefined
    };
  }

  /**
   * Check if account is currently locked
   */
  async isAccountLocked(identifier: string): Promise<boolean> {
    const status = await this.getLockoutStatus(identifier);
    return status.isLocked;
  }

  /**
   * Manually unlock an account (admin function)
   */
  async unlockAccount(identifier: string, reason: string = 'manual_unlock'): Promise<void> {
    const lockoutKey = `${this.REDIS_PREFIX}:${identifier}`;
    const attemptKey = `${this.ATTEMPT_PREFIX}:${identifier}`;
    
    await Promise.all([
      this.redis.del(lockoutKey),
      this.redis.del(attemptKey)
    ]);

    console.log('Account manually unlocked:', {
      identifier: this.maskIdentifier(identifier),
      reason
    });
  }

  /**
   * Get lockout statistics for monitoring
   */
  async getLockoutStatistics(timeRangeHours: number = 24): Promise<{
    totalLockouts: number;
    activeLockouts: number;
    topLockedIdentifiers: Array<{ identifier: string; attemptCount: number }>;
  }> {
    // This would require scanning Redis keys or maintaining separate counters
    // For now, return basic structure for interface compatibility
    
    // TODO: Implement comprehensive statistics collection
    // This would typically use Redis SCAN to find all lockout keys
    // and aggregate statistics
    
    return {
      totalLockouts: 0,
      activeLockouts: 0,
      topLockedIdentifiers: []
    };
  }

  /**
   * Set up IP-based rate limiting (separate from user-based lockouts)
   */
  async recordIPAttempt(ipAddress: string, identifier?: string): Promise<LockoutStatus> {
    return this.recordFailedAttempt({
      identifier: `ip:${ipAddress}`,
      timestamp: new Date(),
      ipAddress,
      userAgent: undefined
    });
  }

  /**
   * Check if IP address is locked out
   */
  async isIPLocked(ipAddress: string): Promise<boolean> {
    return this.isAccountLocked(`ip:${ipAddress}`);
  }

  /**
   * Get recent failed attempts for an identifier
   */
  private async getRecentAttempts(identifier: string): Promise<LockoutAttempt[]> {
    const attemptKey = `${this.ATTEMPT_PREFIX}:${identifier}`;
    const attemptsData = await this.redis.get(attemptKey);
    
    if (!attemptsData) {
      return [];
    }

    try {
      const attempts = JSON.parse(attemptsData);
      const cutoff = Date.now() - this.ATTEMPT_WINDOW_MS;
      
      // Filter to only recent attempts within the sliding window
      return attempts
        .filter((attempt: any) => new Date(attempt.timestamp).getTime() > cutoff)
        .map((attempt: any) => ({
          identifier,
          timestamp: new Date(attempt.timestamp),
          userAgent: attempt.userAgent,
          ipAddress: attempt.ipAddress
        }));
    } catch (error) {
      console.error('Error parsing attempt data:', error);
      return [];
    }
  }

  /**
   * Lock an account
   */
  private async lockAccount(identifier: string, attemptCount: number): Promise<void> {
    const lockoutKey = `${this.REDIS_PREFIX}:${identifier}`;
    const now = Date.now();
    
    const lockoutDuration = this.PROGRESSIVE_LOCKOUT 
      ? Math.min(
          this.LOCKOUT_DURATION_MS * Math.pow(1.5, Math.floor(attemptCount / this.MAX_ATTEMPTS)),
          4 * 60 * 60 * 1000 // Maximum 4 hours
        )
      : this.LOCKOUT_DURATION_MS;

    await this.redis.setex(lockoutKey, Math.floor(lockoutDuration / 1000), JSON.stringify({
      lockedAt: now,
      attemptCount,
      reason: 'max_attempts_exceeded'
    }));
  }

  /**
   * Mask sensitive identifiers for logging
   */
  private maskIdentifier(identifier: string): string {
    if (identifier.startsWith('ip:')) {
      const ip = identifier.substring(3);
      const parts = ip.split('.');
      if (parts.length === 4) {
        return `ip:${parts[0]}.${parts[1]}.xxx.xxx`;
      }
    }
    
    if (identifier.includes('@')) {
      const [local, domain] = identifier.split('@');
      return `${local.substring(0, 2)}***@${domain}`;
    }
    
    return identifier.substring(0, 3) + '***';
  }
}

// Export singleton instance
export const accountLockoutManager = new AccountLockoutManager();