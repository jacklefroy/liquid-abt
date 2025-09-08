# Runbook: Exchange API Failures

## Overview
This runbook handles failures related to cryptocurrency exchange API connectivity, specifically Kraken API issues.

## Alert Trigger
- **Alert ID**: `exchange_api_down`
- **Severity**: Critical
- **Detection**: Circuit breaker open OR consecutive API failures
- **Escalation**: 2 minutes

## Immediate Actions (0-2 minutes)

### 1. Verify Exchange Status
```bash
# Check Kraken system status
curl https://api.kraken.com/0/public/SystemStatus

# Check our circuit breaker state
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.liquidtreasury.business/api/admin/circuit-breaker/kraken
```

### 2. Test API Connectivity
```bash
# Test public API (no auth required)
curl "https://api.kraken.com/0/public/Ticker?pair=XBTAUD"

# Test private API (requires credentials)
curl -X POST https://api.kraken.com/0/private/Balance \
  -H "API-Key: $KRAKEN_API_KEY" \
  -H "API-Sign: $SIGNATURE" \
  -d "nonce=$NONCE"
```

## Investigation Steps (2-10 minutes)

### Check Recent API Call Logs
```sql
-- Review recent exchange API calls
SELECT 
  endpoint,
  success,
  response_time,
  error_message,
  created_at
FROM api_call_logs 
WHERE provider = 'kraken'
  AND created_at > NOW() - INTERVAL '30 minutes'
ORDER BY created_at DESC
LIMIT 50;
```

### Analyze Failure Patterns
```javascript
// Check circuit breaker metrics
const circuitBreaker = getKrakenCircuitBreaker();
const metrics = circuitBreaker.getMetrics();

console.log('Circuit Breaker Status:', {
  state: metrics.state,
  failureCount: metrics.failureCount,
  lastFailureTime: new Date(metrics.lastFailureTime),
  failureRate: circuitBreaker.getFailureRate()
});
```

## Common Scenarios

### Scenario A: Kraken Maintenance
**Symptoms**: All API calls failing, Kraken status page shows maintenance

**Actions**:
1. Check Kraken's status page: https://status.kraken.com
2. Estimate maintenance duration
3. Communicate to affected customers
4. Consider alternative exchange if available

### Scenario B: Rate Limiting
**Symptoms**: 429 HTTP status codes, "Rate limit exceeded" errors

**Actions**:
```javascript
// Check our rate limiting
const rateLimitStatus = await getRateLimitStatus('kraken');
console.log('Rate limit status:', rateLimitStatus);

// Temporarily reduce API call frequency
await adjustApiCallFrequency('kraken', 0.5); // 50% of normal rate
```

### Scenario C: Authentication Issues
**Symptoms**: 401/403 errors, "Invalid signature" messages

**Actions**:
```javascript
// Verify API credentials
const credentials = await getKrakenCredentials();
const testAuth = await testKrakenAuthentication(credentials);

if (!testAuth.success) {
  console.error('Authentication failed:', testAuth.error);
  // May need to rotate API keys
}
```

### Scenario D: Network Issues
**Symptoms**: Connection timeouts, DNS resolution failures

**Actions**:
```bash
# Test network connectivity
ping api.kraken.com
nslookup api.kraken.com
traceroute api.kraken.com

# Check from different regions if using multi-region deployment
```

## Resolution Procedures

### 1. Circuit Breaker Management
```javascript
// Force circuit breaker to half-open for testing
const circuitBreaker = getKrakenCircuitBreaker();
circuitBreaker.forceState('HALF_OPEN');

// Test recovery
try {
  const price = await krakenProvider.getCurrentPrice('AUD');
  console.log('Recovery test successful:', price);
  
  // Circuit breaker will automatically close on success
} catch (error) {
  console.error('Recovery test failed:', error);
  // Circuit breaker will reopen
}
```

