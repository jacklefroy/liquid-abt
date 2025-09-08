// LIQUID ABT - Bitcoin Address Validation Endpoint
// Validate Bitcoin wallet addresses for onboarding

import { NextRequest, NextResponse } from 'next/server';
import { validate } from 'bitcoin-address-validation';

export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();
    
    if (!address || typeof address !== 'string') {
      return NextResponse.json(
        { error: 'Invalid address parameter' },
        { status: 400 }
      );
    }

    // Validate the Bitcoin address using the validation library
    const isValid = validate(address);
    
    // Additional format detection
    let addressType = 'unknown';
    if (isValid) {
      if (address.startsWith('bc1') || address.startsWith('tb1')) {
        addressType = 'bech32'; // Native SegWit
      } else if (address.startsWith('3') || address.startsWith('2')) {
        addressType = 'p2sh'; // Pay to Script Hash (SegWit compatible)
      } else if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
        addressType = 'p2pkh'; // Legacy
      }
    }

    // Track validation attempts for analytics
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'bitcoin_address_validation',
        properties: {
          isValid,
          addressType,
          addressLength: address.length,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    return NextResponse.json({
      valid: isValid,
      addressType,
      network: isValid ? detectNetwork(address) : null,
      recommendations: isValid ? getAddressRecommendations(addressType) : null,
    });
    
  } catch (error) {
    console.error('Bitcoin address validation error:', error);
    
    return NextResponse.json(
      { error: 'Failed to validate Bitcoin address' },
      { status: 500 }
    );
  }
}

// Helper function to detect network (mainnet/testnet)
function detectNetwork(address: string): 'mainnet' | 'testnet' {
  if (
    address.startsWith('bc1') || 
    address.startsWith('1') || 
    address.startsWith('3')
  ) {
    return 'mainnet';
  } else if (
    address.startsWith('tb1') || 
    address.startsWith('m') || 
    address.startsWith('n') || 
    address.startsWith('2')
  ) {
    return 'testnet';
  }
  return 'mainnet'; // Default assumption
}

// Helper function to provide address recommendations
function getAddressRecommendations(addressType: string) {
  switch (addressType) {
    case 'bech32':
      return {
        efficiency: 'highest',
        fees: 'lowest',
        compatibility: 'modern',
        description: 'Native SegWit address with lowest transaction fees',
      };
    case 'p2sh':
      return {
        efficiency: 'high',
        fees: 'medium',
        compatibility: 'high',
        description: 'SegWit-compatible address with good efficiency',
      };
    case 'p2pkh':
      return {
        efficiency: 'lower',
        fees: 'higher',
        compatibility: 'universal',
        description: 'Legacy address with higher fees but maximum compatibility',
      };
    default:
      return {
        efficiency: 'unknown',
        fees: 'unknown',
        compatibility: 'unknown',
        description: 'Address format not recognized',
      };
  }
}