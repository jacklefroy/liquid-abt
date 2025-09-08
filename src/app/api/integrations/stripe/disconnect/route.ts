import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';
import { deleteConnection } from '@/lib/stripe-storage';

export async function POST(request: NextRequest) {
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
        { error: 'Invalid token or tenant' },
        { status: 401 }
      );
    }

    // Disconnect Stripe for this tenant
    const tenantId = decoded.user.tenantId;
    const disconnected = deleteConnection(tenantId);

    console.log(`[Stripe Disconnect] Tenant ${tenantId} disconnected: ${disconnected}`);

    return NextResponse.json({
      success: true,
      message: disconnected ? 'Stripe account disconnected successfully' : 'No connection found to disconnect'
    });

  } catch (error) {
    console.error('Stripe disconnect error:', error);
    
    return NextResponse.json(
      { error: 'Failed to disconnect Stripe account' },
      { status: 500 }
    );
  }
}