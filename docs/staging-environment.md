# LIQUID ABT - Staging Environment Setup

## Overview
This document outlines the complete setup and configuration of the staging environment for LIQUID ABT, which serves as an exact copy of the production architecture for comprehensive pre-production testing.

## Architecture Overview

### Infrastructure Components
- **AWS ECS Fargate**: Container orchestration (2-4 instances for load testing)
- **AWS RDS PostgreSQL**: Multi-AZ database with automated backups
- **AWS ElastiCache Redis**: Session management and caching
- **AWS Application Load Balancer**: Traffic distribution and SSL termination
- **AWS S3**: Document storage and backups
- **AWS CloudWatch**: Comprehensive monitoring and logging

### Key Differences from Production
- **Kraken Sandbox API**: Uses Kraken's sandbox environment for safe testing
- **Reduced Instance Count**: 2-4 instances vs production's auto-scaling 2-10
- **Enhanced Logging**: More verbose logging for debugging and analysis
- **Test Data Generation**: Synthetic transaction generator for load testing
- **Manual Scaling**: Fixed instance count to control testing conditions

## Environment Configuration

### Environment Variables (Staging)
```bash
# Application
NODE_ENV=staging
PORT=3000
NEXT_PUBLIC_APP_URL=https://staging.liquidtreasury.business
DATABASE_URL=postgresql://liquid_staging:$PASSWORD@staging-db.liquidtreasury.business:5432/liquid_abt_staging
REDIS_URL=redis://staging-cache.liquidtreasury.business:6379

# Kraken Sandbox API
KRAKEN_API_KEY=$KRAKEN_SANDBOX_API_KEY
KRAKEN_PRIVATE_KEY=$KRAKEN_SANDBOX_PRIVATE_KEY
KRAKEN_SANDBOX_MODE=true
KRAKEN_BASE_URL=https://api.kraken.com  # Same URL, sandbox credentials

# Payment Processing (Test Mode)
STRIPE_SECRET_KEY=$STRIPE_TEST_SECRET_KEY
STRIPE_WEBHOOK_SECRET=$STRIPE_TEST_WEBHOOK_SECRET
SQUARE_ACCESS_TOKEN=$SQUARE_SANDBOX_ACCESS_TOKEN
PAYPAL_CLIENT_ID=$PAYPAL_SANDBOX_CLIENT_ID

# Security & Monitoring
JWT_SECRET=$STAGING_JWT_SECRET
ENCRYPTION_KEY=$STAGING_ENCRYPTION_KEY
SENTRY_DSN=$STAGING_SENTRY_DSN
NEW_RELIC_LICENSE_KEY=$STAGING_NEW_RELIC_KEY

# Feature Flags
SYNTHETIC_TRANSACTIONS_ENABLED=true
ENHANCED_LOGGING=true
PERFORMANCE_MONITORING=true
```

## Kraken Sandbox Integration

### Sandbox Account Setup
1. **Create Kraken Account**: Register at https://kraken.com
2. **Generate API Keys**: 
   - Navigate to Settings > API
   - Create new key with permissions: Query Funds, Query Open Orders, Query Closed Orders, Query Trades History, Create & Modify Orders, Withdraw Funds
   - Download private key and store securely
3. **Sandbox Configuration**: 
   - Kraken uses the same API endpoints for sandbox and production
   - Differentiation is based on API credentials and account type
   - Test with small amounts (minimum $10 AUD equivalent)

### Sandbox Limitations
- **Real Money**: Kraken sandbox uses real funds but in minimal amounts
- **Rate Limits**: Same as production (60 public, 30 private requests/minute)
- **Order Minimums**: 0.0001 BTC minimum order size
- **Daily Limits**: $1,000 AUD equivalent for testing purposes

## Synthetic Transaction Generator

### Purpose
Generate realistic transaction patterns to test system performance, scalability, and reliability under various load conditions.

