// LIQUID ABT - PayPal Integration Stub (Phase 2)
// PayPal stub for future implementation

import { PaymentProcessor, OAuthResult, WebhookResult, Transaction, Balance } from '../types';

export class PayPalIntegration implements PaymentProcessor {
  name = 'PayPal';
  isEnabled = false; // Will be enabled in Phase 2
  
  // Stub implementation - throws errors until Phase 2
  async connect(tenantId: string): Promise<OAuthResult> {
    throw new Error('PayPal integration coming in Phase 2 - February 2025');
  }
  
  async disconnect(tenantId: string): Promise<void> {
    throw new Error('PayPal integration coming in Phase 2 - February 2025');
  }
  
  async handleWebhook(payload: any, signature: string, tenantId?: string): Promise<WebhookResult> {
    throw new Error('PayPal integration coming in Phase 2 - February 2025');
  }
  
  async getTransactions(tenantId: string, from: Date, to: Date): Promise<Transaction[]> {
    throw new Error('PayPal integration coming in Phase 2 - February 2025');
  }
  
  async getBalance(tenantId: string): Promise<Balance> {
    throw new Error('PayPal integration coming in Phase 2 - February 2025');
  }
  
  async healthCheck(): Promise<boolean> {
    return false; // Not implemented yet
  }
  
  // PayPal-specific methods (to be implemented in Phase 2)
  async processVenmoPayment?(): Promise<any> {
    throw new Error('PayPal integration coming in Phase 2 - February 2025');
  }
  
  async getPayPalSubscriptions?(): Promise<any[]> {
    throw new Error('PayPal integration coming in Phase 2 - February 2025');
  }
}