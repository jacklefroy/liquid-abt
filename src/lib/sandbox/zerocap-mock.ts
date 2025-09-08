interface BitcoinBuyOrder {
  amount: number; // AUD amount
  customerReference?: string;
  withdrawalAddress?: string;
}

interface BitcoinBuyResult {
  success: boolean;
  orderId: string;
  bitcoinAmount: number;
  fiatAmount: number;
  exchangeRate: number;
  fees: number;
  timestamp: string;
  error?: string;
}

interface MarketPrice {
  price: number; // AUD per BTC
  timestamp: string;
  source: 'mock';
}

interface WithdrawalRequest {
  bitcoinAmount: number;
  destinationAddress: string;
  customerReference?: string;
}

interface WithdrawalResult {
  success: boolean;
  withdrawalId: string;
  bitcoinAmount: number;
  fees: number;
  estimatedConfirmationTime: string;
  error?: string;
}

interface TransactionStatus {
  orderId: string;
  status: 'pending' | 'confirmed' | 'completed' | 'failed';
  bitcoinAmount?: number;
  confirmations?: number;
  txHash?: string;
  error?: string;
}

interface MockTransaction {
  id: string;
  type: 'buy' | 'withdrawal' | 'price_check';
  timestamp: string;
  data: any;
  result: any;
  success: boolean;
}

export class ZeroCapMock {
  private baseBtcPrice: number;
  private successRate: number;
  private networkDelayMs: number;
  private transactions: MockTransaction[] = [];

  constructor() {
    this.baseBtcPrice = parseFloat(process.env.MOCK_BTC_PRICE || '65000');
    this.successRate = parseFloat(process.env.MOCK_SUCCESS_RATE || '0.95');
    this.networkDelayMs = parseInt(process.env.MOCK_NETWORK_DELAY_MS || '1000');
  }

