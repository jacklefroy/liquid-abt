// LIQUID ABT - Mock Exchange Provider Tests

import { MockExchangeProvider, MockExchangeConfig } from '../../index';
import MockScenarios, { ScenarioFactory, TestSuites } from '../../scenarios';
import {
  ExchangeError,
  InsufficientFundsError,
  InvalidAddressError,
  OrderRejectedError,
  MarketOrderRequest,
  WithdrawalRequest
} from '../../../interface';

describe('MockExchangeProvider', () => {
  let mockProvider: MockExchangeProvider;

  beforeEach(() => {
    mockProvider = new MockExchangeProvider();
  });

  afterEach(() => {
    mockProvider.reset();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with default configuration', () => {
      expect(mockProvider.name).toBe('Mock Exchange');
      expect(mockProvider.type).toBe('mock');
    });

    it('should apply custom configuration', () => {
      const config: MockExchangeConfig = {
        mockPrice: 60000,
        mockBalance: { aud: 25000, btc: 1.5 },
        networkLatencyMs: 200
      };

      const customProvider = new MockExchangeProvider(config);
      const state = customProvider.getMockState();
      
      expect(state.balance.aud).toBe(25000);
      expect(state.balance.btc).toBe(1.5);
      expect(state.config.mockPrice).toBe(60000);
      expect(state.config.networkLatencyMs).toBe(200);
    });

    it('should update configuration dynamically', () => {
      mockProvider.updateConfig({ mockPrice: 70000 });
      const state = mockProvider.getMockState();
      expect(state.config.mockPrice).toBe(70000);
    });

    it('should reset to initial state', () => {
      // Create some state
      mockProvider.setBalance(1000, 0.1);
      
      // Reset
      mockProvider.reset();
      
      const state = mockProvider.getMockState();
      expect(state.balance.aud).toBe(50000); // Default
      expect(state.balance.btc).toBe(0.5); // Default
      expect(state.orders.length).toBe(0);
      expect(state.withdrawals.length).toBe(0);
    });
  });

  describe('Price Service', () => {
    it('should return mock price with variation', async () => {
      const price1 = await mockProvider.getCurrentPrice('AUD');
      const price2 = await mockProvider.getCurrentPrice('AUD');
      
      expect(price1.symbol).toBe('BTC');
      expect(price1.currency).toBe('AUD');
      expect(price1.price).toBeGreaterThan(49000); // Base 50k ± variation
      expect(price1.price).toBeLessThan(51000);
      expect(price1.timestamp).toBeInstanceOf(Date);
      expect(price1.bid).toBeLessThan(price1.price);
      expect(price1.ask).toBeGreaterThan(price1.price);
      
      // Prices should vary between calls due to random variation
      expect(price1.price).not.toBe(price2.price);
    });

    it('should handle price service failure', async () => {
      mockProvider.updateConfig({ shouldFailGetPrice: true });
      
      await expect(mockProvider.getCurrentPrice()).rejects.toThrow(
        new ExchangeError('Mock: Price service unavailable', 'PRICE_FETCH_ERROR')
      );
    });

    it('should simulate network latency', async () => {
      mockProvider.updateConfig({ networkLatencyMs: 100 });
      
      const startTime = Date.now();
      await mockProvider.getCurrentPrice();
      const elapsed = Date.now() - startTime;
      
      expect(elapsed).toBeGreaterThanOrEqual(99); // Allow for slight timing variations
    });

    it('should handle rate limiting', async () => {
      mockProvider.updateConfig({ simulateRateLimit: true });
      
      await expect(mockProvider.getCurrentPrice()).rejects.toThrow(
        new ExchangeError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED')
      );
    });
  });

  describe('Order Book Service', () => {
    it('should return realistic order book data', async () => {
      const orderBook = await mockProvider.getOrderBook('XBTAUD');
      
      expect(orderBook.symbol).toBe('XBTAUD');
      expect(orderBook.bids).toHaveLength(10);
      expect(orderBook.asks).toHaveLength(10);
      expect(orderBook.timestamp).toBeInstanceOf(Date);
      
      // Bids should be below asks
      const highestBid = Math.max(...orderBook.bids.map(([price]) => price));
      const lowestAsk = Math.min(...orderBook.asks.map(([price]) => price));
      expect(highestBid).toBeLessThan(lowestAsk);
      
      // Should have realistic volumes
      orderBook.bids.forEach(([price, volume]) => {
        expect(price).toBeGreaterThan(0);
        expect(volume).toBeGreaterThan(0);
        expect(volume).toBeLessThan(5); // Reasonable volume
      });
    });
  });

  describe('Market Orders', () => {
    it('should execute market buy order successfully', async () => {
      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        value: 5000,
        currency: 'AUD'
      };

      const result = await mockProvider.createMarketOrder(order);
      
      expect(result.orderId).toMatch(/^MOCK_\d+$/);
      expect(result.status).toBe('filled');
      expect(result.side).toBe('buy');
      expect(result.symbol).toBe('BTC');
      expect(result.totalValue).toBe(5000);
      expect(result.amount).toBeCloseTo(5000 / 50000, 6); // amount = value / price
      expect(result.filledAmount).toBe(result.amount);
      expect(result.remainingAmount).toBe(0);
      expect(result.fees).toHaveLength(1);
      expect(result.fees![0].amount).toBeCloseTo(10, 1); // 0.2% of 5000
      
      // Check balance was updated
      const balance = await mockProvider.getBalance();
      expect(balance.available).toBeLessThan(50000); // Started with 50k
      expect(balance.btc!.available).toBeGreaterThan(0.5); // Started with 0.5
    });

    it('should execute market buy order with amount', async () => {
      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        currency: 'AUD'
      };

      const result = await mockProvider.createMarketOrder(order);
      
      expect(result.amount).toBe(0.1);
      expect(result.totalValue).toBeCloseTo(5000, 100); // 0.1 * ~50000
    });

    it('should handle partial fills', async () => {
      mockProvider.updateConfig({ orderFillRate: 0.5 });
      
      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.2,
        currency: 'AUD'
      };

      const result = await mockProvider.createMarketOrder(order);
      
      expect(result.status).toBe('partially_filled');
      expect(result.filledAmount).toBeCloseTo(0.1, 6); // 50% of 0.2
      expect(result.remainingAmount).toBeCloseTo(0.1, 6);
      expect(result.isComplete).toBeFalsy();
    });

    it('should handle insufficient funds', async () => {
      mockProvider.updateConfig({ simulateInsufficientFunds: true });
      
      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        value: 100000,
        currency: 'AUD'
      };

      await expect(mockProvider.createMarketOrder(order)).rejects.toThrow(InsufficientFundsError);
    });

    it('should handle order rejection', async () => {
      mockProvider.updateConfig({ shouldFailCreateOrder: true });
      
      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        currency: 'AUD'
      };

      await expect(mockProvider.createMarketOrder(order)).rejects.toThrow(OrderRejectedError);
    });

    it('should validate order parameters', async () => {
      const invalidOrder: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        currency: 'AUD'
        // Missing both amount and value
      };

      await expect(mockProvider.createMarketOrder(invalidOrder)).rejects.toThrow(
        new ExchangeError('Either amount or value must be specified', 'INVALID_ORDER')
      );
    });
  });

  describe('Limit Orders', () => {
    it('should create limit order', async () => {
      const order: LimitOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        price: 48000,
        currency: 'AUD'
      };

      const result = await mockProvider.createLimitOrder(order);
      
      expect(result.status).toBe('open');
      expect(result.averagePrice).toBe(48000);
      expect(result.filledAmount).toBe(0);
      expect(result.remainingAmount).toBe(0.1);
    });

    it('should track limit order in order status', async () => {
      const order: LimitOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        price: 48000,
        currency: 'AUD'
      };

      const result = await mockProvider.createLimitOrder(order);
      const status = await mockProvider.getOrderStatus(result.orderId);
      
      expect(status.orderId).toBe(result.orderId);
      expect(status.status).toBe('open');
      expect(status.isComplete).toBe(false);
    });
  });

  describe('Order Status', () => {
    it('should track order execution over time', async () => {
      mockProvider.updateConfig({ orderExecutionDelay: 100 });
      
      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        currency: 'AUD'
      };

      // Create limit order that starts as 'open'
      const limitOrder: LimitOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        price: 50000,
        currency: 'AUD'
      };

      const result = await mockProvider.createLimitOrder(limitOrder);
      
      // Initially should be open (unless execution delay has already passed)
      let status = await mockProvider.getOrderStatus(result.orderId);
      expect(['open', 'filled']).toContain(status.status); // May already be filled due to delay
      
      // Wait for execution delay
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // After delay, should be filled
      status = await mockProvider.getOrderStatus(result.orderId);
      expect(status.status).toBe('filled');
      expect(status.isComplete).toBe(true);
    });

    it('should handle order not found', async () => {
      await expect(mockProvider.getOrderStatus('NONEXISTENT')).rejects.toThrow(
        new ExchangeError('Order NONEXISTENT not found', 'ORDER_NOT_FOUND')
      );
    });

    it('should allow manual order fills', async () => {
      const limitOrder: LimitOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.2,
        price: 50000,
        currency: 'AUD'
      };

      const result = await mockProvider.createLimitOrder(limitOrder);
      
      // Manually fill half the order
      mockProvider.fillOrder(result.orderId, 0.1);
      
      const status = await mockProvider.getOrderStatus(result.orderId);
      expect(status.status).toBe('partially_filled');
      expect(status.filledAmount).toBe(0.1);
      expect(status.remainingAmount).toBe(0.1);
      
      // Fill the rest
      mockProvider.fillOrder(result.orderId);
      
      const finalStatus = await mockProvider.getOrderStatus(result.orderId);
      expect(finalStatus.status).toBe('filled');
      expect(finalStatus.isComplete).toBe(true);
    });
  });

  describe('Balance Management', () => {
    it('should return mock balance', async () => {
      const balance = await mockProvider.getBalance();
      
      expect(balance.currency).toBe('AUD');
      expect(balance.available).toBe(50000); // Default
      expect(balance.total).toBe(50000);
      expect(balance.btc!.available).toBe(0.5); // Default
      expect(balance.btc!.total).toBe(0.5);
    });

    it('should handle balance service failure', async () => {
      mockProvider.updateConfig({ shouldFailGetBalance: true });
      
      await expect(mockProvider.getBalance()).rejects.toThrow(
        new ExchangeError('Mock: Balance service unavailable', 'BALANCE_ERROR')
      );
    });

    it('should allow manual balance updates', async () => {
      mockProvider.setBalance(75000, 1.5);
      
      const balance = await mockProvider.getBalance();
      expect(balance.available).toBe(75000);
      expect(balance.btc!.available).toBe(1.5);
    });

    it('should update balance after trades', async () => {
      const initialBalance = await mockProvider.getBalance();
      
      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        value: 10000,
        currency: 'AUD'
      };

      await mockProvider.createMarketOrder(order);
      
      const newBalance = await mockProvider.getBalance();
      expect(newBalance.available).toBeLessThan(initialBalance.available);
      expect(newBalance.btc!.available).toBeGreaterThan(initialBalance.btc!.available);
    });
  });

  describe('Withdrawals', () => {
    it('should create Bitcoin withdrawal', async () => {
      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      };

      const result = await mockProvider.withdrawBitcoin(request);
      
      expect(result.withdrawalId).toMatch(/^MOCK_WD_\d+$/);
      expect(result.status).toBe('pending');
      expect(result.currency).toBe('BTC');
      expect(result.amount).toBe(0.1);
      expect(result.address).toBe(request.address);
      expect(result.fees).toHaveLength(1);
      expect(result.estimatedConfirmationTime).toBe(60);
      
      // Balance should be updated
      const balance = await mockProvider.getBalance();
      expect(balance.btc!.available).toBe(0.4); // 0.5 - 0.1
    });

    it('should handle invalid Bitcoin address', async () => {
      mockProvider.updateConfig({ simulateInvalidAddress: true });
      
      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: 'invalid-address'
      };

      await expect(mockProvider.withdrawBitcoin(request)).rejects.toThrow(InvalidAddressError);
    });

    it('should handle insufficient Bitcoin balance', async () => {
      mockProvider.setBalance(100000, 0.01); // Very low BTC
      
      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      };

      await expect(mockProvider.withdrawBitcoin(request)).rejects.toThrow(InsufficientFundsError);
    });

    it('should handle withdrawal service failure', async () => {
      mockProvider.updateConfig({ shouldFailWithdraw: true });
      
      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      };

      await expect(mockProvider.withdrawBitcoin(request)).rejects.toThrow(
        new ExchangeError('Mock: Withdrawal service unavailable', 'WITHDRAWAL_ERROR')
      );
    });
  });

  describe('Withdrawal Status', () => {
    it('should track withdrawal progression', async () => {
      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      };

      const result = await mockProvider.withdrawBitcoin(request);
      
      // Initially pending
      let status = await mockProvider.getWithdrawalStatus(result.withdrawalId);
      expect(status.status).toBe('pending');
      expect(status.isComplete).toBe(false);
      
      // Simulate time progression by manipulating the withdrawal timestamp
      const withdrawals = mockProvider.getMockState().withdrawals;
      const withdrawal = withdrawals.find(([id]) => id === result.withdrawalId);
      if (withdrawal) {
        // Set timestamp to 20 minutes ago
        withdrawal[1].timestamp = new Date(Date.now() - 20 * 60 * 1000);
        
        status = await mockProvider.getWithdrawalStatus(result.withdrawalId);
        expect(status.status).toBe('sent');
        expect(status.confirmations).toBe(0);
      }
    });

    it('should handle withdrawal not found', async () => {
      await expect(mockProvider.getWithdrawalStatus('NONEXISTENT')).rejects.toThrow(
        new ExchangeError('Withdrawal NONEXISTENT not found', 'WITHDRAWAL_NOT_FOUND')
      );
    });
  });

  describe('Transaction History', () => {
    it('should return mock transaction history', async () => {
      const transactions = await mockProvider.getTransactionHistory();
      
      expect(transactions.length).toBeGreaterThan(0);
      expect(transactions.length).toBeLessThanOrEqual(5);
      
      transactions.forEach(tx => {
        expect(tx.id).toMatch(/^MOCK_TX_\d+$/);
        expect(tx.type).toBe('trade');
        expect(['buy', 'sell']).toContain(tx.side);
        expect(tx.status).toBe('completed');
        expect(tx.timestamp).toBeInstanceOf(Date);
        expect(tx.amount).toBeGreaterThan(0);
        expect(tx.price).toBeGreaterThan(0);
        expect(tx.fees).toHaveLength(1);
      });
      
      // Should be sorted by timestamp (newest first)
      for (let i = 1; i < transactions.length; i++) {
        expect(transactions[i-1].timestamp.getTime()).toBeGreaterThanOrEqual(
          transactions[i].timestamp.getTime()
        );
      }
    });

    it('should filter by date', async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      const transactions = await mockProvider.getTransactionHistory(since);
      
      transactions.forEach(tx => {
        expect(tx.timestamp.getTime()).toBeGreaterThanOrEqual(since.getTime());
      });
    });
  });

  describe('Fees', () => {
    it('should return trading fees', async () => {
      const fees = await mockProvider.getTradingFees();
      
      expect(fees.maker).toBe(0.15);
      expect(fees.taker).toBe(0.25);
      expect(fees.currency).toBe('percentage');
      expect(fees.volumeDiscounts).toHaveLength(3);
    });

    it('should return withdrawal fees', async () => {
      const fees = await mockProvider.getWithdrawalFees();
      
      expect(fees.btc.fixed).toBe(0.0002);
      expect(fees.btc.minimum).toBe(0.001);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle network errors', async () => {
      mockProvider.updateConfig({ simulateNetworkError: true });
      
      await expect(mockProvider.getCurrentPrice()).rejects.toThrow(Error);
    });

    it('should handle complete system failure', async () => {
      mockProvider.updateConfig(MockScenarios.COMPLETE_FAILURE);
      
      await expect(mockProvider.getCurrentPrice()).rejects.toThrow();
      await expect(mockProvider.getBalance()).rejects.toThrow();
      await expect(mockProvider.createMarketOrder({
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        currency: 'AUD'
      })).rejects.toThrow();
    });
  });

  describe('Predefined Scenarios', () => {
    it('should work with success scenario', async () => {
      const provider = new MockExchangeProvider(MockScenarios.SUCCESS);
      
      const price = await provider.getCurrentPrice();
      const balance = await provider.getBalance();
      
      expect(price.price).toBeCloseTo(50000, -3); // Wider tolerance for variation
      expect(balance.available).toBe(100000);
      expect(balance.btc!.available).toBe(2.0);
    });

    it('should work with insufficient funds scenario', async () => {
      const provider = new MockExchangeProvider(MockScenarios.INSUFFICIENT_FUNDS_AUD);
      
      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        value: 5000,
        currency: 'AUD'
      };

      await expect(provider.createMarketOrder(order)).rejects.toThrow(InsufficientFundsError);
    });

    it('should work with Australian SME scenarios', async () => {
      const scenarios = TestSuites.AUSTRALIAN_SME;
      
      for (const scenario of scenarios) {
        const provider = new MockExchangeProvider(scenario);
        const balance = await provider.getBalance();
        const price = await provider.getCurrentPrice();
        
        expect(balance.available).toBeGreaterThan(0);
        expect(balance.btc!.available).toBeGreaterThan(0);
        expect(price.price).toBeCloseTo(50000, -3); // Wide tolerance for random variation
      }
    });
  });

  describe('Scenario Factory', () => {
    it('should combine scenarios', () => {
      const combined = ScenarioFactory.combine(
        { mockPrice: 60000 },
        { networkLatencyMs: 200 },
        { mockBalance: { aud: 25000, btc: 1.0 } }
      );
      
      expect(combined.mockPrice).toBe(60000);
      expect(combined.networkLatencyMs).toBe(200);
      expect(combined.mockBalance?.aud).toBe(25000);
    });

    it('should create failure scenarios', () => {
      const scenario = ScenarioFactory.withFailures({
        price: true,
        orders: true,
        network: true
      });
      
      expect(scenario.shouldFailGetPrice).toBe(true);
      expect(scenario.shouldFailCreateOrder).toBe(true);
      expect(scenario.simulateNetworkError).toBe(true);
      expect(scenario.shouldFailWithdraw).toBeUndefined();
    });

    it('should create balance scenarios', () => {
      const scenario = ScenarioFactory.withBalance(25000, 1.5);
      
      expect(scenario.mockBalance?.aud).toBe(25000);
      expect(scenario.mockBalance?.btc).toBe(1.5);
    });

    it('should create market scenarios', () => {
      const bullMarket = ScenarioFactory.withMarket(75000, 'high');
      const bearMarket = ScenarioFactory.withMarket(30000, 'low');
      
      expect(bullMarket.mockPrice).toBe(75000);
      expect(bearMarket.mockPrice).toBe(30000);
    });
  });
});