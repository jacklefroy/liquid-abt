import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';

export interface MockStripePayment {
  id: string;
  stripePaymentId: string;
  customerId: string;
  amount: number; // Amount in cents
  currency: string;
  status: 'succeeded' | 'failed' | 'canceled' | 'requires_action';
  createdAt: Date;
  metadata?: {
    tenantId?: string;
    customerReference?: string;
    conversionRule?: string;
  };
}

export interface MockBitcoinPurchase {
  id: string;
  customerId: string;
  stripePaymentId: string;
  bitcoinAmount: Decimal;
  fiatAmount: Decimal;
  fiatCurrency: string;
  exchangeRate: Decimal;
  transactionId: string;
  fees: Decimal;
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
  exchangeOrderId?: string;
  withdrawalAddress?: string;
}

export interface BulkTransactionOptions {
  tenantId: string;
  count: number;
  dateRange?: {
    start: Date;
    end: Date;
  };
  amountRange?: {
    min: number;
    max: number;
  };
  successRate?: number;
  includeOrphanedPayments?: boolean;
  includeOrphanedBitcoin?: boolean;
  includeAmountMismatches?: boolean;
}

export class MockTransactionGenerator {
  private readonly baseCustomerIds = [
    'cus_tech_startup_01',
    'cus_ecommerce_store_02',
    'cus_consulting_firm_03',
    'cus_retail_business_04',
    'cus_restaurant_chain_05'
  ];

  private readonly customerReferences = [
    'monthly_revenue_conversion',
    'quarterly_treasury_rebalance',
    'dca_automated_purchase',
    'profit_locking_strategy',
    'cash_sweep_conversion'
  ];

  private readonly bitcoinAddresses = [
    'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    'bc1qh4kl0a0m7e2v8w9f6x3y2z1a5b6c7d8e9f0g1h',
    'bc1q9l8k7j6h5g4f3d2s1a0z9x8c7v6b5n4m3l2k1j',
    'bc1qw2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x'
  ];

  generateMockPayment(overrides: Partial<MockStripePayment & { tenantId?: string }> = {}): MockStripePayment {
    const now = overrides.createdAt || new Date();
    const customerId = overrides.customerId || this.getRandomCustomerId();
    const amount = overrides.amount || this.generateRandomAmount();

    return {
      id: overrides.id || randomUUID(),
      stripePaymentId: overrides.stripePaymentId || this.generateStripePaymentId(),
      customerId,
      amount,
      currency: overrides.currency || 'aud',
      status: overrides.status || 'succeeded',
      createdAt: now,
      metadata: {
        tenantId: overrides.tenantId,
        customerReference: this.getRandomCustomerReference(),
        conversionRule: 'percentage_based_5_percent',
        ...overrides.metadata
      }
    };
  }

  generateMockBitcoinPurchase(overrides: Partial<MockBitcoinPurchase> = {}): MockBitcoinPurchase {
    const now = overrides.createdAt || new Date();
    const customerId = overrides.customerId || this.getRandomCustomerId();
    const stripePaymentId = overrides.stripePaymentId || this.generateStripePaymentId();
    const fiatAmount = overrides.fiatAmount || new Decimal(this.generateRandomAmount() / 100);
    const exchangeRate = overrides.exchangeRate || new Decimal(this.generateRandomBitcoinPrice());
    const fees = overrides.fees || fiatAmount.mul(0.005); // 0.5% fees
    const bitcoinAmount = overrides.bitcoinAmount || fiatAmount.minus(fees).div(exchangeRate);

    return {
      id: overrides.id || randomUUID(),
      customerId,
      stripePaymentId,
      bitcoinAmount: new Decimal(bitcoinAmount.toFixed(8)), // 8 decimal places
      fiatAmount,
      fiatCurrency: 'AUD',
      exchangeRate,
      transactionId: overrides.transactionId || this.generateTransactionId(),
      fees,
      status: overrides.status || 'completed',
      createdAt: now,
      exchangeOrderId: overrides.exchangeOrderId || this.generateOrderId(),
      withdrawalAddress: overrides.withdrawalAddress || this.getRandomBitcoinAddress()
    };
  }

