// LIQUID ABT - Automatic Session Timeout Management
// Implementation of threat model automatic session timeout requirements

import { createRedisCache } from '../cache/redisClient';

export interface SessionConfig {
  maxIdleTimeMs: number; // Maximum idle time before timeout
  absoluteTimeoutMs: number; // Maximum session duration regardless of activity
  warningTimeMs: number; // Time before timeout to show warning
  extendOnActivity: boolean; // Whether to extend session on user activity
}

export interface SessionStatus {
  isActive: boolean;
  remainingIdleTime?: number;
  remainingAbsoluteTime?: number;
  lastActivity?: Date;
  sessionStart?: Date;
  needsWarning?: boolean;
}

export class SessionTimeoutManager {
  private redis = createRedisCache();
  
  // Threat model requirements - financial platform security
  private readonly DEFAULT_CONFIG: SessionConfig = {
    maxIdleTimeMs: 30 * 60 * 1000, // 30 minutes idle timeout
    absoluteTimeoutMs: 8 * 60 * 60 * 1000, // 8 hours absolute maximum
    warningTimeMs: 5 * 60 * 1000, // 5 minutes warning before timeout
    extendOnActivity: true
  };

  private readonly SESSION_PREFIX = 'session_timeout';
  private readonly ACTIVITY_PREFIX = 'session_activity';

