// LIQUID ABT - Treasury Processing Engine

import { tenantSchemaManager } from '@/lib/database/connection';
import { ExchangeProviderFactory, ExchangeProvider, MarketOrderRequest, WithdrawalRequest } from '@/lib/integrations/exchanges/interface';
import { ExchangeProviderType } from '@/lib/integrations/exchanges/interface';
import { getExchangeService } from '@/lib/integrations/exchanges/exchange-factory';

export class TreasuryProcessor {
  private tenantId: string;
  private exchangeProvider?: ExchangeProvider;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Process a transaction according to tenant's treasury rules
   */
  async processTransaction(transaction: any): Promise<{ bitcoinPurchaseId?: string } | null> {
    try {
      // Check if this transaction has already been processed (idempotency check)
      const existingPurchase = await tenantSchemaManager.queryTenantSchema(
        this.tenantId,
        `SELECT id FROM bitcoin_purchases WHERE transaction_id = $1`,
        [transaction.id]
      );
      
      if (existingPurchase.length > 0) {
        console.log(`Transaction ${transaction.id} already processed - returning existing Bitcoin purchase ${existingPurchase[0].id}`);
        return { bitcoinPurchaseId: existingPurchase[0].id };
      }

      // Get tenant's treasury rules
      const treasuryRules = await this.getTreasuryRules();
      
      if (!treasuryRules || !treasuryRules.isActive) {
        console.log(`No active treasury rules for tenant ${this.tenantId}`);
        return null;
      }

      // Check if transaction meets conversion criteria
      const conversionDecision = await this.evaluateConversionRules(transaction, treasuryRules);
      
      if (!conversionDecision.shouldConvert) {
        console.log(`Transaction ${transaction.id} does not meet conversion criteria`);
        return null;
      }

      // Initialize exchange provider
      await this.initializeExchangeProvider();
      
      if (!this.exchangeProvider) {
        throw new Error('Exchange provider not available');
      }

      // Execute Bitcoin purchase
      const purchaseResult = await this.executeBitcoinPurchase(
        conversionDecision.amountToConvert,
        transaction
      );

      // Store the purchase record
      const bitcoinPurchaseId = await this.storeBitcoinPurchase({
        transactionId: transaction.id,
        amountAUD: conversionDecision.amountToConvert,
        bitcoinAmount: purchaseResult.filledAmount || purchaseResult.amount,
        price: purchaseResult.averagePrice || 0,
        orderId: purchaseResult.orderId,
        exchangeProvider: this.exchangeProvider.type,
        status: purchaseResult.status,
        fees: purchaseResult.fees,
        rawData: purchaseResult.rawData
      });

      // If customer has a withdrawal address, auto-withdraw Bitcoin
      if (treasuryRules.withdrawalAddress && purchaseResult.status === 'filled') {
        try {
          await this.withdrawBitcoinToCustomer(
            purchaseResult.filledAmount || purchaseResult.amount,
            treasuryRules.withdrawalAddress,
            bitcoinPurchaseId
          );
        } catch (error) {
          console.error(`Failed to auto-withdraw Bitcoin for purchase ${bitcoinPurchaseId}:`, error);
          // Don't throw - purchase was successful, withdrawal can be retried
        }
      }

      return { bitcoinPurchaseId };

    } catch (error) {
      console.error(`Treasury processing error for transaction ${transaction.id}:`, error);
      
      // Store failed processing attempt
      await this.storeFailedProcessing(transaction.id, error instanceof Error ? error.message : 'Unknown error');
      
      throw error;
    }
  }

  /**
   * Get tenant's treasury rules from database
   */
  private async getTreasuryRules(): Promise<TreasuryRules | null> {
    try {
      const result = await tenantSchemaManager.queryTenantSchema(
        this.tenantId,
        `SELECT * FROM treasury_rules WHERE is_active = true ORDER BY created_at DESC LIMIT 1`,
        []
      );

      if (result.length === 0) {
        return null;
      }

      const rules = result[0];
      
      return {
        id: rules.id,
        isActive: rules.is_active,
        ruleType: rules.rule_type,
        conversionPercentage: rules.conversion_percentage ? parseFloat(rules.conversion_percentage) : undefined,
        thresholdAmount: rules.threshold_amount ? parseFloat(rules.threshold_amount) : undefined,
        minimumPurchase: rules.minimum_purchase ? parseFloat(rules.minimum_purchase) : undefined,
        maximumPurchase: rules.maximum_purchase ? parseFloat(rules.maximum_purchase) : undefined,
        bufferAmount: rules.buffer_amount ? parseFloat(rules.buffer_amount) : undefined,
        withdrawalAddress: rules.withdrawal_address,
        exchangeProvider: rules.exchange_provider || 'kraken',
        isAutoWithdrawal: rules.is_auto_withdrawal || false,
        settings: rules.settings || {}
      };
    } catch (error) {
      console.error(`Failed to get treasury rules for tenant ${this.tenantId}:`, error);
      return null;
    }
  }

