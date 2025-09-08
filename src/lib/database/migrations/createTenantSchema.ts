// LIQUID ABT - Tenant Schema Creation
// Create dedicated database schema for each tenant

import { getDatabase } from '../connection';

/**
 * Create a new tenant schema with all required tables
 */
export async function createTenantSchema(tenantId: string): Promise<void> {
  const db = await getDatabase('public');
  
  try {
    // Create the tenant schema
    await db.query(`CREATE SCHEMA IF NOT EXISTS "${tenantId}"`);
    
    // Set search path to the tenant schema
    await db.query(`SET search_path TO "${tenantId}", public`);
    
    // Create treasury_rules table
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${tenantId}".treasury_rules (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('percentage', 'threshold', 'fixed', 'time_based')),
        conversion_percentage DECIMAL(5,2),
        minimum_amount DECIMAL(12,2),
        maximum_amount DECIMAL(12,2),
        frequency VARCHAR(20) CHECK (frequency IN ('immediate', 'daily', 'weekly', 'monthly')),
        risk_tolerance VARCHAR(20) CHECK (risk_tolerance IN ('conservative', 'moderate', 'aggressive')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create integrations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${tenantId}".integrations (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        integration_type VARCHAR(50) NOT NULL CHECK (integration_type IN ('payment', 'accounting', 'exchange', 'compliance')),
        provider VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'ERROR', 'DISABLED')),
        config JSONB,
        oauth_data JSONB,
        webhook_secret VARCHAR(255),
        last_sync_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create bitcoin_purchases table
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${tenantId}".bitcoin_purchases (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        transaction_id VARCHAR(255) NOT NULL,
        payment_processor VARCHAR(50),
        payment_amount DECIMAL(12,2) NOT NULL,
        payment_currency VARCHAR(3) DEFAULT 'AUD',
        bitcoin_amount DECIMAL(18,8),
        bitcoin_price_aud DECIMAL(12,2),
        exchange_used VARCHAR(50),
        exchange_order_id VARCHAR(255),
        fees_total DECIMAL(12,2),
        fees_payment_processor DECIMAL(12,2),
        fees_exchange DECIMAL(12,2),
        fees_platform DECIMAL(12,2),
        status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
        wallet_address VARCHAR(255),
        blockchain_tx_id VARCHAR(255),
        executed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create transactions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${tenantId}".transactions (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        external_id VARCHAR(255) NOT NULL,
        integration_id INTEGER REFERENCES "${tenantId}".integrations(id),
        transaction_type VARCHAR(20) CHECK (transaction_type IN ('payment', 'refund', 'chargeback')),
        amount DECIMAL(12,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'AUD',
        description TEXT,
        customer_email VARCHAR(255),
        payment_method VARCHAR(50),
        status VARCHAR(20),
        fee_amount DECIMAL(12,2),
        net_amount DECIMAL(12,2),
        processed_at TIMESTAMP,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create wallet_addresses table
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${tenantId}".wallet_addresses (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        address_type VARCHAR(20) CHECK (address_type IN ('bech32', 'p2sh', 'p2pkh')),
        network VARCHAR(10) CHECK (network IN ('mainnet', 'testnet')),
        label VARCHAR(255),
        is_primary BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create audit_logs table
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${tenantId}".audit_logs (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255),
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(50),
        resource_id VARCHAR(255),
        old_values JSONB,
        new_values JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create webhook_events table
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${tenantId}".webhook_events (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        integration_id INTEGER REFERENCES "${tenantId}".integrations(id),
        external_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        processed BOOLEAN DEFAULT false,
        processed_at TIMESTAMP,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create notifications table
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${tenantId}".notifications (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        read BOOLEAN DEFAULT false,
        dismissed BOOLEAN DEFAULT false,
        metadata JSONB,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes for performance
    await createTenantIndexes(tenantId, db);
    
    // Reset search path
    await db.query('SET search_path TO public');
    
    console.log(`✅ Tenant schema created successfully for: ${tenantId}`);
    
  } catch (error) {
    console.error(`❌ Failed to create tenant schema for ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Create indexes for tenant tables
 */
async function createTenantIndexes(tenantId: string, db: any): Promise<void> {
  const indexes = [
    // Treasury rules indexes
    `CREATE INDEX IF NOT EXISTS idx_treasury_rules_tenant_active ON "${tenantId}".treasury_rules(tenant_id, is_active)`,
    
    // Integrations indexes
    `CREATE INDEX IF NOT EXISTS idx_integrations_tenant_type ON "${tenantId}".integrations(tenant_id, integration_type)`,
    `CREATE INDEX IF NOT EXISTS idx_integrations_provider_status ON "${tenantId}".integrations(provider, status)`,
    
    // Bitcoin purchases indexes
    `CREATE INDEX IF NOT EXISTS idx_bitcoin_purchases_tenant_created ON "${tenantId}".bitcoin_purchases(tenant_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_bitcoin_purchases_status ON "${tenantId}".bitcoin_purchases(status)`,
    `CREATE INDEX IF NOT EXISTS idx_bitcoin_purchases_transaction_id ON "${tenantId}".bitcoin_purchases(transaction_id)`,
    
    // Transactions indexes
    `CREATE INDEX IF NOT EXISTS idx_transactions_tenant_created ON "${tenantId}".transactions(tenant_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_external_id ON "${tenantId}".transactions(external_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_integration ON "${tenantId}".transactions(integration_id)`,
    
    // Wallet addresses indexes
    `CREATE INDEX IF NOT EXISTS idx_wallet_addresses_tenant_active ON "${tenantId}".wallet_addresses(tenant_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_wallet_addresses_primary ON "${tenantId}".wallet_addresses(is_primary) WHERE is_primary = true`,
    
    // Audit logs indexes
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON "${tenantId}".audit_logs(tenant_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON "${tenantId}".audit_logs(action)`,
    
    // Webhook events indexes
    `CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant_processed ON "${tenantId}".webhook_events(tenant_id, processed)`,
    `CREATE INDEX IF NOT EXISTS idx_webhook_events_external_id ON "${tenantId}".webhook_events(external_id)`,
    
    // Notifications indexes
    `CREATE INDEX IF NOT EXISTS idx_notifications_tenant_read ON "${tenantId}".notifications(tenant_id, read)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON "${tenantId}".notifications(user_id, created_at DESC)`,
  ];
  
  for (const indexQuery of indexes) {
    await db.query(indexQuery);
  }
}

/**
 * Drop tenant schema and all its data
 */
export async function dropTenantSchema(tenantId: string): Promise<void> {
  const db = await getDatabase('public');
  
  try {
    await db.query(`DROP SCHEMA IF EXISTS "${tenantId}" CASCADE`);
    console.log(`✅ Tenant schema dropped successfully for: ${tenantId}`);
  } catch (error) {
    console.error(`❌ Failed to drop tenant schema for ${tenantId}:`, error);
    throw error;
  }
}