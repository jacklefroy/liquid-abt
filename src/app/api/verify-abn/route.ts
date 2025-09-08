// LIQUID ABT - ABN Verification API Endpoint
// Validates Australian Business Numbers using Australian Business Register

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Validation schema for ABN verification request
const abnVerificationSchema = z.object({
  abn: z.string()
    .min(11, 'ABN must be 11 digits')
    .max(11, 'ABN must be 11 digits')
    .regex(/^\d{11}$/, 'ABN must contain only digits')
});

interface ABNVerificationResult {
  valid: boolean;
  data?: {
    abn: string;
    entityName: string;
    entityType: string;
    gstRegistered: boolean;
    tradingNames: string[];
    status: 'Active' | 'Cancelled';
    lastUpdated: string;
  };
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate input
    const validationResult = abnVerificationSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Invalid ABN format', 
          details: validationResult.error.errors 
        },
        { status: 400 }
      );
    }

    const { abn } = validationResult.data;

    // Verify ABN using Australian Business Register API
    const verificationResult = await verifyABNWithABR(abn);

    return NextResponse.json(verificationResult);

  } catch (error) {
    console.error('ABN verification error:', error);
    return NextResponse.json(
      { error: 'ABN verification failed. Please try again.' },
      { status: 500 }
    );
  }
}

/**
 * Verify ABN with Australian Business Register (ABR) API
 */
async function verifyABNWithABR(abn: string): Promise<ABNVerificationResult> {
  const abrApiKey = process.env.ABR_API_KEY;
  
  // If no API key is configured, use mock verification for testing
  if (!abrApiKey || process.env.NODE_ENV === 'test') {
    return mockABNVerification(abn);
  }

  try {
    // ABR API endpoint for ABN verification
    const abrUrl = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${abn}&callback=&guid=${abrApiKey}`;
    
    const response = await fetch(abrUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'LIQUID-ABT/1.0',
        'Accept': 'application/json'
      },
      // 10 second timeout for ABR API
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`ABR API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.text();
    
    // ABR returns JSONP, extract JSON
    const jsonMatch = data.match(/\{.*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid response format from ABR API');
    }

    const abnData = JSON.parse(jsonMatch[0]);

    // Parse ABR response
    if (!abnData.Abn || abnData.Abn.length === 0) {
      return {
        valid: false,
        error: 'ABN not found or inactive'
      };
    }

    const abnDetails = abnData.Abn[0];
    const entityName = abnDetails.EntityName || 'Unknown';
    const entityType = abnDetails.EntityType || 'Unknown';
    
    // Check GST registration
    const gstRegistered = abnDetails.Gst && abnDetails.Gst.length > 0;
    
    // Extract trading names
    const tradingNames = abnDetails.BusinessName || [];
    
    return {
      valid: true,
      data: {
        abn: abn,
        entityName: entityName,
        entityType: entityType,
        gstRegistered: gstRegistered,
        tradingNames: tradingNames.map((name: any) => name.OrganisationName || ''),
        status: abnDetails.AbnStatus === '1' ? 'Active' : 'Cancelled',
        lastUpdated: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('ABR API call failed:', error);
    
    // Fallback to basic ABN checksum validation
    const checksumValid = validateABNChecksum(abn);
    
    if (checksumValid) {
      return {
        valid: true,
        data: {
          abn: abn,
          entityName: 'Business entity (details unavailable)',
          entityType: 'Unknown',
          gstRegistered: false,
          tradingNames: [],
          status: 'Active',
          lastUpdated: new Date().toISOString()
        }
      };
    } else {
      return {
        valid: false,
        error: 'Invalid ABN checksum'
      };
    }
  }
}

/**
 * Mock ABN verification for testing and development
 */
function mockABNVerification(abn: string): ABNVerificationResult {
  // Validate checksum first
  if (!validateABNChecksum(abn)) {
    return {
      valid: false,
      error: 'Invalid ABN checksum'
    };
  }

  // Mock valid ABNs for testing
  const mockBusinesses: Record<string, any> = {
    '53004085616': {
      entityName: 'AUSTRALIAN TAXATION OFFICE',
      entityType: 'Government Entity',
      gstRegistered: true,
      tradingNames: ['ATO'],
      status: 'Active'
    },
    '12345678901': {
      entityName: 'TEST BUSINESS PTY LTD',
      entityType: 'Australian Private Company',
      gstRegistered: true,
      tradingNames: ['Test Trading Co', 'Testing Solutions'],
      status: 'Active'
    },
    '99999999999': {
      entityName: 'INVALID BUSINESS',
      entityType: 'Unknown',
      gstRegistered: false,
      tradingNames: [],
      status: 'Cancelled'
    }
  };

  const mockData = mockBusinesses[abn];
  
  if (mockData && mockData.status === 'Active') {
    return {
      valid: true,
      data: {
        abn: abn,
        entityName: mockData.entityName,
        entityType: mockData.entityType,
        gstRegistered: mockData.gstRegistered,
        tradingNames: mockData.tradingNames,
        status: mockData.status,
        lastUpdated: new Date().toISOString()
      }
    };
  }

  return {
    valid: false,
    error: mockData ? 'Business is not active' : 'ABN not found'
  };
}

/**
 * Validate ABN checksum using the official algorithm
 */
function validateABNChecksum(abn: string): boolean {
  if (!/^\d{11}$/.test(abn)) {
    return false;
  }

  // ABN checksum validation weights
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  
  // Subtract 1 from the first digit
  const digits = abn.split('').map(Number);
  digits[0] -= 1;
  
  // Calculate weighted sum
  const sum = digits.reduce((total, digit, index) => total + (digit * weights[index]), 0);
  
  // ABN is valid if sum is divisible by 89
  return sum % 89 === 0;
}

// GET endpoint to check if ABR API is available
export async function GET() {
  try {
    const hasApiKey = !!process.env.ABR_API_KEY;
    const isProduction = process.env.NODE_ENV === 'production';
    
    return NextResponse.json({
      available: hasApiKey,
      mode: hasApiKey ? 'live' : 'mock',
      message: hasApiKey 
        ? 'ABR API integration active'
        : 'Using mock verification for development'
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Service check failed' },
      { status: 500 }
    );
  }
}