  /**
   * Evaluate whether transaction should be converted and how much
   */
  private async evaluateConversionRules(
    transaction: any, 
    rules: TreasuryRules
  ): Promise<ConversionDecision> {
    const transactionAmount = transaction.amount;

    switch (rules.ruleType) {
      case 'percentage':
        return this.evaluatePercentageRule(transactionAmount, rules);
        
      case 'threshold':
        return await this.evaluateThresholdRule(transactionAmount, rules);
        
      case 'fixed_dca':
        return this.evaluateFixedDCARule(transactionAmount, rules);
        
      default:
        return { shouldConvert: false, amountToConvert: 0, reason: 'Unknown rule type' };
    }
  }

  /**
   * Percentage-based conversion with threat model tier-based limits
   */
  private evaluatePercentageRule(amount: number, rules: TreasuryRules): ConversionDecision {
    const requestedPercentage = rules.conversionPercentage || 0;
    
    // Apply threat model tier-based conversion limits
    const tierLimits = this.getTierConversionLimits();
    const maxAllowedPercentage = tierLimits.maxPercentage;
    
    if (requestedPercentage > maxAllowedPercentage) {
      return {
        shouldConvert: false,
        amountToConvert: 0,
        reason: `Conversion percentage ${requestedPercentage}% exceeds tier limit of ${maxAllowedPercentage}%`
      };
    }
    
    const conversionAmount = amount * requestedPercentage / 100;
    
    // Check minimum purchase amount
    if (rules.minimumPurchase && conversionAmount < rules.minimumPurchase) {
      return {
        shouldConvert: false,
        amountToConvert: 0,
        reason: `Conversion amount $${conversionAmount} below minimum $${rules.minimumPurchase}`
      };
    }

    // Check tier-based maximum purchase amount
    const maxPurchaseAmount = Math.min(
      rules.maximumPurchase || tierLimits.maxSingleTransaction,
      tierLimits.maxSingleTransaction
    );

    if (conversionAmount > maxPurchaseAmount) {
      return {
        shouldConvert: true,
        amountToConvert: maxPurchaseAmount,
        reason: `Capped at tier maximum purchase amount $${maxPurchaseAmount}`
      };
    }

    return {
      shouldConvert: conversionAmount > 0,
      amountToConvert: conversionAmount,
      reason: `${requestedPercentage}% of $${amount} = $${conversionAmount} (within tier limits)`
    };
  }

  /**
   * Get tier-based conversion limits from CLAUDE.md subscription requirements
   */
  private getTierConversionLimits(): {
    maxPercentage: number;
    maxSingleTransaction: number;
    maxDailyVolume: number;
    maxMonthlyVolume: number;
  } {
    // STARTER PLAN (FREE) - Corrected per CLAUDE.md specs
    const starterLimits = {
      maxPercentage: 5, // 5% max conversion (corrected from 10%)
      maxSingleTransaction: 1000, // $1K max transaction
      maxDailyVolume: 5000, // $5K daily limit
      maxMonthlyVolume: 50000 // $50K monthly limit
    };

    // GROWTH PLAN ($24.99/month)
    const growthLimits = {
      maxPercentage: 100, // No percentage limit on Growth tier
      maxSingleTransaction: 10000, // $10K max transaction
      maxDailyVolume: 50000, // $50K daily limit
      maxMonthlyVolume: 500000 // $500K monthly limit
    };

    // PRO PLAN ($97.99/month)
    const proLimits = {
      maxPercentage: 100, // No percentage limit
      maxSingleTransaction: 100000, // $100K max transaction
      maxDailyVolume: 500000, // $500K daily limit
      maxMonthlyVolume: 5000000 // $5M monthly limit
    };

    // ENTERPRISE PLAN (Custom pricing)
    const enterpriseLimits = {
      maxPercentage: 100, // No limits
      maxSingleTransaction: Number.MAX_SAFE_INTEGER,
      maxDailyVolume: Number.MAX_SAFE_INTEGER,
      maxMonthlyVolume: Number.MAX_SAFE_INTEGER
    };

    // TODO: Get actual subscription tier from tenant data
    // For now, return Starter tier limits (most secure default)
    // In production, this would query the tenant's subscription tier:
    // const tier = await this.getTenantSubscriptionTier();
    // switch (tier) {
    //   case 'growth': return growthLimits;
    //   case 'pro': return proLimits;
    //   case 'enterprise': return enterpriseLimits;
    //   default: return starterLimits;
    // }

    return starterLimits;
  }