### Implementation
```typescript
// src/scripts/synthetic-transaction-generator.ts
export class SyntheticTransactionGenerator {
  private readonly patterns = {
    // Business hours: 9 AM - 5 PM AEST
    businessHours: { start: 9, end: 17, intensity: 0.8 },
    // After hours: Lower volume
    afterHours: { start: 17, end: 9, intensity: 0.2 },
    // Weekend: Minimal activity
    weekend: { intensity: 0.1 }
  };

  async generateTransactionLoad(
    durationMinutes: number,
    averageTransactionSize: number = 500,
    transactionsPerMinute: number = 10
  ): Promise<void> {
    // Simulate payment processor webhooks
    // Create realistic Bitcoin purchase patterns
    // Test treasury rule execution
    // Validate circuit breaker behavior
    // Monitor system performance metrics
  }
}
```

### Transaction Patterns
1. **E-commerce Burst**: High volume during business hours (50-100 transactions/minute)
2. **Steady DCA**: Regular purchases every hour (5-10 transactions/minute)  
3. **Large Purchase**: Occasional high-value transactions ($10K+ AUD)
4. **Mixed Currencies**: AUD, USD, EUR transactions for internationalization testing
5. **Failed Transactions**: Simulate 5-10% failure rate for error handling testing

## Database Configuration

### Staging Database Setup
```sql
-- Create staging database with same schema as production
CREATE DATABASE liquid_abt_staging;

-- Create dedicated staging user
CREATE USER liquid_staging WITH PASSWORD 'staging_secure_password';
GRANT ALL PRIVILEGES ON DATABASE liquid_abt_staging TO liquid_staging;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Configure connection pooling
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
```

### Test Data Seeding
```bash
# Seed staging database with test tenants and transactions
npm run seed:staging

# Create test tenants for different use cases
# - High-volume e-commerce business
# - Professional services firm with steady revenue
# - Startup with irregular payments
# - Enterprise client with complex treasury rules
```

## Monitoring and Alerting

### Comprehensive Monitoring Stack
1. **Application Metrics**: Custom metrics via `/api/metrics` endpoint
2. **Infrastructure Metrics**: AWS CloudWatch for ECS, RDS, ElastiCache
3. **Performance Monitoring**: New Relic APM for application performance
4. **Error Tracking**: Sentry for error monitoring and debugging
5. **Custom Dashboards**: Grafana dashboards for business metrics

### Key Performance Indicators (KPIs)
- **Response Time**: P95 < 500ms for API endpoints
- **Throughput**: Handle 1000+ transactions/hour sustained
- **Error Rate**: < 0.1% error rate across all operations
- **Bitcoin Purchase Success**: > 99% success rate for Kraken orders
- **Circuit Breaker**: Test failure scenarios and recovery times

### Alert Configuration
```yaml
alerts:
  - name: "High Error Rate"
    condition: "error_rate > 1%"
    duration: "5 minutes"
    severity: "critical"
    
  - name: "High Response Time" 
    condition: "p95_response_time > 1000ms"
    duration: "10 minutes"
    severity: "warning"
    
  - name: "Circuit Breaker Open"
    condition: "kraken_circuit_breaker_state = 'OPEN'"
    duration: "1 minute"
    severity: "critical"
    
  - name: "Database Connection Issues"
    condition: "database_connection_errors > 0"
    duration: "2 minutes"
    severity: "critical"
```

## Testing Scenarios

### 1. Normal Operation Testing (Week 1-3)
- **Load**: 10-50 transactions/hour
- **Focus**: Basic functionality, user workflows, payment processing
- **Duration**: Continuous monitoring for 3 weeks
- **Success Criteria**: 99.9% uptime, < 0.1% error rate

### 2. Stress Testing (Week 4)
- **Load**: 200-500 transactions/hour peak
- **Focus**: System limits, auto-scaling, performance degradation
- **Duration**: 48-hour stress test
- **Success Criteria**: Graceful degradation, no data loss

### 3. Failure Scenario Testing (Week 5)
- **Scenarios**:
  - Kraken API unavailable (circuit breaker testing)
  - Database connection failures
  - Redis cache unavailability  
  - Payment processor webhook failures
  - High network latency conditions
- **Focus**: Resilience, error handling, recovery procedures
- **Success Criteria**: System recovery within defined SLAs

