// Shared Stripe connection storage for development/testing
// In production, this would be replaced with database storage

export interface StripeConnection {
  tenantId: string;
  userId: string;
  stripeAccountId: string;
  accessToken: string;
  refreshToken?: string;
  scope: string;
  livemode: boolean;
  connectedAt: string;
}

// Shared in-memory storage (persists across route calls within same process)
const connections = new Map<string, StripeConnection>();

// Helper function to get connection key
const getConnectionKey = (tenantId: string) => `tenant_${tenantId}`;

/**
 * Get Stripe connection for a tenant
 */
export function getConnection(tenantId: string): StripeConnection | null {
  const connectionKey = getConnectionKey(tenantId);
  const connection = connections.get(connectionKey);
  console.log(`[Stripe Storage] Get connection for ${tenantId}: ${connection ? 'FOUND' : 'NOT FOUND'}`);
  return connection || null;
}

/**
 * Set/store Stripe connection for a tenant
 */
export function setConnection(tenantId: string, data: StripeConnection): void {
  const connectionKey = getConnectionKey(tenantId);
  connections.set(connectionKey, data);
  console.log(`[Stripe Storage] Stored connection for ${tenantId} - Account: ${data.stripeAccountId}`);
  console.log(`[Stripe Storage] Total connections: ${connections.size}`);
}

/**
 * Delete Stripe connection for a tenant
 */
export function deleteConnection(tenantId: string): boolean {
  const connectionKey = getConnectionKey(tenantId);
  const deleted = connections.delete(connectionKey);
  console.log(`[Stripe Storage] Delete connection for ${tenantId}: ${deleted ? 'SUCCESS' : 'NOT FOUND'}`);
  console.log(`[Stripe Storage] Remaining connections: ${connections.size}`);
  return deleted;
}

/**
 * List all connections (for debugging)
 */
export function listConnections(): StripeConnection[] {
  return Array.from(connections.values());
}

/**
 * Clear all connections (for testing)
 */
export function clearAllConnections(): void {
  const count = connections.size;
  connections.clear();
  console.log(`[Stripe Storage] Cleared ${count} connections`);
}