import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';
import { setConnection, getConnection, deleteConnection, listConnections } from '@/lib/stripe-storage';

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

    const tenantId = decoded.user.tenantId;
    const userId = decoded.user.id;

    // Create a test connection
    const testConnection = {
      tenantId,
      userId,
      stripeAccountId: `acct_test_${Math.random().toString(36).substr(2, 9)}`,
      accessToken: `sk_test_${Math.random().toString(36).substr(2, 20)}`,
      refreshToken: `rt_${Math.random().toString(36).substr(2, 15)}`,
      scope: 'read_write',
      livemode: false,
      connectedAt: new Date().toISOString(),
    };

    // Store it using shared storage
    setConnection(tenantId, testConnection);

    return NextResponse.json({
      success: true,
      message: 'Test connection created using shared storage',
      accountId: testConnection.stripeAccountId,
      totalConnections: listConnections().length
    });

  } catch (error) {
    console.error('Test storage error:', error);
    
    return NextResponse.json(
      { error: 'Failed to test storage' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Get action parameter from URL
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    
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

    // Handle clear all connections action
    if (action === 'clear') {
      const { clearAllConnections } = await import('@/lib/stripe-storage');
      clearAllConnections();
      
      return NextResponse.json({
        success: true,
        message: 'All connections cleared successfully',
        remainingConnections: 0
      });
    }

    // Default action: delete connection for this tenant
    const tenantId = decoded.user.tenantId;
    const deleted = deleteConnection(tenantId);

    return NextResponse.json({
      success: true,
      deleted,
      message: deleted ? 'Test connection deleted' : 'No connection found to delete',
      remainingConnections: listConnections().length
    });

  } catch (error) {
    console.error('Test storage delete error:', error);
    
    return NextResponse.json(
      { error: 'Failed to delete test connection' },
      { status: 500 }
    );
  }
}