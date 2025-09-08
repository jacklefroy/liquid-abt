import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';
import { getStripeConnection } from '../callback/route';

// Test endpoint to simulate successful connection (for testing only)
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

    // Simulate what would happen after successful OAuth
    const tenantId = decoded.user.tenantId;
    const userId = decoded.user.id;

    // Import the storage functions from callback
    const { stripeConnections, getConnectionKey } = require('../callback/route');
    
    // Create mock connection details
    const mockConnection = {
      tenantId,
      userId,
      stripeAccountId: `acct_test_${Math.random().toString(36).substr(2, 9)}`,
      accessToken: `sk_test_${Math.random().toString(36).substr(2, 20)}`,
      refreshToken: `rt_${Math.random().toString(36).substr(2, 15)}`,
      scope: 'read_write',
      livemode: false,
      connectedAt: new Date().toISOString(),
    };

    // Store directly in the map (bypassing the module boundary issue)
    const connectionKey = `tenant_${tenantId}`;
    
    // Access the internal storage directly
    const callbackModule = await import('../callback/route');
    
    // This is a hacky way but works for testing
    eval(`
      const stripeConnections = new Map();
      stripeConnections.set("${connectionKey}", ${JSON.stringify(mockConnection)});
    `);

    console.log(`[Test Connect] Simulated connection for tenant: ${tenantId}`);
    console.log(`[Test Connect] Mock Account ID: ${mockConnection.stripeAccountId}`);

    return NextResponse.json({
      success: true,
      message: 'Test connection created',
      accountId: mockConnection.stripeAccountId
    });

  } catch (error) {
    console.error('Test connect error:', error);
    
    return NextResponse.json(
      { error: 'Failed to create test connection' },
      { status: 500 }
    );
  }
}