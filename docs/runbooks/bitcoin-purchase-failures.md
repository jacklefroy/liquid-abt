# Runbook: Bitcoin Purchase Failures

## Overview
This runbook provides step-by-step procedures for handling Bitcoin purchase failures in the LIQUID ABT platform.

## Alert Trigger
- **Alert ID**: `bitcoin_purchase_failure_rate_high`
- **Severity**: Critical
- **Threshold**: >5% failure rate over 15-minute window
- **Escalation**: 5 minutes

## Immediate Actions (0-5 minutes)

### 1. Check System Status
```bash
# Check overall system health
curl https://api.liquidtreasury.business/api/health

# Check Kraken exchange status
curl https://api.kraken.com/0/public/SystemStatus

# Check circuit breaker status
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.liquidtreasury.business/api/admin/circuit-breaker/status
```

### 2. Review Recent Failures
```sql
-- Check recent Bitcoin purchase failures
SELECT 
  bp.id,
  bp.tenant_id,
  bp.amount_aud,
  bp.status,
  bp.failure_reason,
  bp.exchange_provider,
  bp.created_at
FROM bitcoin_purchases bp
WHERE bp.status = 'failed'
  AND bp.created_at > NOW() - INTERVAL '1 hour'
ORDER BY bp.created_at DESC
LIMIT 20;
```

### 3. Analyze Failure Patterns
```sql
-- Group failures by reason
SELECT 
  failure_reason,
  COUNT(*) as failure_count,
  AVG(amount_aud) as avg_amount
FROM bitcoin_purchases
WHERE status = 'failed'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY failure_reason
ORDER BY failure_count DESC;
```

## Investigation Steps (5-15 minutes)

### Common Failure Scenarios

#### Scenario A: Exchange API Issues
**Symptoms**: All failures from specific exchange, API timeout errors

**Investigation**:
1. Check exchange API status page
2. Review circuit breaker logs
3. Test API connectivity manually

**Resolution**:
```javascript
// Force circuit breaker recovery test
const krakenProvider = new KrakenProvider(credentials);
try {
  const price = await krakenProvider.getCurrentPrice('AUD');
  console.log('API test successful:', price);
} catch (error) {
  console.error('API still failing:', error.message);
}
```

#### Scenario B: Insufficient Funds
**Symptoms**: "Insufficient funds" error messages

**Investigation**:
1. Check exchange account balances
2. Verify recent large transactions
3. Review deposit status

**Resolution**:
```sql
-- Check customers affected by insufficient funds
SELECT DISTINCT tenant_id 
FROM bitcoin_purchases 
WHERE failure_reason LIKE '%insufficient%funds%'
  AND created_at > NOW() - INTERVAL '1 hour';
```

#### Scenario C: Network/Infrastructure Issues
**Symptoms**: Random failures across different customers, timeout errors

**Investigation**:
1. Check AWS CloudWatch metrics
2. Review load balancer health
3. Check database connection pool

**Resolution**:
```bash
# Check ECS service health
aws ecs describe-services --cluster liquid-abt-prod --services liquid-abt-api

# Check RDS connections
aws rds describe-db-clusters --db-cluster-identifier liquid-abt-prod
```

## Resolution Procedures

### 1. Customer Communication
```javascript
// Send customer notification
const affectedCustomers = await getAffectedCustomers();
for (const customer of affectedCustomers) {
  await sendFailureNotification(customer, {
    template: 'bitcoin_purchase_failure',
    context: {
      nextRetry: '15 minutes',
      supportContact: 'support@liquidtreasury.business'
    }
  });
}
```

### 2. Retry Failed Purchases
```sql
-- Identify eligible purchases for retry
SELECT id, tenant_id, amount_aud, failure_reason
FROM bitcoin_purchases 
WHERE status = 'failed'
  AND failure_reason NOT IN ('insufficient_funds', 'invalid_amount')
  AND retry_count < 3
  AND created_at > NOW() - INTERVAL '1 hour';
```

```javascript
// Retry failed purchases
async function retryFailedPurchases() {
  const eligiblePurchases = await getRetryEligiblePurchases();
  
  for (const purchase of eligiblePurchases) {
    try {
      await retryPurchase(purchase.id);
      console.log(`Retried purchase ${purchase.id}`);
    } catch (error) {
      console.error(`Retry failed for ${purchase.id}:`, error.message);
    }
  }
}
```

### 3. Manual Override (If Necessary)
```sql
-- Manual refund for confirmed failures
UPDATE bitcoin_purchases 
SET status = 'refunded',
    refund_processed_at = NOW(),
    refund_amount = amount_aud
WHERE id = $PURCHASE_ID;

-- Credit customer account
UPDATE tenant_accounts 
SET balance_aud = balance_aud + $REFUND_AMOUNT
WHERE tenant_id = $TENANT_ID;
```

## Prevention Measures

### 1. Circuit Breaker Tuning
```javascript
// Adjust circuit breaker settings if needed
const circuitBreaker = CircuitBreakerFactory.createExchangeApiBreaker('kraken');
circuitBreaker.updateConfig({
  failureThreshold: 3, // Reduce threshold if too sensitive
  recoveryTimeout: 45000, // Increase timeout if needed
  monitoringWindow: 600000 // Extend monitoring window
});
```

### 2. Add Monitoring
```javascript
// Enhanced monitoring for early detection
setInterval(async () => {
  const metrics = await getRecentMetrics();
  if (metrics.failureRate > 0.03) { // 3% threshold
    await alertingSystem.triggerAlert(
      'bitcoin_purchase_failure_rate_warning',
      'Bitcoin Purchase Failure Rate Warning',
      `Failure rate approaching threshold: ${metrics.failureRate * 100}%`
    );
  }
}, 60000); // Check every minute
```

## Post-Incident Actions

### 1. Root Cause Analysis
- Review timeline of events
- Identify primary and contributing factors
- Document lessons learned
- Update monitoring thresholds if needed

### 2. Customer Follow-up
```javascript
// Send resolution notification
await sendResolutionNotification(affectedCustomers, {
  template: 'issue_resolved',
  context: {
    issueDescription: 'Bitcoin purchase processing delays',
    resolutionTime: '45 minutes',
    preventiveMeasures: 'Enhanced monitoring and circuit breaker tuning'
  }
});
```

### 3. Update Documentation
- Update this runbook with new scenarios
- Share knowledge with team
- Update alert thresholds if necessary

## Escalation Path

1. **0-5 minutes**: On-call Engineer
2. **5-15 minutes**: Technical Lead
3. **15-30 minutes**: Engineering Manager
4. **30+ minutes**: CTO

## Emergency Contacts

- **Technical Lead**: +61 XXX XXX XXX
- **On-Call Engineer**: +61 XXX XXX XXX
- **Kraken Support**: support@kraken.com
- **AWS Support**: Enterprise Support Portal

## Related Runbooks

- [Exchange API Failures](./exchange-api-failures.md)
- [Database Connection Issues](./database-failures.md)
- [Performance Issues](./performance-issues.md)

---

**Last Updated**: January 2025  
**Owner**: LIQUID ABT Technical Operations Team