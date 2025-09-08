// LIQUID ABT - Square Integration Stub (Phase 2)
// Square stub for future implementation

import { PaymentProcessor, OAuthResult, WebhookResult, Transaction, Balance } from '../types';

export class SquareIntegration implements PaymentProcessor {
  name = 'Square';
  isEnabled = false; // Will be enabled in Phase 2
  
  // Stub implementation - throws errors until Phase 2
  async connect(tenantId: string): Promise<OAuthResult> {
    throw new Error('Square integration coming in Phase 2 - February 2025');
  }
  
  async disconnect(tenantId: string): Promise<void> {
    throw new Error('Square integration coming in Phase 2 - February 2025');
  }
  
  async handleWebhook(payload: any, signature: string, tenantId?: string): Promise<WebhookResult> {
    throw new Error('Square integration coming in Phase 2 - February 2025');
  }
  
  async getTransactions(tenantId: string, from: Date, to: Date): Promise<Transaction[]> {
    throw new Error('Square integration coming in Phase 2 - February 2025');
  }
  
  async getBalance(tenantId: string): Promise<Balance> {
    throw new Error('Square integration coming in Phase 2 - February 2025');
  }
  
  async healthCheck(): Promise<boolean> {
    return false; // Not implemented yet
  }
  
  // Square-specific methods (to be implemented in Phase 2)
  async getLocations?(): Promise<any[]> {
    throw new Error('Square integration coming in Phase 2 - February 2025');
  }
  
  async processInPersonPayment?(): Promise<any> {
    throw new Error('Square integration coming in Phase 2 - February 2025');
  }
}