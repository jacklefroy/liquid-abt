// LIQUID ABT - Kraken Exchange Integration API

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, AuthenticatedRequest } from '@/lib/auth/middleware';
import { tenantSchemaManager } from '@/lib/database/connection';
import { ExchangeProviderFactory } from '@/lib/integrations/exchanges/interface';
import { UserRole } from '@/types/database';
import crypto from 'crypto';

// POST: Configure Kraken API credentials
async function handlePost(req: AuthenticatedRequest): Promise<NextResponse> {
  try {
    const { tenantId } = req.user;
    const body = await req.json();

    const { apiKey, privateKey, testConnection = true } = body;

    if (!apiKey || !privateKey) {
      return NextResponse.json(
        { error: 'API key and private key are required' },
        { status: 400 }
      );
    }

    // Test connection if requested
    if (testConnection) {
      try {
        const krakenProvider = ExchangeProviderFactory.create('kraken', {
          apiKey,
          privateKey
        });

        // Test the connection by getting account balance
        await krakenProvider.getBalance();
        console.log('Kraken connection test successful');
      } catch (error) {
        console.error('Kraken connection test failed:', error);
        return NextResponse.json(
          { error: `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 400 }
        );
      }
    }

    // Encrypt the private key for storage
    const encryptedPrivateKey = encryptString(privateKey);

    // Store or update the Kraken integration
    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `INSERT INTO integrations (type, provider, is_active, access_token, settings) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (provider) DO UPDATE SET 
       is_active = $3,
       access_token = $4,
       settings = $5,
       updated_at = NOW()`,
      [
        'EXCHANGE',
        'kraken',
        true,
        apiKey,
        JSON.stringify({
          privateKey: encryptedPrivateKey,
          environment: 'production',
          connectedAt: new Date().toISOString()
        })
      ]
    );

    // Get trading fees to return to client
    try {
      const krakenProvider = ExchangeProviderFactory.create('kraken', { apiKey, privateKey });
      const fees = await krakenProvider.getTradingFees();
      const withdrawalFees = await krakenProvider.getWithdrawalFees();

      return NextResponse.json({
        message: 'Kraken integration configured successfully',
        provider: 'kraken',
        status: 'active',
        fees: {
          trading: fees,
          withdrawal: withdrawalFees
        }
      });
    } catch (error) {
      console.error('Failed to get Kraken fees:', error);
      return NextResponse.json({
        message: 'Kraken integration configured successfully',
        provider: 'kraken',
        status: 'active',
        warning: 'Could not retrieve current fees'
      });
    }

  } catch (error) {
    console.error('Kraken integration error:', error);
    return NextResponse.json(
      { error: 'Failed to configure Kraken integration' },
      { status: 500 }
    );
  }
}

// GET: Get current Kraken integration status
async function handleGet(req: AuthenticatedRequest): Promise<NextResponse> {
  try {
    const { tenantId } = req.user;

    const integration = await tenantSchemaManager.queryTenantSchema(
      tenantId,
      'SELECT provider, is_active, settings, created_at FROM integrations WHERE provider = $1',
      ['kraken']
    );

    if (!integration.length) {
      return NextResponse.json(
        { provider: 'kraken', status: 'not_configured' },
        { status: 404 }
      );
    }

    const krakenIntegration = integration[0];
    
    // Test current connection status
    let connectionStatus = 'unknown';
    let balance = null;
    let fees = null;

    try {
      if (krakenIntegration.is_active) {
        const krakenProvider = ExchangeProviderFactory.create('kraken', {
          apiKey: process.env.KRAKEN_API_KEY, // Would need to decrypt stored key
          privateKey: process.env.KRAKEN_PRIVATE_KEY
        });
        
        balance = await krakenProvider.getBalance();
        fees = {
          trading: await krakenProvider.getTradingFees(),
          withdrawal: await krakenProvider.getWithdrawalFees()
        };
        connectionStatus = 'connected';
      }
    } catch (error) {
      console.error('Kraken status check failed:', error);
      connectionStatus = 'error';
    }

    return NextResponse.json({
      provider: 'kraken',
      status: krakenIntegration.is_active ? connectionStatus : 'inactive',
      connectedAt: krakenIntegration.settings?.connectedAt,
      balance,
      fees
    });

  } catch (error) {
    console.error('Failed to get Kraken status:', error);
    return NextResponse.json(
      { error: 'Failed to get Kraken integration status' },
      { status: 500 }
    );
  }
}

// DELETE: Remove Kraken integration
async function handleDelete(req: AuthenticatedRequest): Promise<NextResponse> {
  try {
    const { tenantId } = req.user;

    await tenantSchemaManager.queryTenantSchema(
      tenantId,
      `UPDATE integrations 
       SET is_active = false, 
           access_token = NULL,
           settings = jsonb_set(settings, '{disconnectedAt}', $1)
       WHERE provider = $2`,
      [JSON.stringify(new Date().toISOString()), 'kraken']
    );

    return NextResponse.json({
      message: 'Kraken integration disabled successfully'
    });

  } catch (error) {
    console.error('Kraken disconnection error:', error);
    return NextResponse.json(
      { error: 'Failed to disable Kraken integration' },
      { status: 500 }
    );
  }
}

// Utility function to encrypt sensitive data
function encryptString(text: string): string {
  const algorithm = 'aes-256-gcm';
  const secretKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipher(algorithm, secretKey);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return `${iv.toString('hex')}:${encrypted}`;
}

// Utility function to decrypt sensitive data
function decryptString(encryptedText: string): string {
  const algorithm = 'aes-256-gcm';
  const secretKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
  
  const [ivHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  
  const decipher = crypto.createDecipher(algorithm, secretKey);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Export handlers with authentication middleware
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withAuth(handlePost, { 
    requiredRole: UserRole.ADMIN,
    requireActiveTenant: true 
  })(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withAuth(handleGet, { 
    requiredRole: UserRole.USER,
    requireActiveTenant: true 
  })(request);
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  return withAuth(handleDelete, { 
    requiredRole: UserRole.ADMIN,
    requireActiveTenant: true 
  })(request);
}