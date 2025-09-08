# Integration Testing Guide

This document covers the integration testing strategy for LIQUID ABT, including real API testing with our exchange stack and Australian compliance features.

## Overview

LIQUID ABT includes comprehensive integration tests to validate:
- Multi-exchange failover system (ZeroCap → Independent Reserve → BTC Markets)
- Australian compliance features (AUSTRAC, ABN verification)
- Security implementations (2FA, address whitelisting, circuit breakers)
- Database operations and multi-tenant isolation
- End-to-end Bitcoin purchase flows
- Rate limiting and error handling

## Test Types

### 1. 🔧 Unit Tests
**Location**: `src/**/__tests__/unit/`  
**Purpose**: Test individual functions and classes in isolation  
**Command**: `npm run test:unit`

### 2. 🔗 Integration Tests  
**Location**: `src/**/__tests__/integration/`  
**Purpose**: Test component interactions and database operations  
**Command**: `npm run test:integration`

### 3. 🏦 Exchange Integration Tests
**Location**: `src/lib/integrations/exchanges/__tests__/integration/`  
**Purpose**: Test real API calls to exchange services  
**Commands**: 
- `npm run test:zerocap-sandbox` (Primary)
- `npm run test:independent-reserve` (Secondary)
- `npm run test:btc-markets` (Tertiary)
- `npm run test:exchange-failover` (Full failover testing)

### 4. 🇦🇺 Australian Compliance Tests
**Location**: `src/lib/compliance/__tests__/integration/`  
**Purpose**: Test AUSTRAC, ABN, and regulatory compliance features  
**Commands**:
- `npm run test:austrac-compliance`
- `npm run test:abn-verification`
- `npm run test:transaction-monitoring`

### 5. 🔐 Security Integration Tests
**Location**: `src/lib/security/__tests__/integration/`  
**Purpose**: Test security implementations  
**Commands**:
- `npm run test:address-whitelist`
- `npm run test:price-manipulation`
- `npm run test:2fa-integration`
- `npm run test:token-families`

### 6. 🧪 End-to-End Tests
**Location**: `__tests__/e2e/`  
**Purpose**: Test complete user workflows  
**Command**: `npm run test:e2e`

## Exchange Integration Testing

### Multi-Exchange Setup

#### 1. **ZeroCap (Primary Exchange)**
- **Environment**: `ZEROCAP_API_KEY`, `ZEROCAP_PRIVATE_KEY`
- **Test Features**: Market orders, price feeds, account balance
- **Fee Structure**: 0.3% (lowest for primary)

#### 2. **Independent Reserve (Secondary)**
- **Environment**: `IR_API_KEY`, `IR_PRIVATE_KEY`
- **Test Features**: Failover activation, order execution
- **Fee Structure**: 0.5%

#### 3. **BTC Markets (Tertiary)**
- **Environment**: `BTM_API_KEY`, `BTM_PRIVATE_KEY`
- **Test Features**: Final failover, backup operations
- **Fee Structure**: 0.85%

### Setup Instructions

1. **Configure Exchange Credentials**:
   ```bash
   cp .env.test.example .env.test
   # Add your exchange API credentials
   ```

2. **Run Exchange Tests**:
   ```bash
   # Test primary exchange
   npm run test:zerocap-sandbox
   
   # Test failover system
   npm run test:exchange-failover
   
   # Test all exchanges
   npm run test:exchanges
   ```

### Available Exchange Tests

#### 🔐 Authentication Tests
- API key validation for all exchanges
- Invalid credential handling
- Account balance retrieval
- Multi-exchange authentication

#### 📈 Market Data Tests
- Real BTC/AUD price fetching across exchanges
- Price consensus validation (max 5% deviation)
- Order book data validation
- Cross-exchange price comparison

#### 🔄 Failover Tests
- Primary exchange failure simulation
- Automatic secondary activation
- Tertiary backup verification
- Health monitoring accuracy

#### 🚦 Rate Limiting Tests
- Exchange-specific rate limits
- Failover during rate limiting
- Circuit breaker activation

## Australian Compliance Testing

### AUSTRAC Compliance Tests

#### Setup
```bash
# Configure AUSTRAC testing
export AUSTRAC_REPORTING_ENABLED=true
export LARGE_TRANSACTION_THRESHOLD_AUD=10000

npm run test:austrac-compliance
```

#### Test Coverage
- **$10K Threshold Detection**: Automatic flagging of large transactions
- **Structured Transaction Patterns**: Detection of amounts just under thresholds
- **Suspicious Activity Reporting**: SMR generation and validation
- **Transaction Velocity Monitoring**: High-frequency transaction detection
- **KYC Level Enforcement**: Enhanced due diligence requirements

