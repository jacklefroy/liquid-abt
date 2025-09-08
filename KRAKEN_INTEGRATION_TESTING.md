# Kraken Integration Testing Guide

This document explains how to run integration tests against Kraken's real API for production validation.

## Overview

The Kraken sandbox integration tests (`kraken-sandbox.test.ts`) make real API calls to Kraken to validate:
- Authentication and connection
- Rate limiting behavior  
- Real market data fetching
- Error handling with actual API responses
- Network timeout and retry logic

## Setup Instructions

### 1. Get Kraken API Credentials

1. **Create Kraken Account**: Sign up at [kraken.com](https://kraken.com)
2. **Generate API Key**: Go to Settings → API → Create New Key
3. **Set Permissions**: Enable the following permissions for testing:
   - Query Funds
   - Query Open Orders  
   - Query Ledger Entries
   - Query Trade Balance
   - Cancel/Modify Orders (optional - for trading tests)

### 2. Configure Environment Variables

Create a `.env.test` file in the project root:

```bash
# Kraken Integration Test Credentials
KRAKEN_TEST_API_KEY=your_api_key_here
KRAKEN_TEST_PRIVATE_KEY=your_private_key_here

# Optional: Enable live trading tests (DANGEROUS - use minimal amounts)
# KRAKEN_SANDBOX_TRADING_ENABLED=true
```

**⚠️ SECURITY WARNING**: Never commit real API keys to git. The integration tests use minimal amounts but can still execute real trades.

### 3. Run Integration Tests

```bash
# Run all integration tests
npm test -- --testPathPattern="kraken-sandbox.test.ts"

# Run with verbose output
npm test -- --testPathPattern="kraken-sandbox.test.ts" --verbose

# Run specific test suites
npm test -- --testPathPattern="kraken-sandbox.test.ts" --testNamePattern="Authentication"
```

## Test Categories

### 🔐 Authentication & Connection Tests
- Validates API key authentication
- Tests invalid credential rejection
- Verifies basic account access

### 📈 Market Data Tests  
- Fetches real BTC/AUD prices
- Validates price data structure and ranges
- Tests order book data retrieval

### 🚦 Rate Limiting Tests
- Makes rapid API calls to test rate limits
- Validates graceful handling of 429 responses
- Ensures retry logic works with real API

### 💸 Trading API Tests (Read-Only)
- Fetches trading and withdrawal fees
- Tests order status queries (with fake IDs)
- Validates withdrawal status queries

### ❌ Error Handling Tests
- Tests network timeout scenarios
- Validates invalid parameter handling
- Tests Bitcoin address validation

### 🛒 Live Trading Tests (Optional)
- **DISABLED BY DEFAULT** - requires `KRAKEN_SANDBOX_TRADING_ENABLED=true`
- Creates minimal test orders ($50 AUD minimum)
- Tracks order execution and status
- **USE WITH EXTREME CAUTION**

## Safety Features

### Environment Guards
Tests automatically skip if:
- `KRAKEN_TEST_API_KEY` not set
- `KRAKEN_TEST_PRIVATE_KEY` not set  
- `NODE_ENV !== 'test'`

### CI/CD Protection
- Tests are skipped in CI/CD environments
- Prevents accidental real API calls in automated pipelines
- Manual environment variable setup required

### Minimal Amounts
- All trading tests use minimal amounts (0.0001-0.001 BTC)
- Approximately $5-50 AUD per test
- Safety limits prevent large accidental orders

## Expected Test Results

### Successful Run
```
✅ Authentication & Connection (3/3 tests)
✅ Market Data API (2/2 tests) 
✅ Rate Limiting Validation (1/1 tests)
✅ Trading API (2/2 tests)
✅ Error Handling (3/3 tests)
✅ Order Status Tests (2/2 tests)
⏭️ Live Trading Tests (SKIPPED)

Total: 13 tests passed, 2 skipped
```

### With Trading Enabled
```bash
export KRAKEN_SANDBOX_TRADING_ENABLED=true
npm test -- --testPathPattern="kraken-sandbox.test.ts"
```

**⚠️ WARNING**: This will create real orders with real money (minimal amounts).

## Troubleshooting

### Common Issues

#### API Key Permission Errors
```
Error: Invalid key permissions
```
**Solution**: Ensure API key has required permissions (Query Funds, etc.)

#### Rate Limit Exceeded
```  
Error: Rate limit exceeded (429)
```
**Solution**: Normal behavior - tests validate rate limiting works correctly

#### Network Timeouts
```
Error: Network request timeout
```
**Solution**: Check internet connection or increase timeout values

#### Insufficient Balance
```
Error: Insufficient funds for trading test
```  
**Solution**: Fund your test account or skip trading tests

### Debug Mode

Run with debug logging:
```bash
DEBUG=kraken:* npm test -- --testPathPattern="kraken-sandbox.test.ts"
```

## Best Practices

### Security
- Use dedicated test API keys with minimal permissions
- Never use production trading keys for tests
- Regularly rotate test API credentials
- Monitor test account balance

### Testing Strategy
- Run integration tests before major releases
- Test after significant Kraken API changes
- Validate rate limiting behavior periodically
- Keep trading tests minimal and safe

### Monitoring
- Track test execution times (API performance)
- Monitor real vs expected price ranges
- Watch for API deprecation warnings
- Log any unexpected API responses

## Cost Considerations

### Typical Costs
- **Market data tests**: Free (public API)
- **Account queries**: Free  
- **Trading tests**: ~$0.50-5.00 in fees per run
- **Network costs**: Minimal

### Fee Structure (Approximate)
- Kraken trading fee: ~0.26% per trade
- Minimum order: ~$50 AUD
- Cost per trading test: ~$0.13 AUD

## Integration with CI/CD

### GitHub Actions Example
```yaml
# .github/workflows/integration-test.yml
name: Kraken Integration Tests
on: 
  workflow_dispatch: # Manual trigger only
  
jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - name: Run Kraken Integration Tests
        env:
          KRAKEN_TEST_API_KEY: ${{ secrets.KRAKEN_TEST_API_KEY }}
          KRAKEN_TEST_PRIVATE_KEY: ${{ secrets.KRAKEN_TEST_PRIVATE_KEY }}
        run: npm test -- --testPathPattern="kraken-sandbox.test.ts"
```

**Note**: Store credentials in GitHub Secrets, never in code.

## Support

### Resources
- [Kraken API Documentation](https://docs.kraken.com/rest/)
- [Kraken WebSocket API](https://docs.kraken.com/websockets/)
- [Rate Limiting Guide](https://support.kraken.com/hc/en-us/articles/206548367)

### Getting Help
- Check Kraken API status page
- Review error codes in Kraken documentation
- Contact Kraken support for API issues
- Check network connectivity and firewall settings