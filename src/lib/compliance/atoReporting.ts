// LIQUID ABT - ATO (Australian Taxation Office) Compliance
// Capital Gains Tax (CGT) calculations, BAS reporting, and ATO-compliant record keeping

import { appLogger, LogCategory } from '../logging/logger';

// CGT calculation methods as per ATO guidelines
export enum CGTMethod {
  FIFO = 'fifo',           // First In, First Out
  LIFO = 'lifo',           // Last In, First Out  
  WEIGHTED_AVERAGE = 'weighted_average',
  SPECIFIC_IDENTIFICATION = 'specific_identification'
}

// Transaction types for tax purposes
export enum TransactionType {
  PURCHASE = 'purchase',           // Acquiring Bitcoin
  SALE = 'sale',                  // Disposing of Bitcoin
  TRANSFER_IN = 'transfer_in',    // Receiving Bitcoin
  TRANSFER_OUT = 'transfer_out',  // Sending Bitcoin
  MINING_REWARD = 'mining_reward', // Mining (not applicable for LIQUID ABT)
  FORK = 'fork',                  // Hard fork events
  AIRDROP = 'airdrop'            // Airdrops
}

// Tax event interface
export interface TaxEvent {
  id: string;
  tenantId: string;
  transactionId: string;
  eventType: TransactionType;
  timestamp: Date;
  bitcoinAmount: number;
  audPrice: number;           // Price in AUD at time of transaction
  audValue: number;           // Total AUD value
  costBasis?: number;         // For disposals
  capitalGain?: number;       // For disposals
  taxYear: string;            // Financial year (e.g., "2024-2025")
  description: string;
  exchangeProvider?: string;
  originalTransactionHash?: string;
}

// CGT calculation result
export interface CGTCalculation {
  totalCapitalGain: number;
  totalCapitalLoss: number;
  netCapitalGain: number;
  method: CGTMethod;
  taxYear: string;
  events: Array<{
    eventId: string;
    disposal: TaxEvent;
    acquisition: TaxEvent;
    costBasis: number;
    capitalGain: number;
    discountApplicable: boolean;
  }>;
}

// BAS (Business Activity Statement) data
export interface BASData {
  taxYear: string;
  quarter: string;
  totalSales: number;
  totalPurchases: number;
  gstOnSales: number;
  gstOnPurchases: number;
  payg: number;
  businessIncome: number;
  businessExpenses: number;
  capitalGains: number;
}

// ATO report types
export enum ATOReportType {
  CGT_SCHEDULE = 'cgt_schedule',
  BAS_QUARTERLY = 'bas_quarterly',
  ANNUAL_SUMMARY = 'annual_summary',
  TRANSACTION_LISTING = 'transaction_listing'
}

export class ATOComplianceService {
  private static instance: ATOComplianceService;

  private constructor() {}

  public static getInstance(): ATOComplianceService {
    if (!ATOComplianceService.instance) {
      ATOComplianceService.instance = new ATOComplianceService();
    }
    return ATOComplianceService.instance;
  }