  async generateBulkTransactions(options: BulkTransactionOptions): Promise<{
    payments: MockStripePayment[];
    bitcoinPurchases: MockBitcoinPurchase[];
    stats: {
      totalPayments: number;
      totalBitcoinPurchases: number;
      matchedPairs: number;
      orphanedPayments: number;
      orphanedBitcoin: number;
      amountMismatches: number;
      totalVolume: string;
      dateRange: string;
    };
  }> {
    const {
      tenantId,
      count,
      dateRange = { start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), end: new Date() },
      amountRange = { min: 5000, max: 100000 }, // $50 to $1000
      successRate = 0.85,
      includeOrphanedPayments = true,
      includeOrphanedBitcoin = true,
      includeAmountMismatches = true
    } = options;

    const payments: MockStripePayment[] = [];
    const bitcoinPurchases: MockBitcoinPurchase[] = [];

    let matchedPairs = 0;
    let orphanedPayments = 0;
    let orphanedBitcoin = 0;
    let amountMismatches = 0;

    console.log(`[Mock Generator] Generating ${count} transactions for tenant ${tenantId}`);

    for (let i = 0; i < count; i++) {
      // Generate random timestamp within date range
      const createdAt = this.generateRandomDate(dateRange.start, dateRange.end);
      const amount = this.generateRandomAmountInRange(amountRange.min, amountRange.max);
      const customerId = this.getRandomCustomerId();

      // Create base payment
      const payment = this.generateMockPayment({
        customerId,
        amount,
        createdAt,
        tenantId,
        status: Math.random() < successRate ? 'succeeded' : 'failed'
      });
      payments.push(payment);

      if (payment.status !== 'succeeded') {
        continue; // Skip failed payments
      }

      // Determine what type of scenario to create
      const scenario = this.determineScenario({
        includeOrphanedPayments,
        includeOrphanedBitcoin,
        includeAmountMismatches
      });

      switch (scenario) {
        case 'matched':
          // Create matching Bitcoin purchase
          const bitcoinPurchase = this.generateMockBitcoinPurchase({
            customerId: payment.customerId,
            stripePaymentId: payment.stripePaymentId,
            fiatAmount: new Decimal(payment.amount / 100), // Convert from cents
            createdAt: new Date(createdAt.getTime() + Math.random() * 60000) // 0-1 minute later
          });
          bitcoinPurchases.push(bitcoinPurchase);
          matchedPairs++;
          break;

        case 'orphaned_payment':
          // Payment exists but no Bitcoin purchase
          orphanedPayments++;
          break;

        case 'amount_mismatch':
          // Create Bitcoin purchase with different amount
          const mismatchAmount = new Decimal(payment.amount / 100).mul(0.95); // 5% less
          const mismatchPurchase = this.generateMockBitcoinPurchase({
            customerId: payment.customerId,
            stripePaymentId: payment.stripePaymentId,
            fiatAmount: mismatchAmount,
            createdAt: new Date(createdAt.getTime() + Math.random() * 60000)
          });
          bitcoinPurchases.push(mismatchPurchase);
          amountMismatches++;
          break;
      }

      // Occasionally create orphaned Bitcoin purchases (no corresponding payment)
      if (includeOrphanedBitcoin && Math.random() < 0.1) {
        const orphanedBitcoinPurchase = this.generateMockBitcoinPurchase({
          customerId: this.getRandomCustomerId(),
          stripePaymentId: this.generateStripePaymentId(), // Non-existent payment ID
          fiatAmount: new Decimal(this.generateRandomAmountInRange(amountRange.min, amountRange.max) / 100),
          createdAt
        });
        bitcoinPurchases.push(orphanedBitcoinPurchase);
        orphanedBitcoin++;
      }
    }

    // Calculate total volume
    const totalVolume = payments
      .filter(p => p.status === 'succeeded')
      .reduce((sum, p) => sum + p.amount, 0) / 100;