  private async simulateNetworkDelay(): Promise<void> {
    const delay = this.networkDelayMs + (Math.random() * 500); // Add some variation
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private getCurrentPrice(): number {
    // Simulate ±2% price fluctuation
    const fluctuation = (Math.random() - 0.5) * 0.04; // ±2%
    return Math.round(this.baseBtcPrice * (1 + fluctuation));
  }

  private generateOrderId(): string {
    return `MOCK_ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  private generateWithdrawalId(): string {
    return `MOCK_WD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  private generateTxHash(): string {
    return `mock_tx_${Math.random().toString(36).substr(2, 32)}`;
  }

  private shouldSucceed(): boolean {
    return Math.random() < this.successRate;
  }

  private getRandomError(): string {
    const errors = [
      'Insufficient market liquidity',
      'Daily volume limit exceeded',
      'Temporary service maintenance',
      'Invalid customer reference',
      'Price volatility too high'
    ];
    return errors[Math.floor(Math.random() * errors.length)];
  }

  private logTransaction(type: MockTransaction['type'], data: any, result: any, success: boolean): void {
    const transaction: MockTransaction = {
      id: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      timestamp: new Date().toISOString(),
      data,
      result,
      success
    };

    this.transactions.push(transaction);

    // Keep only last 1000 transactions to prevent memory issues
    if (this.transactions.length > 1000) {
      this.transactions = this.transactions.slice(-1000);
    }

    // Log to console for debugging
    console.log(`[ZeroCap Mock] ${type.toUpperCase()}: ${success ? 'SUCCESS' : 'FAILED'}`, {
      orderId: result.orderId || result.withdrawalId,
      amount: data.amount || data.bitcoinAmount,
      error: result.error
    });
  }

  async executeBuyOrder(order: BitcoinBuyOrder): Promise<BitcoinBuyResult> {
    await this.simulateNetworkDelay();

    const orderId = this.generateOrderId();
    const currentPrice = this.getCurrentPrice();
    const timestamp = new Date().toISOString();
    const success = this.shouldSucceed();

    if (!success) {
      const result: BitcoinBuyResult = {
        success: false,
        orderId,
        bitcoinAmount: 0,
        fiatAmount: order.amount,
        exchangeRate: currentPrice,
        fees: 0,
        timestamp,
        error: this.getRandomError()
      };

      this.logTransaction('buy', order, result, false);
      return result;
    }

    // Calculate fees (0.5% of order amount)
    const fees = Math.round(order.amount * 0.005 * 100) / 100;
    const netAmount = order.amount - fees;
    const bitcoinAmount = netAmount / currentPrice;

    const result: BitcoinBuyResult = {
      success: true,
      orderId,
      bitcoinAmount: Math.round(bitcoinAmount * 100000000) / 100000000, // 8 decimal places
      fiatAmount: order.amount,
      exchangeRate: currentPrice,
      fees,
      timestamp
    };

    this.logTransaction('buy', order, result, true);
    return result;
  }

  async getMarketPrice(): Promise<MarketPrice> {
    await this.simulateNetworkDelay();

    const price = this.getCurrentPrice();
    const timestamp = new Date().toISOString();

    const result: MarketPrice = {
      price,
      timestamp,
      source: 'mock'
    };

    this.logTransaction('price_check', {}, result, true);
    return result;
  }

  async withdrawToWallet(withdrawal: WithdrawalRequest): Promise<WithdrawalResult> {
    await this.simulateNetworkDelay();

    const withdrawalId = this.generateWithdrawalId();
    const success = this.shouldSucceed();

    if (!success) {
      const result: WithdrawalResult = {
        success: false,
        withdrawalId,
        bitcoinAmount: withdrawal.bitcoinAmount,
        fees: 0,
        estimatedConfirmationTime: '',
        error: this.getRandomError()
      };

      this.logTransaction('withdrawal', withdrawal, result, false);
      return result;
    }

    // Mock withdrawal fee (0.0005 BTC)
    const withdrawalFee = 0.0005;
    const netBitcoinAmount = withdrawal.bitcoinAmount - withdrawalFee;

    // Estimate confirmation time (10-60 minutes)
    const confirmationMinutes = Math.floor(Math.random() * 50) + 10;
    const estimatedTime = new Date(Date.now() + confirmationMinutes * 60000).toISOString();

    const result: WithdrawalResult = {
      success: true,
      withdrawalId,
      bitcoinAmount: netBitcoinAmount,
      fees: withdrawalFee,
      estimatedConfirmationTime: estimatedTime
    };

    this.logTransaction('withdrawal', withdrawal, result, true);
    return result;
  }

  async getTransactionStatus(orderId: string): Promise<TransactionStatus> {
    await this.simulateNetworkDelay();

    // Find the original transaction
    const originalTransaction = this.transactions.find(tx => 
      tx.result.orderId === orderId || tx.result.withdrawalId === orderId
    );

    if (!originalTransaction) {
      return {
        orderId,
        status: 'failed',
        error: 'Order not found'
      };
    }

    if (!originalTransaction.success) {
      return {
        orderId,
        status: 'failed',
        error: originalTransaction.result.error
      };
    }

    // Simulate transaction progression
    const transactionAge = Date.now() - new Date(originalTransaction.timestamp).getTime();
    const ageMinutes = transactionAge / (1000 * 60);

    let status: TransactionStatus['status'];
    let confirmations = 0;
    let txHash: string | undefined;

    if (ageMinutes < 5) {
      status = 'pending';
    } else if (ageMinutes < 30) {
      status = 'confirmed';
      confirmations = Math.floor(Math.random() * 6) + 1; // 1-6 confirmations
      txHash = this.generateTxHash();
    } else {
      status = 'completed';
      confirmations = 6;
      txHash = this.generateTxHash();
    }

    return {
      orderId,
      status,
      bitcoinAmount: originalTransaction.result.bitcoinAmount,
      confirmations,
      txHash
    };
  }

  // Utility methods for testing and debugging
  getTransactionHistory(): MockTransaction[] {
    return [...this.transactions];
  }

  clearTransactionHistory(): void {
    this.transactions = [];
  }

  getStats(): {
    totalTransactions: number;
    successfulTransactions: number;
    failedTransactions: number;
    successRate: number;
    averagePrice: number;
    totalVolume: number;
  } {
    const successful = this.transactions.filter(tx => tx.success).length;
    const failed = this.transactions.length - successful;
    
    const buyTransactions = this.transactions.filter(tx => tx.type === 'buy' && tx.success);
    const totalVolume = buyTransactions.reduce((sum, tx) => sum + (tx.data.amount || 0), 0);
    const averagePrice = buyTransactions.length > 0 
      ? buyTransactions.reduce((sum, tx) => sum + tx.result.exchangeRate, 0) / buyTransactions.length
      : this.baseBtcPrice;

    return {
      totalTransactions: this.transactions.length,
      successfulTransactions: successful,
      failedTransactions: failed,
      successRate: this.transactions.length > 0 ? successful / this.transactions.length : 0,
      averagePrice: Math.round(averagePrice),
      totalVolume: Math.round(totalVolume * 100) / 100
    };
  }

  // Configuration methods
  setBaseBtcPrice(price: number): void {
    this.baseBtcPrice = price;
  }

  setSuccessRate(rate: number): void {
    this.successRate = Math.max(0, Math.min(1, rate));
  }

  setNetworkDelay(delayMs: number): void {
    this.networkDelayMs = Math.max(0, delayMs);
  }
}

// Singleton instance
export const zeroCapMock = new ZeroCapMock();