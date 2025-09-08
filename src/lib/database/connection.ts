// LIQUID ABT - Database Connection & Multi-Tenant Management

import { Pool, Client } from 'pg';
import { PrismaClient } from '@prisma/client';

// Master database connection (for tenant management)
let masterPrisma: PrismaClient | undefined;

export function getMasterPrisma(): PrismaClient {
  if (!masterPrisma) {
    masterPrisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      }
    });
  }
  return masterPrisma;
}

// Connection pool for direct PostgreSQL queries (for schema operations)
let connectionPool: Pool | undefined;

export function getConnectionPool(): Pool {
  if (!connectionPool) {
    connectionPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return connectionPool;
}

// Multi-tenant schema management
export class TenantSchemaManager {
  private pool: Pool;

  constructor() {
    this.pool = getConnectionPool();
  }

  /**
   * Retry wrapper for database operations to handle concurrency issues
   */
  private async withRetry<T>(
    operation: () => Promise<T>, 
    maxRetries: number = 3, 
    delay: number = 100
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Check if it's a retryable error
        if (
          error instanceof Error && 
          (error.message.includes('tuple concurrently updated') ||
           error.message.includes('could not serialize access') ||
           error.message.includes('deadlock detected'))
        ) {
          if (attempt < maxRetries) {
            // Exponential backoff with jitter
            const jitter = Math.random() * 50;
            await new Promise(resolve => setTimeout(resolve, delay * attempt + jitter));
            continue;
          }
        }
        
        // Non-retryable error or max retries reached
        throw error;
      }
    }
    
    throw lastError!;
  }

  /**
   * Create a new tenant schema with all required tables
   */
  async createTenantSchema(tenantId: string): Promise<void> {
    return this.withRetry(async () => {
      const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
      const client = await this.pool.connect();

      try {
        await client.query('BEGIN');

      // Create schema
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

      // Create integrations table
      await client.query(`
        CREATE TABLE "${schemaName}".integrations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          type TEXT NOT NULL,
          provider TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          
          -- OAuth Credentials (encrypted)
          access_token TEXT,
          refresh_token TEXT,
          token_expires_at TIMESTAMP,
          
          -- Provider-specific settings
          settings JSONB NOT NULL DEFAULT '{}',
          
          -- Webhook Configuration
          webhook_url TEXT,
          webhook_secret TEXT,
          
          -- Timestamps
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create treasury_rules table
      await client.query(`
        CREATE TABLE "${schemaName}".treasury_rules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          
          -- Rule Configuration
          rule_type TEXT NOT NULL CHECK (rule_type IN ('percentage', 'threshold', 'fixed_dca', 'market_timing')),
          conversion_percentage DECIMAL(5,2), -- For percentage rules (e.g., 10.50%)
          threshold_amount DECIMAL(15,2), -- For threshold rules
          fixed_amount DECIMAL(15,2), -- For DCA rules
          
          -- Purchase Limits
          minimum_purchase DECIMAL(15,2), -- Minimum purchase amount
          maximum_purchase DECIMAL(15,2), -- Maximum purchase amount
          buffer_amount DECIMAL(15,2), -- Cash buffer to maintain
          
          -- Withdrawal Settings
          withdrawal_address TEXT, -- Customer's Bitcoin address
          is_auto_withdrawal BOOLEAN NOT NULL DEFAULT false,
          exchange_provider TEXT NOT NULL DEFAULT 'kraken',
          
          -- Advanced Settings (JSONB for flexibility)
          settings JSONB NOT NULL DEFAULT '{}',
          
          -- Legacy columns for compatibility
          min_transaction_amount DECIMAL(15,2),
          max_transaction_amount DECIMAL(15,2),
          cash_floor DECIMAL(15,2),
          btc_allocation_min DECIMAL(5,4),
          btc_allocation_max DECIMAL(5,4),
          
          -- Timestamps
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create transactions table
      await client.query(`
        CREATE TABLE "${schemaName}".transactions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          integration_id UUID REFERENCES "${schemaName}".integrations(id),
          
          -- Transaction Details
          external_id TEXT NOT NULL,
          amount DECIMAL(15,2) NOT NULL,
          currency TEXT NOT NULL DEFAULT 'AUD',
          description TEXT,
          
          -- Processing Status
          status TEXT NOT NULL DEFAULT 'PENDING',
          processed_at TIMESTAMP,
          
          -- Bitcoin Conversion
          should_convert BOOLEAN NOT NULL DEFAULT false,
          conversion_amount DECIMAL(15,2),
          conversion_fee DECIMAL(15,2),
          
          -- Provider Details
          provider TEXT NOT NULL,
          provider_data JSONB,
          
          -- Timestamps
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create bitcoin_purchases table
      await client.query(`
        CREATE TABLE "${schemaName}".bitcoin_purchases (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          transaction_id UUID UNIQUE NOT NULL REFERENCES "${schemaName}".transactions(id),
          
          -- Purchase Details
          amount_aud DECIMAL(15,2) NOT NULL,
          bitcoin_amount DECIMAL(18,8) NOT NULL,
          price_per_btc DECIMAL(15,2) NOT NULL,
          
          -- Exchange Details
          exchange_order_id TEXT NOT NULL,
          exchange_provider TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          fees_aud DECIMAL(15,2) NOT NULL DEFAULT 0,
          
          -- Raw exchange response for debugging
          raw_exchange_data JSONB,
          
          -- Timestamps
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create bitcoin_withdrawals table
      await client.query(`
        CREATE TABLE "${schemaName}".bitcoin_withdrawals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          bitcoin_purchase_id UUID REFERENCES "${schemaName}".bitcoin_purchases(id),
          
          -- Withdrawal Details
          withdrawal_id TEXT, -- Exchange withdrawal ID
          amount DECIMAL(18,8) NOT NULL,
          address TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          
          -- Exchange Details
          exchange_provider TEXT NOT NULL,
          tx_id TEXT, -- Blockchain transaction ID
          fees_btc DECIMAL(18,8) NOT NULL DEFAULT 0,
          
          -- Error handling
          error_message TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          
          -- Timestamps
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create processing_failures table
      await client.query(`
        CREATE TABLE "${schemaName}".processing_failures (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          transaction_id UUID UNIQUE NOT NULL REFERENCES "${schemaName}".transactions(id),
          
          -- Error Details
          error_message TEXT NOT NULL,
          error_type TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 3,
          
          -- Status
          is_resolved BOOLEAN NOT NULL DEFAULT false,
          resolved_at TIMESTAMP,
          
          -- Timestamps
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create indexes for better performance
      await client.query(`CREATE INDEX idx_${schemaName.replace('-', '_')}_transactions_status ON "${schemaName}".transactions(status)`);
      await client.query(`CREATE INDEX idx_${schemaName.replace('-', '_')}_transactions_created ON "${schemaName}".transactions(created_at)`);
      await client.query(`CREATE INDEX idx_${schemaName.replace('-', '_')}_transactions_should_convert ON "${schemaName}".transactions(should_convert)`);
      await client.query(`CREATE INDEX idx_${schemaName.replace('-', '_')}_bitcoin_purchases_status ON "${schemaName}".bitcoin_purchases(status)`);
      await client.query(`CREATE INDEX idx_${schemaName.replace('-', '_')}_bitcoin_withdrawals_status ON "${schemaName}".bitcoin_withdrawals(status)`);
      await client.query(`CREATE INDEX idx_${schemaName.replace('-', '_')}_processing_failures_resolved ON "${schemaName}".processing_failures(is_resolved)`);

      // Create updated_at triggers
      await client.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      await client.query(`CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON "${schemaName}".integrations FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column()`);
      await client.query(`CREATE TRIGGER update_treasury_rules_updated_at BEFORE UPDATE ON "${schemaName}".treasury_rules FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column()`);
      await client.query(`CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON "${schemaName}".transactions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column()`);
      await client.query(`CREATE TRIGGER update_bitcoin_purchases_updated_at BEFORE UPDATE ON "${schemaName}".bitcoin_purchases FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column()`);
      await client.query(`CREATE TRIGGER update_bitcoin_withdrawals_updated_at BEFORE UPDATE ON "${schemaName}".bitcoin_withdrawals FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column()`);
      await client.query(`CREATE TRIGGER update_processing_failures_updated_at BEFORE UPDATE ON "${schemaName}".processing_failures FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column()`);

        await client.query('COMMIT');
        console.log(`Successfully created tenant schema: ${schemaName}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Failed to create tenant schema ${schemaName}:`, error);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  /**
   * Drop a tenant schema (for cleanup/testing)
   */
  async dropTenantSchema(tenantId: string): Promise<void> {
    return this.withRetry(async () => {
      const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
      const client = await this.pool.connect();

      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        console.log(`Successfully dropped tenant schema: ${schemaName}`);
      } catch (error) {
        console.error(`Failed to drop tenant schema ${schemaName}:`, error);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  /**
   * Check if tenant schema exists
   */
  async schemaExists(tenantId: string): Promise<boolean> {
    return this.withRetry(async () => {
      const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
      const client = await this.pool.connect();

      try {
        const result = await client.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name = $1
        `, [schemaName]);
        
        return result.rows.length > 0;
      } catch (error) {
        console.error(`Failed to check schema existence for ${schemaName}:`, error);
        return false;
      } finally {
        client.release();
      }
    });
  }

  /**
   * Get a database client for tenant-specific operations
   */
  async getTenantClient(tenantId: string): Promise<Client> {
    const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      options: `--search_path=${schemaName},public`
    });
    
    await client.connect();
    return client;
  }

  /**
   * Execute a query in a tenant's schema
   */
  async queryTenantSchema(tenantId: string, query: string, params: any[] = []): Promise<any> {
    return this.withRetry(async () => {
      const client = await this.getTenantClient(tenantId);
      
      try {
        const result = await client.query(query, params);
        return result.rows;
      } finally {
        await client.end();
      }
    });
  }
}

// Singleton instance
export const tenantSchemaManager = new TenantSchemaManager();

// Cleanup function for graceful shutdown
export async function closeDatabaseConnections(): Promise<void> {
  if (connectionPool) {
    await connectionPool.end();
    connectionPool = undefined;
  }
  
  if (masterPrisma) {
    await masterPrisma.$disconnect();
    masterPrisma = undefined;
  }
}