  constructor(private config: Partial<SessionConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize session timeout tracking
   */
  async initializeSession(
    sessionId: string,
    userId: string,
    tenantId: string,
    customConfig?: Partial<SessionConfig>
  ): Promise<void> {
    const sessionConfig = { ...this.config, ...customConfig };
    const now = Date.now();

    const sessionData = {
      userId,
      tenantId,
      sessionStart: now,
      lastActivity: now,
      config: sessionConfig
    };

    // Store session with absolute timeout TTL
    const sessionKey = `${this.SESSION_PREFIX}:${sessionId}`;
    await this.redis.setex(
      sessionKey, 
      Math.floor(sessionConfig.absoluteTimeoutMs! / 1000), 
      JSON.stringify(sessionData)
    );

    console.log('Session timeout initialized:', {
      sessionId,
      userId,
      tenantId,
      maxIdleMinutes: sessionConfig.maxIdleTimeMs! / 60000,
      absoluteHours: sessionConfig.absoluteTimeoutMs! / 3600000
    });
  }

  /**
   * Update session activity (reset idle timer)
   */
  async updateActivity(
    sessionId: string,
    activityType: 'api_call' | 'page_view' | 'user_action' = 'user_action'
  ): Promise<SessionStatus> {
    const sessionKey = `${this.SESSION_PREFIX}:${sessionId}`;
    const sessionDataStr = await this.redis.get(sessionKey);

    if (!sessionDataStr) {
      return { isActive: false };
    }

    try {
      const sessionData = JSON.parse(sessionDataStr);
      const now = Date.now();

      // Update last activity if extension is enabled
      if (sessionData.config.extendOnActivity) {
        sessionData.lastActivity = now;

        // Extend session TTL up to absolute timeout
        const sessionAge = now - sessionData.sessionStart;
        const remainingAbsolute = sessionData.config.absoluteTimeoutMs - sessionAge;
        
        if (remainingAbsolute > 0) {
          const newTTL = Math.min(
            sessionData.config.maxIdleTimeMs,
            remainingAbsolute
          );
          
          await this.redis.setex(
            sessionKey,
            Math.floor(newTTL / 1000),
            JSON.stringify(sessionData)
          );
        }
      }

      // Log activity for security monitoring
      await this.logActivity(sessionId, sessionData.userId, activityType);

      return this.getSessionStatus(sessionId);

    } catch (error) {
      console.error('Failed to update session activity:', error);
      return { isActive: false };
    }
  }

  /**
   * Get current session status
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    const sessionKey = `${this.SESSION_PREFIX}:${sessionId}`;
    const sessionDataStr = await this.redis.get(sessionKey);

    if (!sessionDataStr) {
      return { isActive: false };
    }

    try {
      const sessionData = JSON.parse(sessionDataStr);
      const now = Date.now();

      const sessionAge = now - sessionData.sessionStart;
      const idleTime = now - sessionData.lastActivity;

      // Check if session has exceeded limits
      const isIdleExpired = idleTime > sessionData.config.maxIdleTimeMs;
      const isAbsoluteExpired = sessionAge > sessionData.config.absoluteTimeoutMs;

      if (isIdleExpired || isAbsoluteExpired) {
        await this.expireSession(sessionId, isIdleExpired ? 'idle_timeout' : 'absolute_timeout');
        return { isActive: false };
      }

      const remainingIdleTime = sessionData.config.maxIdleTimeMs - idleTime;
      const remainingAbsoluteTime = sessionData.config.absoluteTimeoutMs - sessionAge;
      const needsWarning = Math.min(remainingIdleTime, remainingAbsoluteTime) <= sessionData.config.warningTimeMs;

      return {
        isActive: true,
        remainingIdleTime,
        remainingAbsoluteTime,
        lastActivity: new Date(sessionData.lastActivity),
        sessionStart: new Date(sessionData.sessionStart),
        needsWarning
      };

    } catch (error) {
      console.error('Failed to get session status:', error);
      return { isActive: false };
    }
  }

  /**
   * Manually expire a session
   */
  async expireSession(sessionId: string, reason: string = 'manual_logout'): Promise<void> {
    const sessionKey = `${this.SESSION_PREFIX}:${sessionId}`;
    const sessionDataStr = await this.redis.get(sessionKey);

    if (sessionDataStr) {
      try {
        const sessionData = JSON.parse(sessionDataStr);
        
        console.log('Session expired:', {
          sessionId,
          userId: sessionData.userId,
          tenantId: sessionData.tenantId,
          reason,
          sessionDuration: Date.now() - sessionData.sessionStart
        });
      } catch (error) {
        console.error('Error logging session expiry:', error);
      }
    }

    // Remove session data
    await this.redis.del(sessionKey);
    await this.redis.del(`${this.ACTIVITY_PREFIX}:${sessionId}`);
  }

  /**
   * Extend session timeout (for premium users or special cases)
   */
  async extendSession(
    sessionId: string,
    extensionMs: number,
    reason: string = 'manual_extension'
  ): Promise<SessionStatus> {
    const sessionKey = `${this.SESSION_PREFIX}:${sessionId}`;
    const sessionDataStr = await this.redis.get(sessionKey);

    if (!sessionDataStr) {
      return { isActive: false };
    }

    try {
      const sessionData = JSON.parse(sessionDataStr);
      const now = Date.now();

      // Extend absolute timeout
      sessionData.config.absoluteTimeoutMs += extensionMs;
      
      // Update TTL
      const sessionAge = now - sessionData.sessionStart;
      const remainingTime = sessionData.config.absoluteTimeoutMs - sessionAge;
      
      await this.redis.setex(
        sessionKey,
        Math.floor(remainingTime / 1000),
        JSON.stringify(sessionData)
      );

      console.log('Session extended:', {
        sessionId,
        extensionMinutes: extensionMs / 60000,
        reason
      });

      return this.getSessionStatus(sessionId);

    } catch (error) {
      console.error('Failed to extend session:', error);
      return { isActive: false };
    }
  }

  /**
   * Get all active sessions for a user (for security monitoring)
   */
  async getUserActiveSessions(userId: string): Promise<Array<{
    sessionId: string;
    sessionStart: Date;
    lastActivity: Date;
    remainingTime: number;
  }>> {
    // This requires scanning Redis keys - in production, consider maintaining
    // a separate index of user sessions for better performance
    
    // For now, return empty array as this would require Redis SCAN operations
    // which could be expensive. In production, implement with proper indexing.
    
    return [];
  }

  /**
   * Terminate all sessions for a user (security action)
   */
  async terminateAllUserSessions(
    userId: string, 
    reason: string = 'security_action'
  ): Promise<number> {
    // This would require finding all sessions for the user
    // In production, implement with proper session indexing
    
    console.log('All user sessions termination requested:', {
      userId,
      reason
    });
    
    // Return 0 for now - implement with proper session management
    return 0;
  }

  /**
   * Log session activity for security monitoring
   */
  private async logActivity(
    sessionId: string,
    userId: string,
    activityType: string
  ): Promise<void> {
    const activityKey = `${this.ACTIVITY_PREFIX}:${sessionId}`;
    const now = Date.now();
    
    const activity = {
      timestamp: now,
      activityType,
      userId
    };

    // Keep last 50 activities with 1-hour TTL
    try {
      const existingActivities = await this.redis.get(activityKey);
      let activities = existingActivities ? JSON.parse(existingActivities) : [];
      
      activities.push(activity);
      activities = activities.slice(-50); // Keep only last 50
      
      await this.redis.setex(activityKey, 3600, JSON.stringify(activities));
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  /**
   * Get session configuration
   */
  getConfig(): SessionConfig {
    return { ...this.DEFAULT_CONFIG, ...this.config };
  }

  /**
   * Update session configuration
   */
  updateConfig(newConfig: Partial<SessionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Clean up expired sessions (maintenance task)
   */
  async cleanupExpiredSessions(): Promise<number> {
    // This would scan for and remove expired sessions
    // In production, implement with proper cleanup logic
    
    console.log('Session cleanup requested');
    return 0;
  }
}

// Export singleton instance
export const sessionTimeoutManager = new SessionTimeoutManager();

// Export function to create instance with custom config
export function createSessionTimeoutManager(config: Partial<SessionConfig>): SessionTimeoutManager {
  return new SessionTimeoutManager(config);
}