### 2. Customer Impact Mitigation
```javascript
// Pause automatic Bitcoin purchases temporarily
await pauseAutomaticPurchases({
  reason: 'Exchange API maintenance',
  estimatedDuration: '30 minutes',
  affectedExchange: 'kraken'
});

// Queue purchases for later retry
await queueFailedPurchasesForRetry({
  maxRetryDelay: '1 hour',
  retryStrategy: 'exponential_backoff'
});
```

### 3. Alternative Exchange Activation (Future)
```javascript
// If secondary exchange is configured
if (await isSecondaryExchangeAvailable()) {
  await routeTrafficToSecondaryExchange();
  console.log('Routed traffic to secondary exchange');
}
```

## Recovery Verification

### 1. Test Core Functions
```javascript
// Test sequence after recovery
const tests = [
  () => krakenProvider.getCurrentPrice('AUD'),
  () => krakenProvider.getBalance(),
  () => krakenProvider.getOrderBook('XBTAUD')
];

for (const test of tests) {
  try {
    const result = await test();
    console.log('Test passed:', result);
  } catch (error) {
    console.error('Test failed:', error);
    // Don't proceed if basic tests fail
    return;
  }
}
```

### 2. Resume Normal Operations
```javascript
// Resume automatic purchases
await resumeAutomaticPurchases();

// Process queued purchases
await processQueuedPurchases();

// Reset circuit breaker if manually managed
circuitBreaker.reset();
```

## Monitoring and Prevention

### 1. Enhanced Monitoring
```javascript
// Add additional monitoring after incidents
setInterval(async () => {
  try {
    const startTime = performance.now();
    await krakenProvider.getCurrentPrice('AUD');
    const duration = performance.now() - startTime;
    
    // Log successful API calls for monitoring
    metricsCollector.recordExchangeApiCall('getCurrentPrice', duration, true);
    
    if (duration > 5000) {
      console.warn('Slow API response:', duration + 'ms');
    }
  } catch (error) {
    metricsCollector.recordExchangeApiCall('getCurrentPrice', 0, false);
    console.error('API health check failed:', error.message);
  }
}, 30000); // Every 30 seconds
```

### 2. Proactive Alerting
```javascript
// Set up early warning alerts
if (averageResponseTime > 3000) {
  await alertingSystem.triggerAlert(
    'exchange_api_slow',
    'Exchange API Response Time Warning',
    `Kraken API response time elevated: ${averageResponseTime}ms`
  );
}
```

## Customer Communication

### During Incident
```javascript
const communicationPlan = {
  immediate: {
    channels: ['app_notification', 'email'],
    message: 'We are experiencing temporary issues with Bitcoin purchases. Your funds are safe and we are working to resolve this quickly.'
  },
  ongoing: {
    frequency: 'every 30 minutes',
    channels: ['app_notification'],
    message: 'Bitcoin purchase services remain temporarily unavailable. Estimated resolution: [TIME]'
  },
  resolved: {
    channels: ['app_notification', 'email'],
    message: 'Bitcoin purchase services have been restored. Thank you for your patience.'
  }
};
```

## Post-Incident Review

### 1. Data Collection
```sql
-- Incident impact analysis
SELECT 
  COUNT(*) as affected_purchases,
  SUM(amount_aud) as total_amount_affected,
  COUNT(DISTINCT tenant_id) as affected_customers
FROM bitcoin_purchases 
WHERE status = 'failed' 
  AND failure_reason LIKE '%API%'
  AND created_at BETWEEN $INCIDENT_START AND $INCIDENT_END;
```

### 2. Improvements
- Review circuit breaker thresholds
- Consider implementing backup exchange
- Update API key rotation schedule
- Enhance monitoring sensitivity

## Emergency Contacts

- **Kraken Support**: support@kraken.com (24/7)
- **Technical Lead**: +61 XXX XXX XXX
- **On-Call Engineer**: +61 XXX XXX XXX
- **AWS Support**: Enterprise Support Portal

## Related Runbooks

- [Bitcoin Purchase Failures](./bitcoin-purchase-failures.md)
- [Performance Issues](./performance-issues.md)
- [Database Connection Issues](./database-failures.md)

---

**Last Updated**: January 2025  
**Owner**: LIQUID ABT Technical Operations Team