### ABN Verification Tests

#### Setup
```bash
# Test with known valid ABN
export TEST_ABN=51824753556

npm run test:abn-verification
```

#### Test Coverage
- **ABN Format Validation**: 11-digit format with checksum
- **Business Registry Lookup**: Real ABR API integration
- **GST Registration Verification**: Tax status validation
- **Entity Type Classification**: Company, trust, partnership detection
- **Address Verification**: Australian state validation

### Tier-Based Alert Testing

#### Setup
```bash
# Test different subscription tiers
npm run test:tier-alerts
```

#### Test Coverage
- **Starter Tier**: $5K alert thresholds
- **Growth Tier**: $25K alert thresholds  
- **Pro Tier**: $50K alert thresholds
- **Enterprise Tier**: $100K alert thresholds

## Security Integration Testing

### Bitcoin Address Whitelisting

#### Setup
```bash
npm run test:address-whitelist
```

#### Test Coverage
- **48-Hour Approval Delay**: Time-based activation
- **Email Verification**: Code-based confirmation
- **Rate Limiting**: 5 addresses per day limit
- **Address Validation**: Checksum and format verification
- **Security Bypass Testing**: Attempt early activation

### Price Manipulation Circuit Breakers

#### Setup
```bash
npm run test:price-manipulation
```

#### Test Coverage
- **10% Price Change Detection**: Rapid price movement alerts
- **Flash Crash Protection**: 15% change in 1 minute
- **Multi-Source Validation**: Minimum 2 price sources
- **Exchange Suspension**: Automatic trading halts
- **False Positive Testing**: Normal volatility handling

### SMS 2FA Australian Testing

#### Setup
```bash
# Configure Twilio for Australian numbers
export TWILIO_ACCOUNT_SID="your_sid"
export TWILIO_AUTH_TOKEN="your_token"
export TWILIO_PHONE_NUMBER="+61..."

npm run test:sms-2fa
```

#### Test Coverage
- **Australian Phone Validation**: `/^(\+61|0)[2-478](?:[ -]?[0-9]){8}$/`
- **SMS Delivery Testing**: Real Twilio integration
- **Rate Limiting**: 1 SMS/minute, 10 SMS/day
- **Code Verification**: 6-digit TOTP validation

### JWT Token Family Testing

#### Setup
```bash
npm run test:token-families
```

#### Test Coverage
- **Family Lineage Tracking**: Parent-child token relationships
- **Rotation Security**: Proper token invalidation
- **Bulk Revocation**: Family-wide token cancellation
- **Session Security**: Cross-device session management

## Database Integration Testing

### Multi-Tenant Isolation
- Each test gets isolated tenant schema
- Automatic cleanup between tests
- Cross-tenant access prevention
- Schema-level security validation

### Bitcoin Purchase Flow Testing
```bash
npm run test:bitcoin-purchase-flow
```

#### Test Coverage
- **End-to-End Purchase**: Full payment to Bitcoin flow
- **Treasury Rules**: Percentage and threshold-based conversion
- **Idempotency**: Duplicate transaction prevention
- **Concurrent Processing**: Multi-user transaction handling
- **Exchange Integration**: Real purchase execution

## Running Tests

### Local Development
```bash
# All tests
npm test

# Specific test suites
npm run test:unit
npm run test:integration
npm run test:security
npm run test:compliance
npm run test:exchanges

# Australian compliance suite
npm run test:australian-features

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Test Commands Reference

#### Exchange Testing
```bash
npm run test:zerocap-sandbox      # Primary exchange
npm run test:independent-reserve  # Secondary exchange  
npm run test:btc-markets         # Tertiary exchange
npm run test:exchange-failover   # Full failover testing
```

#### Compliance Testing
```bash
npm run test:austrac-compliance  # AUSTRAC monitoring
npm run test:abn-verification    # ABN validation
npm run test:transaction-alerts  # Alert system
npm run test:kyc-verification   # KYC processes
```

#### Security Testing
```bash
npm run test:address-whitelist   # Bitcoin address security
npm run test:price-manipulation  # Circuit breakers
npm run test:2fa-integration    # Two-factor authentication
npm run test:token-families     # JWT security
npm run test:argon2-hashing     # Password security
```

#### Production Readiness
```bash
npm run test:production-suite   # All production tests
npm run test:disaster-recovery  # DR procedures
npm run test:compliance-export  # Audit trail exports
npm run test:monitoring        # Security dashboards
```

### CI/CD Pipeline
```bash
# Standard CI tests (no external API calls)
npm run test:ci

# Integration tests (requires database + APIs)
npm run test:integration:ci

# Security validation
npm run test:security:ci

# Australian compliance validation  
npm run test:compliance:ci