  /**
   * Threshold-based conversion (convert when balance reaches threshold)
   */
  private async evaluateThresholdRule(amount: number, rules: TreasuryRules): Promise<ConversionDecision> {
    try {
      // Get current tenant balance (sum of unconverted transactions)
      const balanceResult = await tenantSchemaManager.queryTenantSchema(
        this.tenantId,
        `SELECT COALESCE(SUM(amount), 0) as total_balance 
         FROM transactions 
         WHERE should_convert = true 
         AND status = 'succeeded'
         AND NOT EXISTS (
           SELECT 1 FROM bitcoin_purchases 
           WHERE bitcoin_purchases.transaction_id = transactions.id
         )`,
        []
      );

      const currentBalance = parseFloat(balanceResult[0]?.total_balance || 0);
      const newBalance = currentBalance + amount;

      // Check if new balance exceeds threshold
      if (newBalance >= (rules.thresholdAmount || 0)) {
        // Convert the full accumulated amount minus buffer
        const conversionAmount = newBalance - (rules.bufferAmount || 0);
        
        if (conversionAmount > 0) {
          return {
            shouldConvert: true,
            amountToConvert: conversionAmount,
            reason: `Balance $${newBalance} exceeds threshold $${rules.thresholdAmount}`
          };
        }
      }

      return {
        shouldConvert: false,
        amountToConvert: 0,
        reason: `Balance $${newBalance} below threshold $${rules.thresholdAmount}`
      };
    } catch (error) {
      console.error('Error evaluating threshold rule:', error);
      return {
        shouldConvert: false,
        amountToConvert: 0,
        reason: 'Error evaluating threshold rule'
      };
    }
  }

  /**
   * Fixed DCA rule (not transaction-based, handled by scheduler)
   */
  private evaluateFixedDCARule(amount: number, rules: TreasuryRules): ConversionDecision {
    // Fixed DCA conversions are handled by scheduled jobs, not transaction events
    return {
      shouldConvert: false,
      amountToConvert: 0,
      reason: 'Fixed DCA rules processed by scheduler'
    };
  }

  /**
   * Initialize exchange provider based on tenant settings
   */
  private async initializeExchangeProvider(): Promise<void> {
    try {
      // Get exchange credentials from tenant's integrations
      const exchangeIntegration = await tenantSchemaManager.queryTenantSchema(
        this.tenantId,
        `SELECT provider, access_token, settings FROM integrations 
         WHERE type = 'EXCHANGE' AND is_active = true 
         ORDER BY created_at DESC LIMIT 1`,
        []
      );

      if (exchangeIntegration.length === 0) {
        // Use default exchange provider from environment variables
        this.exchangeProvider = ExchangeProviderFactory.createDefault({});
        return;
      }

      const integration = exchangeIntegration[0];
      const credentials = {
        apiKey: integration.access_token,
        privateKey: integration.settings?.privateKey,
        ...integration.settings
      };

      this.exchangeProvider = ExchangeProviderFactory.create(
        integration.provider as ExchangeProviderType,
        credentials
      );
    } catch (error) {
      console.error('Failed to initialize exchange provider:', error);
      throw new Error('Exchange provider initialization failed');
    }
  }

