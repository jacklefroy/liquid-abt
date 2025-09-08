// LIQUID ABT - Payment Processor Factory
// Dynamic loading and management of payment processors

import { PaymentProcessor, IntegrationFactory } from '../types';
import { StripeIntegration } from './stripe';
// import { SquareIntegration } from './square'; // Phase 2
// import { PayPalIntegration } from './paypal'; // Phase 2
// import { ShopifyIntegration } from './shopify'; // Phase 4

export class PaymentProcessorFactory implements IntegrationFactory<PaymentProcessor> {
  private static instance: PaymentProcessorFactory;
  private processors: Map<string, PaymentProcessor> = new Map();
  
  constructor() {
    this.registerAvailableProcessors();
  }
  
  static getInstance(): PaymentProcessorFactory {
    if (!PaymentProcessorFactory.instance) {
      PaymentProcessorFactory.instance = new PaymentProcessorFactory();
    }
    return PaymentProcessorFactory.instance;
  }
  
  private registerAvailableProcessors() {
    // Phase 1: Stripe only
    this.register('stripe', new StripeIntegration());
    
    // Phase 2: Square and PayPal (commented until implemented)
    // this.register('square', new SquareIntegration());
    // this.register('paypal', new PayPalIntegration());
    
    // Phase 4: Shopify (commented until implemented)
    // this.register('shopify', new ShopifyIntegration());
  }
  
  register(name: string, processor: PaymentProcessor): void {
    this.processors.set(name, processor);
  }
  
  get(name: string): PaymentProcessor | undefined {
    return this.processors.get(name);
  }
  
  getEnabled(): PaymentProcessor[] {
    return Array.from(this.processors.values()).filter(p => p.isEnabled);
  }
  
  getAll(): PaymentProcessor[] {
    return Array.from(this.processors.values());
  }
  
  async getHealthy(): Promise<PaymentProcessor[]> {
    const processors = this.getEnabled();
    const healthyProcessors: PaymentProcessor[] = [];
    
    for (const processor of processors) {
      try {
        const isHealthy = await processor.healthCheck();
        if (isHealthy) {
          healthyProcessors.push(processor);
        }
      } catch (error) {
        console.warn(`Health check failed for ${processor.name}:`, error);
      }
    }
    
    return healthyProcessors;
  }
  
  /**
   * Get available processor names
   */
  getAvailableNames(): string[] {
    return Array.from(this.processors.keys());
  }
  
  /**
   * Check if a processor exists and is enabled
   */
  isAvailable(name: string): boolean {
    const processor = this.processors.get(name);
    return processor?.isEnabled ?? false;
  }
}

// Singleton instance
export const paymentProcessorFactory = PaymentProcessorFactory.getInstance();

// Convenience exports
export const getPaymentProcessor = (name: string) => paymentProcessorFactory.get(name);
export const getEnabledPaymentProcessors = () => paymentProcessorFactory.getEnabled();
export const getAllPaymentProcessors = () => paymentProcessorFactory.getAll();