  /**
   * Calculate CGT for a tenant's Bitcoin disposals
   */
  async calculateCGT(
    tenantId: string,
    taxYear: string,
    method: CGTMethod = CGTMethod.FIFO
  ): Promise<CGTCalculation> {
    appLogger.info('Starting CGT calculation', {
      category: LogCategory.COMPLIANCE,
      action: 'cgt_calculation_start',
      tenantId,
      metadata: { taxYear, method }
    });

    try {
      // Get all tax events for the tenant and tax year
      const events = await this.getTaxEvents(tenantId, taxYear);
      
      // Separate acquisitions and disposals
      const acquisitions = events.filter(e => 
        [TransactionType.PURCHASE, TransactionType.TRANSFER_IN, TransactionType.MINING_REWARD].includes(e.eventType)
      );
      
      const disposals = events.filter(e => 
        [TransactionType.SALE, TransactionType.TRANSFER_OUT].includes(e.eventType)
      );

      // Sort acquisitions by date for FIFO/LIFO
      acquisitions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      if (method === CGTMethod.LIFO) {
        acquisitions.reverse();
      }

      const cgtEvents: CGTCalculation['events'] = [];
      let totalCapitalGain = 0;
      let totalCapitalLoss = 0;

      // Process each disposal
      for (const disposal of disposals) {
        const cgtEvent = await this.calculateDisposalCGT(
          disposal,
          acquisitions,
          method
        );
        
        cgtEvents.push(cgtEvent);
        
        if (cgtEvent.capitalGain > 0) {
          totalCapitalGain += cgtEvent.capitalGain;
        } else {
          totalCapitalLoss += Math.abs(cgtEvent.capitalGain);
        }
      }

      const result: CGTCalculation = {
        totalCapitalGain,
        totalCapitalLoss,
        netCapitalGain: totalCapitalGain - totalCapitalLoss,
        method,
        taxYear,
        events: cgtEvents
      };

      appLogger.info('CGT calculation completed', {
        category: LogCategory.COMPLIANCE,
        action: 'cgt_calculation_complete',
        tenantId,
        metadata: {
          netCapitalGain: result.netCapitalGain,
          totalEvents: cgtEvents.length
        }
      });

      return result;

    } catch (error) {
      appLogger.error('CGT calculation failed', {
        category: LogCategory.COMPLIANCE,
        action: 'cgt_calculation_error',
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate BAS data for a quarter
   */
  async generateBASData(
    tenantId: string,
    taxYear: string,
    quarter: string
  ): Promise<BASData> {
    appLogger.info('Generating BAS data', {
      category: LogCategory.COMPLIANCE,
      action: 'bas_generation_start',
      tenantId,
      metadata: { taxYear, quarter }
    });

    // Get quarter date range
    const { startDate, endDate } = this.getQuarterDateRange(taxYear, quarter);
    
    // Get transactions for the quarter
    const events = await this.getTaxEventsInRange(tenantId, startDate, endDate);
    
    // Calculate BAS components
    const sales = events
      .filter(e => e.eventType === TransactionType.SALE)
      .reduce((sum, e) => sum + e.audValue, 0);

    const purchases = events
      .filter(e => e.eventType === TransactionType.PURCHASE)
      .reduce((sum, e) => sum + e.audValue, 0);

    // GST calculations (Bitcoin purchases/sales are generally GST-free for investment purposes)
    const gstOnSales = 0; // Bitcoin sales are typically GST-free
    const gstOnPurchases = 0; // Bitcoin purchases are typically GST-free

    // Business income and expenses
    const businessIncome = sales;
    const businessExpenses = purchases;

    // Capital gains for the quarter
    const cgtData = await this.calculateCGT(tenantId, taxYear);
    const quarterCapitalGains = this.getQuarterCapitalGains(cgtData, startDate, endDate);

    const basData: BASData = {
      taxYear,
      quarter,
      totalSales: sales,
      totalPurchases: purchases,
      gstOnSales,
      gstOnPurchases,
      payg: 0, // PAYG would be calculated based on business structure
      businessIncome,
      businessExpenses,
      capitalGains: quarterCapitalGains
    };

    appLogger.info('BAS data generated', {
      category: LogCategory.COMPLIANCE,
      action: 'bas_generation_complete',
      tenantId,
      metadata: basData
    });

    return basData;
  }

  /**
   * Generate ATO-compliant report
   */
  async generateATOReport(
    tenantId: string,
    reportType: ATOReportType,
    taxYear: string,
    format: 'csv' | 'pdf' = 'csv'
  ): Promise<{ content: string; filename: string; mimeType: string }> {
    appLogger.info('Generating ATO report', {
      category: LogCategory.COMPLIANCE,
      action: 'ato_report_generation',
      tenantId,
      metadata: { reportType, taxYear, format }
    });

    switch (reportType) {
      case ATOReportType.CGT_SCHEDULE:
        return this.generateCGTScheduleReport(tenantId, taxYear, format);
      
      case ATOReportType.TRANSACTION_LISTING:
        return this.generateTransactionListingReport(tenantId, taxYear, format);
      
      case ATOReportType.ANNUAL_SUMMARY:
        return this.generateAnnualSummaryReport(tenantId, taxYear, format);
      
      default:
        throw new Error(`Unsupported report type: ${reportType}`);
    }
  }

  /**
   * Implement 7-year data retention policy check
   */
  async enforceDataRetentionPolicy(): Promise<{
    recordsToArchive: number;
    recordsToDelete: number;
    oldestRecord: Date;
  }> {
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

    // In a real implementation, this would query the database
    // For now, return mock data
    return {
      recordsToArchive: 0,
      recordsToDelete: 0,
      oldestRecord: new Date()
    };
  }

  /**
   * Validate tax calculations against ATO rules
   */
  async validateTaxCalculation(calculation: CGTCalculation): Promise<{
    isValid: boolean;
    warnings: string[];
    errors: string[];
  }> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check for CGT discount eligibility (12+ months holding)
    calculation.events.forEach(event => {
      const holdingPeriod = event.disposal.timestamp.getTime() - event.acquisition.timestamp.getTime();
      const daysHeld = holdingPeriod / (1000 * 60 * 60 * 24);
      
      if (daysHeld >= 365 && !event.discountApplicable) {
        warnings.push(`Event ${event.eventId} may be eligible for 50% CGT discount (held for ${Math.round(daysHeld)} days)`);
      }
      
      if (event.capitalGain < 0 && event.discountApplicable) {
        errors.push(`Event ${event.eventId} has negative capital gain but discount applied`);
      }
    });

    // Check for unusual patterns
    if (calculation.netCapitalGain < -100000) {
      warnings.push('Large capital loss detected - ensure proper documentation');
    }

    if (calculation.events.length === 0) {
      warnings.push('No CGT events found for the tax year');
    }

    return {
      isValid: errors.length === 0,
      warnings,
      errors
    };
  }

  // Private helper methods

  private async getTaxEvents(tenantId: string, taxYear: string): Promise<TaxEvent[]> {
    // In a real implementation, this would query the database
    // Mock data for now
    return [];
  }

  private async getTaxEventsInRange(
    tenantId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<TaxEvent[]> {
    // In a real implementation, this would query the database
    return [];
  }

  private async calculateDisposalCGT(
    disposal: TaxEvent,
    acquisitions: TaxEvent[],
    method: CGTMethod
  ): Promise<CGTCalculation['events'][0]> {
    // Find matching acquisition(s) based on method
    let costBasis = 0;
    let matchedAcquisition: TaxEvent;

    switch (method) {
      case CGTMethod.FIFO:
        matchedAcquisition = acquisitions.find(a => a.bitcoinAmount >= disposal.bitcoinAmount) || acquisitions[0];
        costBasis = matchedAcquisition ? matchedAcquisition.audPrice * disposal.bitcoinAmount : 0;
        break;

      case CGTMethod.WEIGHTED_AVERAGE:
        const totalAcquisitions = acquisitions.reduce((sum, a) => sum + a.bitcoinAmount, 0);
        const totalCost = acquisitions.reduce((sum, a) => sum + a.audValue, 0);
        const avgCostPerBTC = totalCost / totalAcquisitions;
        costBasis = avgCostPerBTC * disposal.bitcoinAmount;
        matchedAcquisition = acquisitions[0]; // Use first acquisition for tracking
        break;

      default:
        matchedAcquisition = acquisitions[0];
        costBasis = matchedAcquisition ? matchedAcquisition.audValue : 0;
        break;
    }

    const capitalGain = disposal.audValue - costBasis;
    
    // Check if eligible for 50% CGT discount (held for 12+ months)
    const holdingPeriod = disposal.timestamp.getTime() - (matchedAcquisition?.timestamp.getTime() || 0);
    const discountApplicable = holdingPeriod >= (365 * 24 * 60 * 60 * 1000);

    return {
      eventId: disposal.id,
      disposal,
      acquisition: matchedAcquisition!,
      costBasis,
      capitalGain: discountApplicable && capitalGain > 0 ? capitalGain * 0.5 : capitalGain,
      discountApplicable
    };
  }

  private getQuarterDateRange(taxYear: string, quarter: string): { startDate: Date; endDate: Date } {
    const [startYear] = taxYear.split('-').map(Number);
    
    const quarters = {
      'Q1': { start: new Date(startYear, 6, 1), end: new Date(startYear, 8, 30) },   // Jul-Sep
      'Q2': { start: new Date(startYear, 9, 1), end: new Date(startYear, 11, 31) }, // Oct-Dec
      'Q3': { start: new Date(startYear + 1, 0, 1), end: new Date(startYear + 1, 2, 31) }, // Jan-Mar
      'Q4': { start: new Date(startYear + 1, 3, 1), end: new Date(startYear + 1, 5, 30) }  // Apr-Jun
    };

    return {
      startDate: quarters[quarter as keyof typeof quarters].start,
      endDate: quarters[quarter as keyof typeof quarters].end
    };
  }

  private getQuarterCapitalGains(
    cgtData: CGTCalculation,
    startDate: Date,
    endDate: Date
  ): number {
    return cgtData.events
      .filter(event => {
        const disposalDate = event.disposal.timestamp;
        return disposalDate >= startDate && disposalDate <= endDate;
      })
      .reduce((sum, event) => sum + event.capitalGain, 0);
  }

  private async generateCGTScheduleReport(
    tenantId: string,
    taxYear: string,
    format: 'csv' | 'pdf'
  ): Promise<{ content: string; filename: string; mimeType: string }> {
    const cgtData = await this.calculateCGT(tenantId, taxYear);
    
    if (format === 'csv') {
      const csvHeaders = [
        'Disposal Date',
        'Asset Description',
        'Disposal Proceeds (AUD)',
        'Cost Base (AUD)',
        'Capital Gain/Loss (AUD)',
        'Discount Applied',
        'Net Capital Gain/Loss (AUD)'
      ].join(',');

      const csvRows = cgtData.events.map(event => [
        event.disposal.timestamp.toISOString().split('T')[0],
        `${event.disposal.bitcoinAmount} BTC`,
        event.disposal.audValue.toFixed(2),
        event.costBasis.toFixed(2),
        (event.disposal.audValue - event.costBasis).toFixed(2),
        event.discountApplicable ? 'Yes' : 'No',
        event.capitalGain.toFixed(2)
      ].join(','));

      const content = [csvHeaders, ...csvRows].join('\n');

      return {
        content,
        filename: `cgt_schedule_${tenantId}_${taxYear}.csv`,
        mimeType: 'text/csv'
      };
    }

    // PDF generation would be implemented here
    throw new Error('PDF format not yet implemented');
  }

  private async generateTransactionListingReport(
    tenantId: string,
    taxYear: string,
    format: 'csv' | 'pdf'
  ): Promise<{ content: string; filename: string; mimeType: string }> {
    const events = await this.getTaxEvents(tenantId, taxYear);
    
    if (format === 'csv') {
      const csvHeaders = [
        'Date',
        'Transaction Type',
        'Bitcoin Amount',
        'AUD Price',
        'AUD Value',
        'Exchange',
        'Transaction ID',
        'Description'
      ].join(',');

      const csvRows = events.map(event => [
        event.timestamp.toISOString().split('T')[0],
        event.eventType,
        event.bitcoinAmount.toFixed(8),
        event.audPrice.toFixed(2),
        event.audValue.toFixed(2),
        event.exchangeProvider || 'N/A',
        event.transactionId,
        `"${event.description}"`
      ].join(','));

      const content = [csvHeaders, ...csvRows].join('\n');

      return {
        content,
        filename: `transaction_listing_${tenantId}_${taxYear}.csv`,
        mimeType: 'text/csv'
      };
    }

    throw new Error('PDF format not yet implemented');
  }

  private async generateAnnualSummaryReport(
    tenantId: string,
    taxYear: string,
    format: 'csv' | 'pdf'
  ): Promise<{ content: string; filename: string; mimeType: string }> {
    const cgtData = await this.calculateCGT(tenantId, taxYear);
    const events = await this.getTaxEvents(tenantId, taxYear);

    const summary = {
      taxYear,
      totalTransactions: events.length,
      totalPurchases: events.filter(e => e.eventType === TransactionType.PURCHASE).length,
      totalSales: events.filter(e => e.eventType === TransactionType.SALE).length,
      totalCapitalGain: cgtData.totalCapitalGain,
      totalCapitalLoss: cgtData.totalCapitalLoss,
      netCapitalPosition: cgtData.netCapitalGain,
      cgtMethod: cgtData.method
    };

    if (format === 'csv') {
      const content = Object.entries(summary)
        .map(([key, value]) => `${key},${value}`)
        .join('\n');

      return {
        content,
        filename: `annual_summary_${tenantId}_${taxYear}.csv`,
        mimeType: 'text/csv'
      };
    }

    throw new Error('PDF format not yet implemented');
  }
}

// Singleton instance
export const atoComplianceService = ATOComplianceService.getInstance();

// Utility functions for ATO compliance

/**
 * Get the current Australian financial year
 */
export function getCurrentAustralianFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based

  if (month >= 6) { // July (6) onwards
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

/**
 * Check if a transaction amount requires ATO reporting
 */
export function requiresATOReporting(audAmount: number): boolean {
  // Transactions over $10,000 AUD may require reporting
  return audAmount > 10000;
}

/**
 * Calculate Bitcoin holding period for CGT discount eligibility
 */
export function calculateHoldingPeriod(
  acquisitionDate: Date,
  disposalDate: Date
): { days: number; eligible50PercentDiscount: boolean } {
  const diffTime = disposalDate.getTime() - acquisitionDate.getTime();
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return {
    days,
    eligible50PercentDiscount: days >= 365
  };
}

/**
 * Format currency for ATO reports
 */
export function formatAUDForATO(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Validate ABN (Australian Business Number)
 */
export function validateABN(abn: string): boolean {
  // Remove spaces and validate format
  const cleanABN = abn.replace(/\s/g, '');
  
  if (!/^\d{11}$/.test(cleanABN)) {
    return false;
  }

  // ABN check digit algorithm
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const digits = cleanABN.split('').map(Number);
  
  // Subtract 1 from first digit
  digits[0] = digits[0] - 1;
  
  // Calculate weighted sum
  const sum = digits.reduce((acc, digit, index) => acc + (digit * weights[index]), 0);
  
  // Check if divisible by 89
  return sum % 89 === 0;
}