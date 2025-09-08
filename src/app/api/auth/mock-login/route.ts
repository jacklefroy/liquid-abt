import { NextRequest, NextResponse } from 'next/server';
import { sign } from 'jsonwebtoken';

// Mock test user data - generates unique tenant per email
function generateMockUser(email: string) {
  const emailHash = email.replace(/[@\.]/g, '_').toLowerCase();
  const tenantId = `tenant_${emailHash}_123`;
  
  return {
    user: {
      id: `user_${emailHash}_123`,
      email: email,
      firstName: 'Demo',
      lastName: 'User',
      role: 'owner',
      tenantId: tenantId
    },
    tenant: {
      id: tenantId,
      companyName: `${email} Company Ltd`,
      subscriptionTier: 'pro',
      schemaName: `tenant_${emailHash}`
    }
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Accept any credentials for demo purposes
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password required' },
        { status: 400 }
      );
    }

    // Generate unique mock data for this email
    const mockData = generateMockUser(email);
    
    // Generate mock JWT token
    const jwtSecret = process.env.JWT_SECRET || 'local-dev-secret-at-least-32-chars-change-in-production';
    
    const tokenPayload = {
      user: mockData.user,
      tenantId: mockData.user.tenantId,
      tenant: mockData.tenant,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (8 * 60 * 60) // 8 hours
    };

    const token = sign(tokenPayload, jwtSecret);

    console.log(`[Mock Login] User ${email} logged in as ${mockData.user.firstName} ${mockData.user.lastName}`);
    console.log(`[Mock Login] Tenant: ${mockData.tenant.companyName} (${mockData.tenant.subscriptionTier})`);

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: mockData.user.id,
        email: mockData.user.email,
        firstName: mockData.user.firstName,
        lastName: mockData.user.lastName,
        role: mockData.user.role,
        tenantId: mockData.user.tenantId
      },
      tenant: {
        id: mockData.tenant.id,
        companyName: mockData.tenant.companyName,
        subscriptionTier: mockData.tenant.subscriptionTier
      }
    });

  } catch (error) {
    console.error('Mock login error:', error);
    
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}