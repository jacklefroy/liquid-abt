// LIQUID ABT - User Login API

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getMasterPrisma } from '@/lib/database/connection';
import { integratedAuthSecurity } from '@/lib/middleware/authSecurity';
import { createRateLimit } from '@/lib/middleware/rateLimiter';
import { UserRole } from '@/types/database';

// Validation schema for login
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  subdomain: z.string().optional(), // Optional for subdomain-specific login
  totpToken: z.string().optional(), // Optional 2FA token
  deviceFingerprint: z.string().optional() // Optional device fingerprint
});

// Rate limiting for login attempts
const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  keyGenerator: (req: any) => {
    const body = req.body || {};
    const email = body.email;
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    return `login:${email || ip}`;
  }
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Apply rate limiting
    const rateLimitResult = await loginRateLimit({
      body,
      headers: Object.fromEntries(request.headers.entries())
    } as any);
    
    if (rateLimitResult.limited) {
      return NextResponse.json(
        { 
          error: 'Too many login attempts. Please try again later.',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429 }
      );
    }
    
    // Validate input data
    const validationResult = loginSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Validation failed', 
          details: validationResult.error.errors 
        },
        { status: 400 }
      );
    }

    const { email, password, subdomain, totpToken, deviceFingerprint } = validationResult.data;
    
    // Extract request metadata
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // If subdomain is provided, verify user belongs to that tenant first
    if (subdomain) {
      const prisma = getMasterPrisma();
      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          tenant: {
            select: {
              subdomain: true,
              isActive: true
            }
          }
        }
      });
      
      if (!user || user.tenant.subdomain !== subdomain) {
        return NextResponse.json(
          { error: 'Access denied for this tenant' },
          { status: 403 }
        );
      }
      
      if (!user.tenant.isActive) {
        return NextResponse.json(
          { error: 'Tenant account is suspended. Please contact support.' },
          { status: 401 }
        );
      }
    }

    // Use integrated authentication system
    const authResult = await integratedAuthSecurity.authenticateUser(
      { 
        email, 
        password, 
        totpToken, 
        deviceFingerprint 
      },
      ipAddress,
      userAgent
    );

    if (!authResult.success) {
      // Handle different error types
      if (authResult.requiresMFA) {
        return NextResponse.json(
          { 
            error: authResult.error,
            requiresMFA: true 
          },
          { status: 200 } // Still success, but requires additional step
        );
      }
      
      if (authResult.lockoutStatus) {
        return NextResponse.json(
          { 
            error: authResult.error,
            lockoutStatus: authResult.lockoutStatus
          },
          { status: 423 } // Locked
        );
      }
      
      return NextResponse.json(
        { error: authResult.error },
        { status: 401 }
      );
    }

    // Get user data for response
    const prisma = getMasterPrisma();
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        tenant: {
          select: {
            id: true,
            companyName: true,
            subdomain: true,
            subscriptionTier: true,
            isActive: true
          }
        }
      }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    }

    // Update last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        lastLoginAt: new Date(),
        lastActiveAt: new Date()
      }
    });

    // Return success response with tokens
    return NextResponse.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      tenant: {
        id: user.tenant.id,
        companyName: user.tenant.companyName,
        subdomain: user.tenant.subdomain,
        subscriptionTier: user.tenant.subscriptionTier
      },
      accessToken: authResult.accessToken,
      refreshToken: authResult.refreshToken,
      redirectUrl: `https://${user.tenant.subdomain}.${process.env.MASTER_DOMAIN}/dashboard`
    });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Login failed. Please try again.' },
      { status: 500 }
    );
  }
}

// GET endpoint to get current user info (if already authenticated)
export async function GET(request: NextRequest) {
  try {
    // Use the integrated auth middleware logic
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'No authentication token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    // This would ideally use the middleware, but for API route we'll simulate it
    // In a real implementation, you might want to extract this to a utility function
    const jwtRefreshTokenManager = await import('@/lib/auth/jwtRefreshToken').then(m => m.jwtRefreshTokenManager);
    const sessionTimeoutManager = await import('@/lib/auth/sessionTimeout').then(m => m.sessionTimeoutManager);
    
    // Validate access token using integrated system
    const tokenResult = await jwtRefreshTokenManager.validateAccessToken(token);
    if (!tokenResult.isValid) {
      if (tokenResult.needsRotation) {
        return NextResponse.json(
          { 
            error: 'Token expired',
            requiresRefresh: true 
          },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: tokenResult.error },
        { status: 401 }
      );
    }

    const { payload } = tokenResult;
    
    // Check session timeout
    const sessionStatus = await sessionTimeoutManager.getSessionStatus(payload.sessionId);
    if (!sessionStatus.isActive) {
      return NextResponse.json(
        { 
          error: 'Session expired',
          requiresLogin: true 
        },
        { status: 401 }
      );
    }

    // Update session activity
    await sessionTimeoutManager.updateActivity(payload.sessionId, 'api_call');

    const { userId, tenantId } = payload;
    const prisma = getMasterPrisma();

    // Fetch current user and tenant data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: {
          select: {
            id: true,
            companyName: true,
            subdomain: true,
            subscriptionTier: true,
            isActive: true,
            monthlyVolumeLimit: true,
            dailyVolumeLimit: true,
            maxTransactionLimit: true
          }
        }
      }
    });

    if (!user || !user.isActive || !user.tenant.isActive) {
      return NextResponse.json(
        { error: 'User or tenant not found or inactive' },
        { status: 401 }
      );
    }

    // Update last active timestamp
    await prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() }
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        lastLoginAt: user.lastLoginAt
      },
      tenant: user.tenant,
      sessionStatus: {
        isActive: sessionStatus.isActive,
        timeRemaining: sessionStatus.timeRemaining,
        warningActive: sessionStatus.warningActive
      }
    });

  } catch (error) {
    console.error('Get current user error:', error);
    return NextResponse.json(
      { error: 'Failed to get user information' },
      { status: 500 }
    );
  }
}