# Production deployment validation
npm run test:production:ci
```

## Test Configuration

### Environment Variables
```bash
# Exchange APIs
ZEROCAP_API_KEY="your_zerocap_key"
IR_API_KEY="your_ir_key"  
BTM_API_KEY="your_btm_key"

# Australian Services
ABR_GUID="your_abr_guid"           # ABN lookup
AUSTRAC_REPORTING_ENABLED=true

# SMS 2FA
TWILIO_ACCOUNT_SID="your_sid"
TWILIO_AUTH_TOKEN="your_token"
TWILIO_PHONE_NUMBER="+61..."

# Testing
USE_MOCK_EXCHANGE=false            # Use real exchanges
TEST_ABN=51824753556              # Valid test ABN
MOCK_BTC_PRICE=150000             # Fallback price
```

### Jest Configuration
- **Unit tests**: Node environment, mocked dependencies
- **Integration tests**: Real database + API connections
- **Security tests**: Full authentication stack
- **Coverage thresholds**: 80%+ for security modules
- **Timeouts**: 60s for exchange APIs, 30s for compliance

## Safety Features

### Exchange API Safety
- **Minimal Amounts**: $50-100 AUD maximum for real trading tests
- **Sandbox Environments**: Prefer sandbox APIs where available
- **Rate Limiting**: Built-in delays to prevent API abuse
- **Cost Monitoring**: Track API usage and trading fees

### Compliance Safety
- **Test Data Only**: No real customer PII in tests
- **Regulatory Alignment**: Tests validate real compliance requirements
- **Audit Trails**: All test actions logged for review

### Security Safety
- **Isolated Testing**: Separate test credentials and environments
- **No Production Impact**: Tests cannot affect live systems
- **Credential Protection**: API keys encrypted and rotated

## Troubleshooting

### Common Issues

#### Exchange Connection Errors
```bash
# Check API credentials
npm run test:check-exchange-creds

# Verify exchange status
npm run test:exchange-health
```

#### ABN Verification Failures
```bash
# Check ABR service status
curl -I https://abr.business.gov.au/

# Validate test ABN
npm run test:validate-abn -- --abn=51824753556
```

#### SMS 2FA Issues  
```bash
# Test Twilio connection
npm run test:twilio-connection

# Verify Australian phone format
npm run test:phone-validation -- --number="+61412345678"
```

#### Database Isolation Problems
```bash
# Reset all test schemas
npm run test:reset-schemas

# Check tenant isolation
npm run test:tenant-isolation
```

## Production Readiness Checklist

### Pre-Beta Testing
- [ ] All exchange APIs tested with real credentials
- [ ] AUSTRAC compliance validated with test transactions
- [ ] ABN verification working with real ABR API
- [ ] SMS 2FA tested with Australian numbers
- [ ] Address whitelisting 48-hour delay verified
- [ ] Price manipulation circuit breakers activated

### Beta Launch Validation
- [ ] Multi-exchange failover tested under load
- [ ] Tier-based alerts working for all subscription levels
- [ ] Security monitoring dashboard functional
- [ ] Audit trail export generating compliance reports
- [ ] Disaster recovery procedures tested

### Production Deployment
- [ ] SOC 2 evidence collection automated
- [ ] All integration tests passing consistently
- [ ] Security certifications in progress
- [ ] Bug bounty program established
- [ ] Continuous compliance monitoring active

## Cost Monitoring

### API Usage Costs
- **Exchange APIs**: Free for market data, 0.3-0.85% for trading
- **ABR Lookups**: Free for basic queries
- **SMS 2FA**: ~$0.05 AUD per SMS via Twilio
- **Test Trading**: ~$0.50 AUD per test run maximum

### Infrastructure Costs  
- **Database**: Local PostgreSQL for testing
- **Redis Cache**: Local instance for development
- **CI/CD**: GitHub Actions free tier sufficient

## Support Resources

### Documentation
- [ZeroCap API Documentation](https://zerocap.com/api-docs)
- [Independent Reserve API](https://www.independentreserve.com/api)
- [BTC Markets API](https://github.com/BTCMarkets/API)
- [Australian Business Registry](https://abr.business.gov.au/)
- [AUSTRAC Reporting](https://austrac.gov.au/business/how-comply-and-report-guidance-and-resources/reporting)

### Emergency Contacts
- **Exchange Issues**: Contact exchange support directly
- **Compliance Questions**: Consult legal/compliance team
- **Security Incidents**: Follow incident response procedures
- **Technical Support**: Internal development team

---

**Last Updated**: January 2025  
**Version**: 2.0 (Updated for ZeroCap, Independent Reserve, BTC Markets implementation)  
**Reviewed By**: Security Team, Compliance Team