    const stats = {
      totalPayments: payments.length,
      totalBitcoinPurchases: bitcoinPurchases.length,
      matchedPairs,
      orphanedPayments,
      orphanedBitcoin,
      amountMismatches,
      totalVolume: `$${totalVolume.toLocaleString('en-AU')} AUD`,
      dateRange: `${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`
    };

    console.log('[Mock Generator] Generated transactions:', stats);

    return { payments, bitcoinPurchases, stats };
  }

  private generateStripePaymentId(): string {
    return `pi_mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTransactionId(): string {
    return `MOCK_TX_${Date.now()}_${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
  }

  private generateOrderId(): string {
    return `MOCK_ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  private getRandomCustomerId(): string {
    return this.baseCustomerIds[Math.floor(Math.random() * this.baseCustomerIds.length)];
  }

  private getRandomCustomerReference(): string {
    return this.customerReferences[Math.floor(Math.random() * this.customerReferences.length)];
  }

  private getRandomBitcoinAddress(): string {
    return this.bitcoinAddresses[Math.floor(Math.random() * this.bitcoinAddresses.length)];
  }

  private generateRandomAmount(): number {
    // Generate amounts between $50 and $1000 (in cents)
    return Math.floor(Math.random() * 95000) + 5000; // 5000 to 100000 cents
  }

  private generateRandomAmountInRange(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min)) + min;
  }

  private generateRandomBitcoinPrice(): number {
    // Bitcoin price between $63,000 and $67,000 AUD
    return Math.floor(Math.random() * 4000) + 63000;
  }

  private generateRandomDate(start: Date, end: Date): Date {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }

  private determineScenario(options: {
    includeOrphanedPayments: boolean;
    includeOrphanedBitcoin: boolean;
    includeAmountMismatches: boolean;
  }): 'matched' | 'orphaned_payment' | 'amount_mismatch' {
    const scenarios: Array<'matched' | 'orphaned_payment' | 'amount_mismatch'> = ['matched'];
    
    if (options.includeOrphanedPayments) scenarios.push('orphaned_payment');
    if (options.includeAmountMismatches) scenarios.push('amount_mismatch');

    // Weight heavily towards matched transactions (80%)
    const weights = {
      matched: 0.8,
      orphaned_payment: options.includeOrphanedPayments ? 0.1 : 0,
      amount_mismatch: options.includeAmountMismatches ? 0.1 : 0
    };

    const random = Math.random();
    let cumulative = 0;

    for (const scenario of scenarios) {
      cumulative += weights[scenario];
      if (random <= cumulative) {
        return scenario;
      }
    }

    return 'matched'; // Fallback
  }

  // Utility method to create a realistic test dataset for a specific tenant
  async createRealisticDataset(tenantId: string): Promise<{
    payments: MockStripePayment[];
    bitcoinPurchases: MockBitcoinPurchase[];
    summary: string;
  }> {
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const result = await this.generateBulkTransactions({
      tenantId,
      count: 50,
      dateRange: { start: lastWeek, end: now },
      amountRange: { min: 10000, max: 200000 }, // $100 to $2000
      successRate: 0.95,
      includeOrphanedPayments: true,
      includeOrphanedBitcoin: true,
      includeAmountMismatches: true
    });

    const summary = `
Created realistic dataset for ${tenantId}:
- ${result.stats.totalPayments} Stripe payments
- ${result.stats.totalBitcoinPurchases} Bitcoin purchases
- ${result.stats.matchedPairs} perfect matches
- ${result.stats.orphanedPayments} orphaned payments (need reconciliation)
- ${result.stats.orphanedBitcoin} orphaned Bitcoin purchases
- ${result.stats.amountMismatches} amount mismatches
- Total volume: ${result.stats.totalVolume}
- Date range: ${result.stats.dateRange}
    `.trim();

    return {
      payments: result.payments,
      bitcoinPurchases: result.bitcoinPurchases,
      summary
    };
  }
}