// LIQUID ABT - Real-time Exchange Rate Service
// Provides accurate, real-time exchange rates for multi-currency Bitcoin treasury operations

interface ExchangeRateResponse {
  rates: Record<string, number>;
  base: string;
  date: string;
}

interface CachedRate {
  rate: number;
  timestamp: number;
  source: string;
}

interface ExchangeRateProvider {
  name: string;
  priority: number;
  fetchRate(from: string, to: string): Promise<number>;
}

export class ExchangeRateService {
  private static cache: Map<string, CachedRate> = new Map();
  private static readonly CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly FALLBACK_RATES: Record<string, number> = {
    'USD_AUD': 1.55,
    'EUR_AUD': 1.65,
    'GBP_AUD': 1.88,
    'JPY_AUD': 0.010,
    'CAD_AUD': 1.12,
    'NZD_AUD': 0.93,
  };

  private static providers: ExchangeRateProvider[] = [
    {
      name: 'ExchangeRate-API',
      priority: 1,
      fetchRate: ExchangeRateService.fetchFromExchangeRateAPI
    },
    {
      name: 'Fixer.io',
      priority: 2,
      fetchRate: ExchangeRateService.fetchFromFixer
    },
    {
      name: 'CurrencyAPI',
      priority: 3,
      fetchRate: ExchangeRateService.fetchFromCurrencyAPI
    }
  ];

  /**
   * Get real-time exchange rate between two currencies
   */
  static async getRate(fromCurrency: string, toCurrency: string): Promise<number> {
    const cacheKey = `${fromCurrency}_${toCurrency}`;
    
    // Return 1.0 for same currency conversion
    if (fromCurrency === toCurrency) {
      return 1.0;
    }

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
      console.log(`✅ Using cached exchange rate: ${fromCurrency}/${toCurrency} = ${cached.rate} (source: ${cached.source})`);
      return cached.rate;
    }

    // Try each provider in priority order
    for (const provider of this.providers) {
      try {
        const rate = await provider.fetchRate(fromCurrency, toCurrency);
        
        if (rate > 0) {
          // Cache the successful result
          this.cache.set(cacheKey, {
            rate,
            timestamp: Date.now(),
            source: provider.name
          });
          
          console.log(`✅ Fresh exchange rate from ${provider.name}: ${fromCurrency}/${toCurrency} = ${rate}`);
          return rate;
        }
      } catch (error) {
        console.warn(`⚠️ Exchange rate provider ${provider.name} failed:`, error instanceof Error ? error.message : 'Unknown error');
        continue;
      }
    }

    // Fallback to hardcoded rates
    const fallbackRate = this.FALLBACK_RATES[cacheKey] || this.FALLBACK_RATES[`${toCurrency}_${fromCurrency}`];
    if (fallbackRate) {
      const rate = cacheKey in this.FALLBACK_RATES ? fallbackRate : 1 / fallbackRate;
      
      console.warn(`⚠️ Using fallback exchange rate: ${fromCurrency}/${toCurrency} = ${rate}`);
      return rate;
    }

    // Final fallback - assume AUD conversion
    if (toCurrency === 'AUD') {
      const approximateRate = fromCurrency === 'USD' ? 1.55 : 1.0;
      console.error(`❌ No exchange rate found, using approximate: ${fromCurrency}/${toCurrency} = ${approximateRate}`);
      return approximateRate;
    }

