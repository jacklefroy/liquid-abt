// LIQUID ABT - Treasury Rules Management API (Mock for Testing)

import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';

// Mock treasury rules for testing
const mockTreasuryRules = [
  {
    id: 'rule_test_1',
    name: 'Demo 5% Conversion Rule',
    type: 'percentage',
    isActive: true,
    configuration: {
      percentage: 5,
      minAmount: 100,
      maxAmount: 10000
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    description: 'Convert 5% of each payment to Bitcoin'
  }
];

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
        { error: 'Invalid token or tenant' },
        { status: 401 }
      );
    }

    console.log(`[Treasury Rules] Fetching rules for ${decoded.user.email} (${decoded.user.firstName} ${decoded.user.lastName})`);

    // Return mock treasury rules
    return NextResponse.json({
      success: true,
      rules: mockTreasuryRules,
      total: mockTreasuryRules.length
    });

  } catch (error) {
    console.error('Treasury rules error:', error);
    
    return NextResponse.json(
      { error: 'Failed to fetch treasury rules' },
      { status: 500 }
    );
  }
}

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

    const body = await request.json();
    const { name, type, configuration, description } = body;

    if (!name || !type || !configuration) {
      return NextResponse.json(
        { error: 'Missing required fields: name, type, configuration' },
        { status: 400 }
      );
    }

    // Create mock treasury rule
    const newRule = {
      id: 'rule_test_' + Math.random().toString(36).substr(2, 9),
      name,
      type,
      isActive: true,
      configuration,
      description: description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log(`[Treasury Rules] Created new rule for ${decoded.user.email}: ${name}`);

    // In production, this would be saved to the database
    return NextResponse.json({
      success: true,
      rule: newRule,
      message: 'Treasury rule created successfully'
    });

  } catch (error) {
    console.error('Treasury rule creation error:', error);
    
    return NextResponse.json(
      { error: 'Failed to create treasury rule' },
      { status: 500 }
    );
  }
}