### 4. Security Testing (Week 6)
- **Scenarios**:
  - API rate limiting validation
  - Authentication bypass attempts
  - SQL injection testing
  - Cross-tenant data access validation
- **Focus**: Security controls, data isolation, compliance
- **Success Criteria**: Zero security vulnerabilities

## Deployment Process

### Infrastructure as Code (Terraform)
```hcl
# terraform/staging/main.tf
module "staging_infrastructure" {
  source = "../modules/liquid-abt"
  
  environment = "staging"
  vpc_cidr = "10.1.0.0/16"
  availability_zones = ["ap-southeast-2a", "ap-southeast-2b"]
  
  ecs_desired_capacity = 2
  ecs_max_capacity = 4
  
  rds_instance_class = "db.t3.medium"
  rds_allocated_storage = 100
  
  elasticache_node_type = "cache.t3.micro"
  elasticache_num_cache_nodes = 2
}
```

### CI/CD Pipeline
```yaml
# .github/workflows/staging-deploy.yml
name: Deploy to Staging
on:
  push:
    branches: [develop]
    
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test
      - run: npm run test:integration
      
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster liquid-abt-staging \
            --service liquid-abt-staging \
            --force-new-deployment
```

## Performance Benchmarks

### Target Metrics (Staging)
- **API Response Time**: P95 < 500ms, P99 < 1000ms
- **Database Query Time**: P95 < 100ms for simple queries
- **Bitcoin Purchase Time**: Complete flow < 30 seconds
- **Concurrent Users**: Support 100+ concurrent users
- **Transaction Throughput**: 1000+ transactions/hour sustained

### Load Testing Strategy
```javascript
// k6 load testing script
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '5m', target: 10 },   // Ramp up
    { duration: '30m', target: 50 },  // Sustained load
    { duration: '10m', target: 100 }, // Peak load
    { duration: '5m', target: 0 },    // Ramp down
  ],
};

export default function() {
  // Test payment processing endpoint
  let response = http.post('https://staging.liquidtreasury.business/api/webhooks/stripe', payload);
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
```

## Recovery and Rollback Procedures

### Automated Rollback Triggers
- **Error Rate > 5%**: Automatic rollback to previous version
- **Response Time > 2000ms**: Alert and manual review required
- **Database Connection Failures**: Scale up database connections, investigate
- **Circuit Breaker Stuck Open > 10 minutes**: Manual intervention required

### Manual Recovery Procedures
1. **Application Rollback**: Use ECS service update to previous task definition
2. **Database Recovery**: Point-in-time recovery from RDS automated backups
3. **Cache Reset**: Flush Redis cache and restart cache cluster if needed
4. **Configuration Reset**: Restore environment variables from secure storage

## Sign-off Criteria

### Go-Live Approval Checklist
- [ ] All automated tests passing consistently for 7 days
- [ ] Performance benchmarks met under sustained load
- [ ] Security testing completed with zero critical findings
- [ ] Circuit breaker and failure recovery tested successfully
- [ ] Team trained on monitoring, alerting, and recovery procedures
- [ ] Disaster recovery procedures tested and documented
- [ ] Compliance requirements verified (Australian regulations)
- [ ] Customer support procedures established

### Success Metrics for Production Readiness
- **Availability**: 99.9%+ uptime over 4 weeks
- **Performance**: All KPIs consistently met
- **Security**: Zero security incidents or vulnerabilities
- **Reliability**: Successful recovery from all failure scenarios
- **Scalability**: Proven to handle 3x expected production load

## Team Responsibilities

### DevOps Team
- Infrastructure provisioning and management
- CI/CD pipeline maintenance
- Performance monitoring and optimization
- Disaster recovery and backup procedures

### Development Team
- Application deployment and configuration
- Bug fixes and feature updates
- Integration testing and validation
- Code quality and security reviews

### QA Team
- Comprehensive testing across all scenarios
- Performance and load testing execution
- Security testing and vulnerability assessment
- User acceptance testing coordination

### Business Team
- Requirements validation and acceptance
- Go-live decision making
- Customer communication and support preparation
- Compliance and regulatory sign-off

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Next Review**: Before production deployment  
**Owner**: LIQUID ABT DevOps Team