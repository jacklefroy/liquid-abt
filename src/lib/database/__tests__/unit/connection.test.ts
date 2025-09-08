// LIQUID ABT - Database Connection Unit Tests

import { Pool, Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import {
  getMasterPrisma,
  getConnectionPool,
  TenantSchemaManager,
  tenantSchemaManager,
  closeDatabaseConnections,
} from '../../connection';

// Mock pg
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined),
  })),
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
    release: jest.fn(),
  })),
}));

// Mock PrismaClient
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $disconnect: jest.fn().mockResolvedValue(undefined),
  })),
}));

const MockedPool = Pool as jest.MockedClass<typeof Pool>;
const MockedClient = Client as jest.MockedClass<typeof Client>;
const MockedPrismaClient = PrismaClient as jest.MockedClass<typeof PrismaClient>;

describe('Database Connection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
  });

  afterEach(() => {
    // Reset module state
    jest.resetModules();
  });

  describe('getMasterPrisma', () => {
    it('should create a new PrismaClient instance', () => {
      const prisma = getMasterPrisma();
      
      expect(MockedPrismaClient).toHaveBeenCalledWith({
        datasources: {
          db: {
            url: process.env.DATABASE_URL
          }
        }
      });
      expect(prisma).toBeDefined();
    });

    it('should return the same instance on subsequent calls', () => {
      const prisma1 = getMasterPrisma();
      const prisma2 = getMasterPrisma();
      
      expect(prisma1).toBe(prisma2);
      expect(MockedPrismaClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('getConnectionPool', () => {
    it('should create a new Pool instance with correct config', () => {
      const pool = getConnectionPool();
      
      expect(MockedPool).toHaveBeenCalledWith({
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
      expect(pool).toBeDefined();
    });

    it('should return the same instance on subsequent calls', () => {
      const pool1 = getConnectionPool();
      const pool2 = getConnectionPool();
      
      expect(pool1).toBe(pool2);
      expect(MockedPool).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeDatabaseConnections', () => {
    it('should close connection pool when it exists', async () => {
      const mockEnd = jest.fn().mockResolvedValue(undefined);
      MockedPool.mockImplementation(() => ({
        connect: jest.fn(),
        end: mockEnd,
      }) as any);

      // Create a pool first
      getConnectionPool();
      
      await closeDatabaseConnections();
      
      expect(mockEnd).toHaveBeenCalled();
    });

    it('should disconnect Prisma client when it exists', async () => {
      const mockDisconnect = jest.fn().mockResolvedValue(undefined);
      MockedPrismaClient.mockImplementation(() => ({
        $disconnect: mockDisconnect,
      }) as any);

      // Create a Prisma client first
      getMasterPrisma();
      
      await closeDatabaseConnections();
      
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should handle case when no connections exist', async () => {
      // Should not throw when no connections exist
      await expect(closeDatabaseConnections()).resolves.toBeUndefined();
    });
  });
});

describe('TenantSchemaManager', () => {
  let manager: TenantSchemaManager;
  let mockClient: any;
  let mockPool: any;

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn().mockResolvedValue(undefined),
    };

    MockedPool.mockImplementation(() => mockPool);
    MockedClient.mockImplementation(() => mockClient);
    
    manager = new TenantSchemaManager();
  });

  describe('constructor', () => {
    it('should initialize with connection pool', () => {
      expect(MockedPool).toHaveBeenCalled();
    });
  });

  describe('createTenantSchema', () => {
    const testTenantId = 'test-tenant-123';
    const expectedSchemaName = 'tenant_test_tenant_123';

    it('should create tenant schema successfully', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await manager.createTenantSchema(testTenantId);

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(`CREATE SCHEMA IF NOT EXISTS "${expectedSchemaName}"`);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle schema creation errors and rollback', async () => {
      const error = new Error('Schema creation failed');
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(error); // CREATE SCHEMA fails

      await expect(manager.createTenantSchema(testTenantId)).rejects.toThrow('Schema creation failed');
      
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should create all required tables and indexes', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await manager.createTenantSchema(testTenantId);

      // Check for key table creation queries
      const calls = mockClient.query.mock.calls.map((call: any) => call[0]);
      
      expect(calls.some((call: string) => call.includes('CREATE TABLE') && call.includes('integrations'))).toBe(true);
      expect(calls.some((call: string) => call.includes('CREATE TABLE') && call.includes('treasury_rules'))).toBe(true);
      expect(calls.some((call: string) => call.includes('CREATE TABLE') && call.includes('transactions'))).toBe(true);
      expect(calls.some((call: string) => call.includes('CREATE TABLE') && call.includes('bitcoin_purchases'))).toBe(true);
      expect(calls.some((call: string) => call.includes('CREATE TABLE') && call.includes('bitcoin_withdrawals'))).toBe(true);
      expect(calls.some((call: string) => call.includes('CREATE TABLE') && call.includes('processing_failures'))).toBe(true);
      
      // Check for indexes
      expect(calls.some((call: string) => call.includes('CREATE INDEX'))).toBe(true);
      
      // Check for triggers
      expect(calls.some((call: string) => call.includes('CREATE TRIGGER'))).toBe(true);
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new Error('tuple concurrently updated');
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN (first attempt)
        .mockRejectedValueOnce(retryableError) // Fails first time
        .mockResolvedValue({ rows: [] }); // Succeeds on retry

      await manager.createTenantSchema(testTenantId);

      // Should have been called multiple times due to retry
      expect(mockPool.connect).toHaveBeenCalledTimes(2);
    });

    it('should throw non-retryable errors immediately', async () => {
      const nonRetryableError = new Error('Permission denied');
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(nonRetryableError); // Non-retryable error

      await expect(manager.createTenantSchema(testTenantId)).rejects.toThrow('Permission denied');
      
      // Should not retry
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('dropTenantSchema', () => {
    const testTenantId = 'test-tenant-123';
    const expectedSchemaName = 'tenant_test_tenant_123';

    it('should drop tenant schema successfully', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await manager.dropTenantSchema(testTenantId);

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith(`DROP SCHEMA IF EXISTS "${expectedSchemaName}" CASCADE`);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle drop schema errors', async () => {
      const error = new Error('Cannot drop schema');
      mockClient.query.mockRejectedValue(error);

      await expect(manager.dropTenantSchema(testTenantId)).rejects.toThrow('Cannot drop schema');
      
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new Error('deadlock detected');
      mockClient.query
        .mockRejectedValueOnce(retryableError) // Fails first time
        .mockResolvedValue({ rows: [] }); // Succeeds on retry

      await manager.dropTenantSchema(testTenantId);

      expect(mockPool.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe('schemaExists', () => {
    const testTenantId = 'test-tenant-123';
    const expectedSchemaName = 'tenant_test_tenant_123';

    it('should return true when schema exists', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ schema_name: expectedSchemaName }] });

      const exists = await manager.schemaExists(testTenantId);

      expect(exists).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT schema_name FROM information_schema.schemata'),
        [expectedSchemaName]
      );
    });

    it('should return false when schema does not exist', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const exists = await manager.schemaExists(testTenantId);

      expect(exists).toBe(false);
    });

    it('should return false on query errors', async () => {
      mockClient.query.mockRejectedValue(new Error('Database connection failed'));

      const exists = await manager.schemaExists(testTenantId);

      expect(exists).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new Error('could not serialize access');
      mockClient.query
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue({ rows: [{ schema_name: expectedSchemaName }] });

      const exists = await manager.schemaExists(testTenantId);

      expect(exists).toBe(true);
      expect(mockPool.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTenantClient', () => {
    const testTenantId = 'test-tenant-123';

    it('should create and connect tenant client with correct options', async () => {
      const client = await manager.getTenantClient(testTenantId);

      expect(MockedClient).toHaveBeenCalledWith({
        connectionString: process.env.DATABASE_URL,
        options: '--search_path=tenant_test_tenant_123,public'
      });
      expect(mockClient.connect).toHaveBeenCalled();
      expect(client).toBe(mockClient);
    });
  });

  describe('queryTenantSchema', () => {
    const testTenantId = 'test-tenant-123';
    const testQuery = 'SELECT * FROM test_table';
    const testParams = ['param1', 'param2'];

    it('should execute query in tenant schema successfully', async () => {
      const expectedResult = [{ id: 1, name: 'test' }];
      mockClient.query.mockResolvedValue({ rows: expectedResult });

      const result = await manager.queryTenantSchema(testTenantId, testQuery, testParams);

      expect(MockedClient).toHaveBeenCalled();
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith(testQuery, testParams);
      expect(mockClient.end).toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });

    it('should handle query execution errors', async () => {
      const queryError = new Error('Query execution failed');
      mockClient.query.mockRejectedValue(queryError);

      await expect(manager.queryTenantSchema(testTenantId, testQuery, testParams)).rejects.toThrow('Query execution failed');
      
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new Error('tuple concurrently updated');
      mockClient.query
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue({ rows: [{ id: 1 }] });

      const result = await manager.queryTenantSchema(testTenantId, testQuery);

      expect(result).toEqual([{ id: 1 }]);
      expect(MockedClient).toHaveBeenCalledTimes(2);
    });

    it('should handle empty params array', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await manager.queryTenantSchema(testTenantId, testQuery);

      expect(mockClient.query).toHaveBeenCalledWith(testQuery, []);
    });
  });

  describe('withRetry method edge cases', () => {
    it('should handle maximum retries exceeded', async () => {
      const retryableError = new Error('deadlock detected');
      mockClient.query.mockRejectedValue(retryableError);

      await expect(manager.schemaExists('test')).rejects.toThrow('deadlock detected');
    });

    it('should apply exponential backoff with jitter', async () => {
      const retryableError = new Error('could not serialize access');
      let callCount = 0;
      
      // Mock setTimeout to capture delays
      const originalSetTimeout = global.setTimeout;
      const delays: number[] = [];
      global.setTimeout = jest.fn((callback, delay) => {
        delays.push(delay);
        return originalSetTimeout(callback, 0); // Execute immediately for test
      }) as any;

      mockClient.query.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          throw retryableError;
        }
        return Promise.resolve({ rows: [] });
      });

      await manager.schemaExists('test');

      expect(delays.length).toBe(2); // Two retries
      expect(delays[0]).toBeGreaterThan(100); // First retry delay > 100ms
      expect(delays[1]).toBeGreaterThan(200); // Second retry delay > 200ms

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
    });
  });
});

describe('Singleton tenantSchemaManager', () => {
  it('should export a singleton instance', () => {
    expect(tenantSchemaManager).toBeInstanceOf(TenantSchemaManager);
  });

  it('should be the same instance when imported multiple times', () => {
    const manager1 = tenantSchemaManager;
    const manager2 = tenantSchemaManager;
    
    expect(manager1).toBe(manager2);
  });
});

describe('Error Handling Edge Cases', () => {
  let manager: TenantSchemaManager;
  let mockClient: any;
  let mockPool: any;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn(),
    };

    MockedPool.mockImplementation(() => mockPool);
    MockedClient.mockImplementation(() => mockClient);
    
    manager = new TenantSchemaManager();
  });

  it('should handle connection pool connect failures', async () => {
    const connectionError = new Error('Connection pool exhausted');
    mockPool.connect.mockRejectedValue(connectionError);

    await expect(manager.schemaExists('test')).rejects.toThrow('Connection pool exhausted');
  });

  it('should handle client release failures gracefully', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    mockClient.release.mockImplementation(() => {
      throw new Error('Release failed');
    });

    // Should still complete successfully despite release failure
    const exists = await manager.schemaExists('test');
    expect(exists).toBe(false); // Returns false due to empty rows
  });

  it('should handle getTenantClient connection failures', async () => {
    const connectionError = new Error('Tenant client connection failed');
    mockClient.connect.mockRejectedValue(connectionError);

    await expect(manager.getTenantClient('test')).rejects.toThrow('Tenant client connection failed');
  });

  it('should ensure client.end is called even on query failures', async () => {
    const queryError = new Error('Query failed');
    mockClient.query.mockRejectedValue(queryError);

    await expect(manager.queryTenantSchema('test', 'SELECT 1')).rejects.toThrow('Query failed');
    
    expect(mockClient.end).toHaveBeenCalled();
  });
});