// LIQUID ABT - Kraken Exchange Integration Tests

import { KrakenProvider } from '../../kraken';
import {
  ExchangeError,
  InsufficientFundsError,
  InvalidAddressError,
  OrderRejectedError,
  MarketOrderRequest,
  WithdrawalRequest
} from '../../interface';

// Mock fetch for testing
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('KrakenProvider', () => {
  let provider: KrakenProvider;
  const mockCredentials = {
    apiKey: 'test-api-key',
    privateKey: 'dGVzdC1wcml2YXRlLWtleQ==' // base64 encoded "test-private-key"
  };

  beforeEach(() => {
    // Clear environment variables to ensure clean test state
    delete process.env.KRAKEN_API_KEY;
    delete process.env.KRAKEN_PRIVATE_KEY;
    
    provider = new KrakenProvider(mockCredentials);
    mockFetch.mockClear();
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with provided credentials', () => {
      expect(provider.name).toBe('Kraken');
      expect(provider.type).toBe('kraken');
    });

    it('should throw error when credentials are missing', () => {
      expect(() => new KrakenProvider({})).toThrow('Kraken API key and private key are required');
    });

    it('should use environment variables when credentials not provided', () => {
      process.env.KRAKEN_API_KEY = 'env-key';
      process.env.KRAKEN_PRIVATE_KEY = 'env-private-key';
      
      const envProvider = new KrakenProvider({});
      expect(envProvider).toBeDefined();
      
      // Clean up
      delete process.env.KRAKEN_API_KEY;
      delete process.env.KRAKEN_PRIVATE_KEY;
    });
  });

  describe('getCurrentPrice', () => {
    const mockTickerResponse = {
      result: {
        XBTAUD: {
          c: ['50000.00', '1'], // last trade price
          b: ['49950.00', '1'], // bid
          a: ['50050.00', '1'], // ask
          v: ['10.5', '100.5'], // volume
          p: ['500.00', '1.0'] // price change
        }
      }
    };

    it('should get current Bitcoin price successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTickerResponse)
      });

      const result = await provider.getCurrentPrice('AUD');

      expect(result).toEqual({
        symbol: 'BTC',
        price: 50000.00,
        currency: 'AUD',
        timestamp: expect.any(Date),
        bid: 49950.00,
        ask: 50050.00,
        volume24h: 100.5,
        change24h: 1.0,
        changePercent24h: 1.0
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/public/Ticker?pair=XBTAUD'),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          headers: {
            'User-Agent': 'LIQUID-ABT/1.0 (Australian Bitcoin Treasury)'
          }
        })
      );
    });

    it('should default to AUD currency', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTickerResponse)
      });

      await provider.getCurrentPrice();
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pair=XBTAUD'),
        expect.any(Object)
      );
    });

    it('should handle missing price data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: {} })
      });

      await expect(provider.getCurrentPrice('AUD')).rejects.toThrow(
        new ExchangeError('No price data found for XBTAUD', 'NO_PRICE_DATA')
      );
    });

    it('should handle invalid price data', async () => {
      const invalidTickerResponse = {
        result: {
          XBTAUD: {
            c: ['0', '1'],
            b: ['0', '1'],
            a: ['0', '1'],
            v: ['0', '0'],
            p: ['0', '0']
          }
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(invalidTickerResponse)
      });

      await expect(provider.getCurrentPrice('AUD')).rejects.toThrow(
        new ExchangeError('Invalid price data: 0', 'INVALID_PRICE_DATA')
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: ['Invalid arguments'] })
      });

      await expect(provider.getCurrentPrice('AUD')).rejects.toThrow(
        ExchangeError
      );
    });

    it('should handle network errors with retry', async () => {
      const networkError = new Error('Network error');
      (networkError as any).code = 'ECONNRESET';

      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTickerResponse)
        });

      const result = await provider.getCurrentPrice('AUD');
      expect(result.price).toBe(50000.00);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getOrderBook', () => {
    const mockOrderBookResponse = {
      result: {
        XBTAUD: {
          bids: [['49900', '0.5'], ['49800', '1.0']],
          asks: [['50100', '0.3'], ['50200', '0.8']]
        }
      }
    };

    it('should get order book successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockOrderBookResponse)
      });

      const result = await provider.getOrderBook('XBTAUD');

      expect(result).toEqual({
        symbol: 'XBTAUD',
        bids: [[49900, 0.5], [49800, 1.0]],
        asks: [[50100, 0.3], [50200, 0.8]],
        timestamp: expect.any(Date)
      });
    });

    it('should handle missing order book data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { XBTAUD: null } })
      });

      await expect(provider.getOrderBook('XBTAUD')).rejects.toThrow(
        'No order book data found for XBTAUD'
      );
    });
  });

  describe('createMarketOrder', () => {
    const mockOrderResponse = {
      result: {
        txid: ['ORDER123'],
        descr: { order: 'buy 0.1 XBTAUD @ market' }
      }
    };

    const mockOrderStatusResponse = {
      result: {
        ORDER123: {
          status: 'closed',
          descr: { type: 'buy', pair: 'XBTAUD' },
          vol: '0.1',
          vol_exec: '0.1',
          cost: '5000',
          fee: '25',
          price: '50000',
          opentm: 1640995200 // Unix timestamp
        }
      }
    };

    it('should create market buy order with amount', async () => {
      // Setup mocks for this specific test
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockOrderResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockOrderStatusResponse)
        });

      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        currency: 'AUD'
      };

      const result = await provider.createMarketOrder(order);

      expect(result).toEqual({
        orderId: 'ORDER123',
        status: 'filled',
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        filledAmount: 0.1,
        remainingAmount: 0,
        averagePrice: 50000,
        totalValue: 5000,
        fees: [{ amount: 25, currency: 'AUD', type: 'trading' }],
        timestamp: expect.any(Date),
        rawData: mockOrderResponse.result
      });
    });

    it('should create market buy order with value (AUD amount)', async () => {
      // Setup mocks for this specific test
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockOrderResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockOrderStatusResponse)
        });

      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        value: 5000,
        currency: 'AUD'
      };

      await provider.createMarketOrder(order);

      // Check that the request was made with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/private/AddOrder'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('oflags=viqc') // Volume in quote currency
        })
      );
    });

    it('should validate order parameters', async () => {
      const invalidOrder: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        currency: 'AUD'
        // Missing both amount and value
      };

      await expect(provider.createMarketOrder(invalidOrder)).rejects.toThrow(
        new ExchangeError('Either amount or value must be specified for market order', 'MISSING_ORDER_SIZE')
      );
    });

    it('should validate positive amounts', async () => {
      const invalidOrder: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: -0.1,
        currency: 'AUD'
      };

      await expect(provider.createMarketOrder(invalidOrder)).rejects.toThrow(
        new ExchangeError('Order amount must be positive', 'INVALID_AMOUNT')
      );
    });

    it('should validate order side', async () => {
      const invalidOrder: MarketOrderRequest = {
        side: 'invalid' as any,
        symbol: 'BTC',
        amount: 0.1,
        currency: 'AUD'
      };

      await expect(provider.createMarketOrder(invalidOrder)).rejects.toThrow(
        new ExchangeError('Order side must be "buy" or "sell"', 'INVALID_SIDE')
      );
    });

    it('should handle order rejection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { txid: [] } })
      });

      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        currency: 'AUD'
      };

      await expect(provider.createMarketOrder(order)).rejects.toThrow(OrderRejectedError);
    });

    it('should handle insufficient funds error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          error: ['Insufficient funds (have: 1000, need: 5000)']
        })
      });

      const order: MarketOrderRequest = {
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        currency: 'AUD'
      };

      await expect(provider.createMarketOrder(order)).rejects.toThrow(InsufficientFundsError);
    });
  });

  describe('getOrderStatus', () => {
    const mockOrderStatusResponse = {
      result: {
        ORDER123: {
          status: 'closed',
          descr: { type: 'buy', pair: 'XBTAUD' },
          vol: '0.1',
          vol_exec: '0.1',
          cost: '5000',
          fee: '25',
          price: '50000',
          opentm: 1640995200
        }
      }
    };

    it('should get order status successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockOrderStatusResponse)
      });

      const result = await provider.getOrderStatus('ORDER123');

      expect(result).toEqual({
        orderId: 'ORDER123',
        status: 'filled',
        side: 'buy',
        symbol: 'BTC',
        amount: 0.1,
        filledAmount: 0.1,
        remainingAmount: 0,
        averagePrice: 50000,
        totalValue: 5000,
        fees: [{ amount: 25, currency: 'AUD', type: 'trading' }],
        timestamp: new Date(1640995200 * 1000),
        isComplete: true,
        isCancelled: false,
        rawData: mockOrderStatusResponse.result.ORDER123
      });
    });

    it('should handle order not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: {} })
      });

      await expect(provider.getOrderStatus('NONEXISTENT')).rejects.toThrow(
        'Order NONEXISTENT not found'
      );
    });

    it('should convert Kraken order statuses correctly', async () => {
      const statusMappings = [
        { kraken: 'pending', expected: 'pending' },
        { kraken: 'open', expected: 'open' },
        { kraken: 'closed', expected: 'filled' },
        { kraken: 'canceled', expected: 'cancelled' },
        { kraken: 'expired', expected: 'cancelled' },
        { kraken: 'unknown', expected: 'pending' } // Default case
      ];

      for (const mapping of statusMappings) {
        const response = {
          result: {
            ORDER123: {
              ...mockOrderStatusResponse.result.ORDER123,
              status: mapping.kraken
            }
          }
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(response)
        });

        const result = await provider.getOrderStatus('ORDER123');
        expect(result.status).toBe(mapping.expected);
      }
    });
  });

  describe('getBalance', () => {
    const mockBalanceResponse = {
      result: {
        ZAUD: '10000.50',
        XXBT: '0.25'
      }
    };

    it('should get balance successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBalanceResponse)
      });

      const result = await provider.getBalance();

      expect(result).toEqual({
        currency: 'AUD',
        available: 10000.50,
        total: 10000.50,
        btc: {
          available: 0.25,
          total: 0.25
        }
      });
    });

    it('should handle missing balances', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: {} })
      });

      const result = await provider.getBalance();

      expect(result).toEqual({
        currency: 'AUD',
        available: 0,
        total: 0,
        btc: {
          available: 0,
          total: 0
        }
      });
    });
  });

  describe('withdrawBitcoin', () => {
    const mockWithdrawResponse = {
      result: { refid: 'WITHDRAW123' }
    };

    const mockFeesResponse = {
      btc: { fixed: 0.00015, minimum: 0.001 }
    };

    beforeEach(() => {
      // Mock getWithdrawalFees call
      jest.spyOn(provider, 'getWithdrawalFees').mockResolvedValue(mockFeesResponse);
    });

    it('should withdraw Bitcoin successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWithdrawResponse)
      });

      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      };

      const result = await provider.withdrawBitcoin(request);

      expect(result).toEqual({
        withdrawalId: 'WITHDRAW123',
        status: 'pending',
        currency: 'BTC',
        amount: 0.1,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        fees: [{ amount: 0.00015, currency: 'BTC', type: 'withdrawal' }],
        estimatedConfirmationTime: 60,
        timestamp: expect.any(Date),
        rawData: mockWithdrawResponse.result
      });
    });

    it('should validate Bitcoin address format', async () => {
      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: 'invalid-address'
      };

      await expect(provider.withdrawBitcoin(request)).rejects.toThrow(
        new InvalidAddressError('invalid-address', 'BTC')
      );
    });

    it('should validate minimum withdrawal amount', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWithdrawResponse)
      });

      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.0005, // Below minimum
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      };

      await expect(provider.withdrawBitcoin(request)).rejects.toThrow(
        new ExchangeError('Withdrawal amount 0.0005 BTC is below minimum 0.001 BTC', 'BELOW_MINIMUM_WITHDRAWAL')
      );
    });

    it('should validate withdrawal request parameters', async () => {
      const invalidRequests = [
        { currency: 'BTC' as const, amount: 0, address: 'valid' },
        { currency: 'BTC' as const, amount: 0.1, address: '' },
        { currency: 'ETH' as any, amount: 0.1, address: 'valid' }
      ];

      for (const request of invalidRequests) {
        await expect(provider.withdrawBitcoin(request)).rejects.toThrow(ExchangeError);
      }
    });

    it('should handle withdrawal failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { refid: null } })
      });

      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      };

      await expect(provider.withdrawBitcoin(request)).rejects.toThrow(
        new ExchangeError('Withdrawal request failed - no reference ID returned', 'WITHDRAWAL_FAILED')
      );
    });
  });

  describe('getWithdrawalStatus', () => {
    const mockWithdrawalStatusResponse = {
      result: {
        WITHDRAW123: {
          status: 'Success',
          amount: '0.1',
          key: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          txid: 'tx123456',
          fee: '0.00015',
          time: '1640995200'
        }
      }
    };

    it('should get withdrawal status successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWithdrawalStatusResponse)
      });

      const result = await provider.getWithdrawalStatus('WITHDRAW123');

      expect(result).toEqual({
        withdrawalId: 'WITHDRAW123',
        status: 'confirmed',
        currency: 'BTC',
        amount: 0.1,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        txId: 'tx123456',
        fees: [{ amount: 0.00015, currency: 'BTC', type: 'withdrawal' }],
        timestamp: new Date(1640995200 * 1000),
        isComplete: true,
        rawData: mockWithdrawalStatusResponse.result.WITHDRAW123
      });
    });

    it('should handle withdrawal not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: {} })
      });

      await expect(provider.getWithdrawalStatus('NONEXISTENT')).rejects.toThrow(
        'Failed to get withdrawal status: Withdrawal NONEXISTENT not found'
      );
    });
  });

  describe('getTradingFees', () => {
    const mockFeesResponse = {
      result: {
        fees: {
          XBTAUD: { fee: '0.26' }
        },
        fees_maker: {
          XBTAUD: { fee: '0.16' }
        }
      }
    };

    it('should get trading fees successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFeesResponse)
      });

      const result = await provider.getTradingFees();

      expect(result.maker).toBeCloseTo(0.16);
      expect(result.taker).toBeCloseTo(0.26);
      expect(result.currency).toBe('percentage');
    });

    it('should return default fees on API failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API Error'));

      const result = await provider.getTradingFees();

      expect(result).toEqual({
        maker: 0.16,
        taker: 0.26,
        currency: 'percentage'
      });
    });
  });

  describe('getWithdrawalFees', () => {
    it('should return correct withdrawal fees', async () => {
      const result = await provider.getWithdrawalFees();

      expect(result).toEqual({
        btc: {
          fixed: 0.00015,
          minimum: 0.001
        }
      });
    });
  });

  describe('Bitcoin Address Validation', () => {
    const validAddresses = [
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Legacy
      '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', // SegWit
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' // Bech32
    ];

    const invalidAddresses = [
      '',
      null,
      undefined,
      '1invalid',
      'invalid-address',
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa1', // Too long
      'bc1invalid'
    ];

    it('should validate correct Bitcoin addresses', async () => {
      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: '' // Will be replaced
      };

      // Mock withdrawal to pass other validations
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { refid: 'TEST123' } })
      });
      jest.spyOn(provider, 'getWithdrawalFees').mockResolvedValue({
        btc: { fixed: 0.00015, minimum: 0.001 }
      });

      for (const address of validAddresses) {
        request.address = address;
        await expect(provider.withdrawBitcoin(request)).resolves.toBeDefined();
        mockFetch.mockClear(); // Clear to ensure fresh mock for each address
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ result: { refid: 'TEST123' } })
        });
      }
    });

    it('should reject invalid Bitcoin addresses', async () => {
      const request: WithdrawalRequest = {
        currency: 'BTC',
        amount: 0.1,
        address: '' // Will be replaced
      };

      for (const address of invalidAddresses) {
        request.address = address as string;
        await expect(provider.withdrawBitcoin(request)).rejects.toThrow();
      }
    });
  });

  describe('Error Handling', () => {
    it('should map Kraken error messages to appropriate error codes', async () => {
      const errorMappings = [
        { message: 'Rate limit exceeded', expectedCode: 'RATE_LIMIT_EXCEEDED' },
        { message: 'Invalid nonce', expectedCode: 'INVALID_NONCE' },
        { message: 'Invalid signature', expectedCode: 'INVALID_SIGNATURE' },
        { message: 'Permission denied', expectedCode: 'PERMISSION_DENIED' },
        { message: 'Unknown asset pair', expectedCode: 'UNKNOWN_PAIR' },
        { message: 'Invalid arguments', expectedCode: 'INVALID_ARGUMENTS' },
        { message: 'Some other error', expectedCode: 'API_ERROR' }
      ];

      for (const mapping of errorMappings) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: () => Promise.resolve({ error: [mapping.message] })
        });

        try {
          await provider.getCurrentPrice();
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          if (error instanceof ExchangeError) {
            expect(error.code).toBe(mapping.expectedCode);
          } else {
            throw error;
          }
        }
      }
    });

    it('should handle network timeout errors', async () => {
      const timeoutError = new Error('Timeout');
      (timeoutError as any).code = 'ETIMEDOUT';

      mockFetch
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            result: {
              XBTAUD: {
                c: ['50000', '1'],
                b: ['49950', '1'],
                a: ['50050', '1'],
                v: ['10', '100'],
                p: ['500', '1']
              }
            }
          })
        });

      // Should retry and succeed
      const result = await provider.getCurrentPrice();
      expect(result.price).toBe(50000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retriable errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: ['Invalid signature'] })
      });

      await expect(provider.getCurrentPrice()).rejects.toThrow(ExchangeError);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retry
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      // Mock shorter delays for testing
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        if (typeof callback === 'function') callback();
        return {} as any;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should apply rate limits to API calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          result: {
            XBTAUD: {
              c: ['50000', '1'],
              b: ['49950', '1'],
              a: ['50050', '1'],
              v: ['10', '100'],
              p: ['500', '1']
            }
          }
        })
      });

      // Make calls - they should succeed without long delays due to mocked setTimeout
      await provider.getCurrentPrice();
      await provider.getCurrentPrice();

      // Verify that setTimeout was called (meaning rate limiting was applied)
      expect(setTimeout).toHaveBeenCalled();
    });
  });
});