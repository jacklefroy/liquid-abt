// LIQUID ABT - User Logout API

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { integratedAuthSecurity } from '@/lib/middleware/authSecurity';
import { jwtRefreshTokenManager } from '@/lib/auth/jwtRefreshToken';

// Validation schema for logout
const logoutSchema = z.object({
  refreshToken: z.string().optional(), // Optional - can logout with just access token
  logoutAll: z.boolean().optional().default(false) // Logout from all devices
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate input data
    const validationResult = logoutSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Validation failed', 
          details: validationResult.error.errors 
        },
        { status: 400 }
      );
    }

    const { refreshToken, logoutAll } = validationResult.data;
    
    // Extract access token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'No authentication token provided' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.substring(7);
    
    // Validate access token to get session info
    const tokenResult = await jwtRefreshTokenManager.validateAccessToken(accessToken);
    if (!tokenResult.isValid) {
      return NextResponse.json(
        { error: 'Invalid access token' },
        { status: 401 }
      );
    }

    const { payload } = tokenResult;
    const { sessionId, userId, tenantId } = payload;

    if (logoutAll) {
      // Logout from all devices/sessions
      await integratedAuthSecurity.revokeAllUserSessions(
        userId,
        tenantId,
        'user_logout_all'
      );
      
      return NextResponse.json({
        message: 'Successfully logged out from all devices'
      });
    } else {
      // Standard logout - just this session
      await integratedAuthSecurity.logout(
        accessToken,
        refreshToken || '',
        sessionId,
        'user_logout'
      );
      
      return NextResponse.json({
        message: 'Successfully logged out'
      });
    }

  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Logout failed. Please try again.' },
      { status: 500 }
    );
  }
}

// GET endpoint to logout (for simple logout links)
export async function GET(request: NextRequest) {
  try {
    // Extract access token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'No authentication token provided' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.substring(7);
    
    // Validate access token to get session info
    const tokenResult = await jwtRefreshTokenManager.validateAccessToken(accessToken);
    if (!tokenResult.isValid) {
      return NextResponse.json(
        { error: 'Invalid access token' },
        { status: 401 }
      );
    }

    const { payload } = tokenResult;
    const { sessionId } = payload;

    // Simple logout with just access token
    await integratedAuthSecurity.logout(
      accessToken,
      '',
      sessionId,
      'user_logout_get'
    );
    
    return NextResponse.json({
      message: 'Successfully logged out'
    });

  } catch (error) {
    console.error('GET Logout error:', error);
    return NextResponse.json(
      { error: 'Logout failed. Please try again.' },
      { status: 500 }
    );
  }
}