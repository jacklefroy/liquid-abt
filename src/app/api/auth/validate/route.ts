import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';

export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Access token required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET || 'local-dev-secret-at-least-32-chars-change-in-production';
    
    // Verify and decode the JWT token
    const decoded = verify(token, jwtSecret) as any;
    
    if (!decoded.user) {
      return NextResponse.json(
        { error: 'Invalid token payload' },
        { status: 401 }
      );
    }

    // Return user data if authenticated
    return NextResponse.json({
      success: true,
      user: {
        id: decoded.user.id,
        email: decoded.user.email,
        firstName: decoded.user.firstName,
        lastName: decoded.user.lastName,
        role: decoded.user.role,
        tenantId: decoded.user.tenantId
      }
    });

  } catch (error) {
    console.error('Auth validation error:', error);
    
    return NextResponse.json(
      { error: 'Authentication validation failed' },
      { status: 401 }
    );
  }
}