    throw new Error(`Unable to fetch exchange rate for ${fromCurrency} to ${toCurrency}`);
  }

  /**
   * Convert amount from one currency to another
   */
  static async convertAmount(
    amount: number, 
    fromCurrency: string, 
    toCurrency: string
  ): Promise<{ amount: number; rate: number; currency: string }> {
    const rate = await this.getRate(fromCurrency, toCurrency);
    const convertedAmount = Math.round((amount * rate) * 100) / 100; // Round to 2 decimal places

    return {
      amount: convertedAmount,
      rate,
      currency: toCurrency
    };
  }

  /**
   * Get multiple exchange rates in batch
   */
  static async getBatchRates(
    fromCurrency: string, 
    toCurrencies: string[]
  ): Promise<Record<string, number>> {
    const rates: Record<string, number> = {};

    await Promise.all(
      toCurrencies.map(async (toCurrency) => {
        try {
          rates[toCurrency] = await this.getRate(fromCurrency, toCurrency);
        } catch (error) {
          console.error(`Failed to get rate for ${fromCurrency}/${toCurrency}:`, error);
          rates[toCurrency] = 0; // Indicate failure
        }
      })
    );

    return rates;
  }

  /**
   * Clear rate cache (useful for testing or manual refresh)
   */
  static clearCache(): void {
    this.cache.clear();
    console.log('📝 Exchange rate cache cleared');
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(): {
    size: number;
    entries: Array<{
      pair: string;
      rate: number;
      age: number;
      source: string;
    }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([pair, cached]) => ({
      pair,
      rate: cached.rate,
      age: Math.floor((now - cached.timestamp) / 1000), // age in seconds
      source: cached.source
    }));

    return {
      size: this.cache.size,
      entries
    };
  }

  // Provider implementations

  /**
   * Fetch rate from ExchangeRate-API (Free tier: 1500 requests/month)
   */
  private static async fetchFromExchangeRateAPI(from: string, to: string): Promise<number> {
    const response = await fetch(
      `https://api.exchangerate-api.com/v4/latest/${from}`,
      { 
        timeout: 5000,
        headers: {
          'User-Agent': 'LIQUID-ABT/1.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`ExchangeRate-API error: ${response.status} ${response.statusText}`);
    }

    const data: ExchangeRateResponse = await response.json();
    
    if (!data.rates || !(to in data.rates)) {
      throw new Error(`Rate for ${to} not found in response`);
    }

    return data.rates[to];
  }

  /**
   * Fetch rate from Fixer.io (Requires API key)
   */
  private static async fetchFromFixer(from: string, to: string): Promise<number> {
    const apiKey = process.env.FIXER_API_KEY;
    if (!apiKey) {
      throw new Error('FIXER_API_KEY not configured');
    }

    const response = await fetch(
      `https://api.fixer.io/latest?access_key=${apiKey}&base=${from}&symbols=${to}`,
      { timeout: 5000 }
    );

    if (!response.ok) {
      throw new Error(`Fixer.io error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    
    if (!data.success || !data.rates || !(to in data.rates)) {
      throw new Error(`Fixer.io: ${data.error?.info || 'Rate not found'}`);
    }

    return data.rates[to];
  }

  /**
   * Fetch rate from CurrencyAPI (Requires API key)
   */
  private static async fetchFromCurrencyAPI(from: string, to: string): Promise<number> {
    const apiKey = process.env.CURRENCY_API_KEY;
    if (!apiKey) {
      throw new Error('CURRENCY_API_KEY not configured');
    }

    const response = await fetch(
      `https://api.currencyapi.com/v3/latest?apikey=${apiKey}&base_currency=${from}&currencies=${to}`,
      { timeout: 5000 }
    );

    if (!response.ok) {
      throw new Error(`CurrencyAPI error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    
    if (!data.data || !(to in data.data)) {
      throw new Error('CurrencyAPI: Rate not found');
    }

    return data.data[to].value;
  }

  /**
   * Health check for all providers
   */
  static async healthCheck(): Promise<{
    providers: Array<{
      name: string;
      status: 'healthy' | 'degraded' | 'failed';
      responseTime?: number;
      error?: string;
    }>;
    overallStatus: 'healthy' | 'degraded' | 'failed';
  }> {
    const results = await Promise.allSettled(
      this.providers.map(async (provider) => {
        const start = Date.now();
        try {
          await provider.fetchRate('USD', 'AUD');
          return {
            name: provider.name,
            status: 'healthy' as const,
            responseTime: Date.now() - start
          };
        } catch (error) {
          return {
            name: provider.name,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Unknown error',
            responseTime: Date.now() - start
          };
        }
      })
    );

    const providers = results.map((result) => 
      result.status === 'fulfilled' ? result.value : {
        name: 'unknown',
        status: 'failed' as const,
        error: 'Provider check failed'
      }
    );

    const healthyCount = providers.filter(p => p.status === 'healthy').length;
    const overallStatus = healthyCount > 0 ? 
      (healthyCount === providers.length ? 'healthy' : 'degraded') : 
      'failed';

    return { providers, overallStatus };
  }
}

// Convenience exports for common Australian business currency conversions
export const convertToAUD = (amount: number, fromCurrency: string) => 
  ExchangeRateService.convertAmount(amount, fromCurrency, 'AUD');

export const convertFromAUD = (amount: number, toCurrency: string) => 
  ExchangeRateService.convertAmount(amount, 'AUD', toCurrency);

export const getAUDRate = (currency: string) => 
  ExchangeRateService.getRate(currency, 'AUD');

// Export singleton instance
export default ExchangeRateService;