  /**
   * Execute Bitcoin purchase on exchange
   */
  private async executeBitcoinPurchase(amountAUD: number, transaction: any) {
    // Use the exchange factory to get the appropriate service (mock or real)
    const exchange = getExchangeService();
    
    try {
      const result = await exchange.executeBuyOrder({
        amount: amountAUD,
        customerReference: `tx_${transaction.id}`,
        withdrawalAddress: undefined // Will be handled separately if needed
      });

      // Convert the exchange service response to the expected format
      return {
        orderId: result.orderId,
        amount: result.bitcoinAmount,
        filledAmount: result.bitcoinAmount,
        averagePrice: result.exchangeRate,
        status: result.success ? 'filled' : 'failed',
        fees: [{ amount: result.fees, currency: 'AUD', type: 'trading' }],
        rawData: result
      };
    } catch (error) {
      console.error('Bitcoin purchase failed:', error);
      throw new Error(`Failed to purchase Bitcoin: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Store Bitcoin purchase record in database
   */
  private async storeBitcoinPurchase(purchase: BitcoinPurchaseData): Promise<string> {
    const result = await tenantSchemaManager.queryTenantSchema(
      this.tenantId,
      `INSERT INTO bitcoin_purchases (
        transaction_id, amount_aud, bitcoin_amount, price_per_btc, 
        exchange_order_id, exchange_provider, status, fees_aud,
        raw_exchange_data, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (transaction_id) 
      DO NOTHING
      RETURNING id`,
      [
        purchase.transactionId,
        purchase.amountAUD,
        purchase.bitcoinAmount,
        purchase.price,
        purchase.orderId,
        purchase.exchangeProvider,
        purchase.status,
        purchase.fees?.reduce((sum, fee) => sum + fee.amount, 0) || 0,
        JSON.stringify(purchase.rawData)
      ]
    );

    // If no rows returned due to conflict, get the existing record
    if (result.length === 0) {
      const existingResult = await tenantSchemaManager.queryTenantSchema(
        this.tenantId,
        `SELECT id FROM bitcoin_purchases WHERE transaction_id = $1`,
        [purchase.transactionId]
      );
      
      if (existingResult.length > 0) {
        console.log(`Duplicate transaction ${purchase.transactionId} detected - returning existing Bitcoin purchase ${existingResult[0].id}`);
        return existingResult[0].id;
      } else {
        throw new Error('Failed to create or retrieve Bitcoin purchase record');
      }
    }

    return result[0].id;
  }

  /**
   * Withdraw Bitcoin to customer's address
   */
  private async withdrawBitcoinToCustomer(
    bitcoinAmount: number,
    address: string,
    purchaseId: string
  ): Promise<void> {
    if (!this.exchangeProvider) {
      throw new Error('Exchange provider not initialized');
    }

    const withdrawalRequest: WithdrawalRequest = {
      currency: 'BTC',
      amount: bitcoinAmount,
      address: address,
      description: `LIQUID ABT auto-withdrawal for purchase ${purchaseId}`,
      validateAddress: true
    };

    try {
      const withdrawalResult = await this.exchangeProvider.withdrawBitcoin(withdrawalRequest);
      
      // Store withdrawal record
      await tenantSchemaManager.queryTenantSchema(
        this.tenantId,
        `INSERT INTO bitcoin_withdrawals (
          bitcoin_purchase_id, withdrawal_id, amount, address, status,
          exchange_provider, tx_id, fees_btc, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          purchaseId,
          withdrawalResult.withdrawalId,
          withdrawalResult.amount,
          withdrawalResult.address,
          withdrawalResult.status,
          this.exchangeProvider.type,
          withdrawalResult.txId,
          withdrawalResult.fees.find(f => f.currency === 'BTC')?.amount || 0
        ]
      );

      console.log(`Bitcoin withdrawal initiated: ${withdrawalResult.withdrawalId}`);
    } catch (error) {
      console.error('Bitcoin withdrawal failed:', error);
      
      // Store failed withdrawal attempt
      await tenantSchemaManager.queryTenantSchema(
        this.tenantId,
        `INSERT INTO bitcoin_withdrawals (
          bitcoin_purchase_id, amount, address, status, error_message,
          created_at, updated_at
        ) VALUES ($1, $2, $3, 'failed', $4, NOW(), NOW())`,
        [purchaseId, bitcoinAmount, address, error instanceof Error ? error.message : 'Unknown error']
      );
      
      throw error;
    }
  }

  /**
   * Store failed processing attempt
   */
  private async storeFailedProcessing(transactionId: string, errorMessage: string): Promise<void> {
    try {
      await tenantSchemaManager.queryTenantSchema(
        this.tenantId,
        `INSERT INTO processing_failures (
          transaction_id, error_message, retry_count, created_at
        ) VALUES ($1, $2, 0, NOW())
        ON CONFLICT (transaction_id) 
        DO UPDATE SET 
          retry_count = processing_failures.retry_count + 1,
          error_message = $2,
          updated_at = NOW()`,
        [transactionId, errorMessage]
      );
    } catch (error) {
      console.error('Failed to store processing failure:', error);
    }
  }
}

// Type definitions

interface TreasuryRules {
  id: string;
  isActive: boolean;
  ruleType: 'percentage' | 'threshold' | 'fixed_dca' | 'market_timing';
  conversionPercentage?: number; // For percentage rules
  thresholdAmount?: number; // For threshold rules
  minimumPurchase?: number;
  maximumPurchase?: number;
  bufferAmount?: number; // Cash buffer to maintain
  withdrawalAddress?: string; // Customer's Bitcoin address
  exchangeProvider: ExchangeProviderType;
  isAutoWithdrawal: boolean;
  settings: Record<string, any>;
}

interface ConversionDecision {
  shouldConvert: boolean;
  amountToConvert: number;
  reason: string;
}

interface BitcoinPurchaseData {
  transactionId: string;
  amountAUD: number;
  bitcoinAmount: number;
  price: number;
  orderId: string;
  exchangeProvider: string;
  status: string;
  fees?: Array<{ amount: number; currency: string; type: string }>;
  rawData: any;
}