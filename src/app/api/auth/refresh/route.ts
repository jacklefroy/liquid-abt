// LIQUID ABT - Token Refresh API

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { integratedAuthSecurity } from '@/lib/middleware/authSecurity';
import { createRateLimit } from '@/lib/middleware/rateLimiter';

// Validation schema for token refresh
const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
  deviceFingerprint: z.string().optional()
});

// Rate limiting for refresh attempts
const refreshRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 refresh attempts per window per IP
  keyGenerator: (req: any) => {
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    return `refresh:${ip}`;
  }
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Apply rate limiting
    const rateLimitResult = await refreshRateLimit({
      body,
      headers: Object.fromEntries(request.headers.entries())
    } as any);
    
    if (rateLimitResult.limited) {
      return NextResponse.json(
        { 
          error: 'Too many refresh attempts. Please try again later.',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429 }
      );
    }
    
    // Validate input data
    const validationResult = refreshSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Validation failed', 
          details: validationResult.error.errors 
        },
        { status: 400 }
      );
    }

    const { refreshToken, deviceFingerprint } = validationResult.data;
    
    // Extract request metadata
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Use integrated authentication system to refresh tokens
    const refreshResult = await integratedAuthSecurity.refreshToken(
      refreshToken,
      ipAddress,
      userAgent,
      deviceFingerprint
    );

    if (!refreshResult.success) {
      return NextResponse.json(
        { error: refreshResult.error },
        { status: 401 }
      );
    }

    // Return new token pair
    return NextResponse.json({
      message: 'Token refreshed successfully',
      accessToken: refreshResult.accessToken,
      refreshToken: refreshResult.refreshToken
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: 'Token refresh failed. Please try again.' },
      { status: 500 }
    );
  }
}