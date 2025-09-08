# LIQUID ABT - Recovery Procedures Documentation

## Overview
This document provides comprehensive procedures for handling failures, errors, and recovery scenarios in the LIQUID ABT Bitcoin Treasury platform. These procedures ensure business continuity, data integrity, and customer satisfaction during system failures.

## Emergency Response Priorities
1. **Customer Fund Safety**: Ensure no customer funds are lost or at risk
2. **Data Integrity**: Maintain accurate transaction records and audit trails
3. **System Availability**: Restore service as quickly as possible
4. **Regulatory Compliance**: Maintain ATO and AUSTRAC compliance during incidents

---

## 1. Bitcoin Purchase Failures

### 1.1 Market Order Execution Failures

#### Symptoms
- Order placement returns error from Kraken API
- Order status shows "rejected" or "failed"
- Customer funds debited but no Bitcoin received

#### Immediate Actions (0-5 minutes)
```bash
# Check system status
curl https://api.liquidtreasury.business/api/health
curl https://api.liquidtreasury.business/api/metrics

# Verify Kraken API status
curl https://api.kraken.com/0/public/SystemStatus

# Check circuit breaker status
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.liquidtreasury.business/api/admin/circuit-breaker/status
```

#### Investigation Steps
1. **Check Transaction Logs**:
   ```sql
   SELECT * FROM bitcoin_purchases 
   WHERE status IN ('failed', 'pending') 
   AND created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC;
   ```

2. **Verify Customer Account State**:
   ```sql
   SELECT bp.*, ta.balance_aud, ta.balance_btc 
   FROM bitcoin_purchases bp
   JOIN tenant_accounts ta ON bp.tenant_id = ta.tenant_id
   WHERE bp.id = $PURCHASE_ID;
   ```

3. **Check Kraken Order Status**:
   ```javascript
   const krakenProvider = new KrakenProvider(credentials);
   const orderStatus = await krakenProvider.getOrderStatus(orderId);
   console.log('Kraken order status:', orderStatus);
   ```

#### Recovery Actions

**Scenario A: Order Rejected Due to Insufficient Funds**
```sql
-- Refund customer account
UPDATE tenant_accounts 
SET balance_aud = balance_aud + $REFUND_AMOUNT,
    updated_at = NOW()
WHERE tenant_id = $TENANT_ID;

-- Update purchase record
UPDATE bitcoin_purchases 
SET status = 'refunded',
    failure_reason = 'Insufficient exchange funds',
    refund_amount = $REFUND_AMOUNT,
    updated_at = NOW()
WHERE id = $PURCHASE_ID;
```

**Scenario B: Network/API Timeout**
```javascript
// Retry purchase with exponential backoff
async function retryFailedPurchase(purchaseId) {
  const purchase = await getPurchaseById(purchaseId);
  
  if (purchase.retry_count >= 3) {
    // Max retries reached - manual intervention required
    await notifySupport(purchase);
    return;
  }
  
  try {
    const result = await krakenProvider.createMarketOrder({
      side: 'buy',
      currency: purchase.currency,
      value: purchase.amount_aud
    });
    
    await updatePurchaseStatus(purchaseId, 'completed', result);
  } catch (error) {
    await updatePurchaseRetryCount(purchaseId, purchase.retry_count + 1);
    // Schedule retry in 5 minutes
    setTimeout(() => retryFailedPurchase(purchaseId), 5 * 60 * 1000);
  }
}
```

**Scenario C: Order Partially Filled**
```sql
-- Check if partial fill is acceptable (>95% filled)
SELECT 
  filled_amount / total_amount as fill_ratio,
  total_amount - filled_amount as unfilled_amount
FROM bitcoin_purchases 
WHERE id = $PURCHASE_ID;

-- If acceptable, mark as completed
UPDATE bitcoin_purchases 
SET status = 'completed',
    notes = 'Partially filled - acceptable',
    updated_at = NOW()
WHERE id = $PURCHASE_ID AND (filled_amount / total_amount) >= 0.95;

-- If unacceptable, refund unfilled portion
UPDATE tenant_accounts 
SET balance_aud = balance_aud + (
  SELECT total_amount - filled_amount 
  FROM bitcoin_purchases 
  WHERE id = $PURCHASE_ID
),
updated_at = NOW()
WHERE tenant_id = $TENANT_ID;
```

### 1.2 Bitcoin Withdrawal Failures

#### Symptoms
- Withdrawal request fails to submit to Kraken
- Withdrawal stuck in "pending" status for >2 hours
- Invalid Bitcoin address error

#### Immediate Actions
```javascript
// Check withdrawal status
const withdrawalStatus = await krakenProvider.getWithdrawalStatus(withdrawalId);

// Validate Bitcoin address again
const isValidAddress = await validateBitcoinAddress(address);

// Check if address is on exchange's blacklist
const isBlacklisted = await checkAddressBlacklist(address);
```

#### Recovery Procedures

**Invalid Address**
```sql
-- Update withdrawal record
UPDATE bitcoin_withdrawals 
SET status = 'failed',
    failure_reason = 'Invalid Bitcoin address',
    updated_at = NOW()
WHERE id = $WITHDRAWAL_ID;

-- Refund Bitcoin to customer's account
UPDATE tenant_accounts 
SET balance_btc = balance_btc + $WITHDRAWAL_AMOUNT,
    updated_at = NOW()
WHERE tenant_id = $TENANT_ID;

-- Notify customer
INSERT INTO notifications (tenant_id, type, message, created_at)
VALUES (
  $TENANT_ID,
  'withdrawal_failed',
  'Bitcoin withdrawal failed due to invalid address. Please update your Bitcoin address.',
  NOW()
);
```

**Stuck Withdrawal**
```javascript
// Query Kraken for latest status
async function resolveStuckWithdrawal(withdrawalId) {
  try {
    const status = await krakenProvider.getWithdrawalStatus(withdrawalId);
    
    if (status.status === 'confirmed') {
      // Update our records
      await updateWithdrawalStatus(withdrawalId, 'completed', status.txId);
    } else if (status.status === 'failed') {
      // Process refund
      await processWithdrawalRefund(withdrawalId, status.failureReason);
    }
  } catch (error) {
    // Manual investigation required
    await escalateToSupport(withdrawalId, error.message);
  }
}
```

---

## 2. Partial Fill Handling

### 2.1 Identification and Assessment

#### Detection Query
```sql
-- Find orders with partial fills in last 24 hours
SELECT 
  bp.id,
  bp.tenant_id,
  bp.exchange_order_id,
  bp.amount_aud,
  bp.filled_amount_aud,
  (bp.filled_amount_aud / bp.amount_aud) as fill_ratio,
  bp.created_at
FROM bitcoin_purchases bp
WHERE bp.status = 'partially_filled'
  AND bp.created_at > NOW() - INTERVAL '24 hours'
  AND (bp.filled_amount_aud / bp.amount_aud) < 1.0
ORDER BY bp.created_at DESC;
```

#### Assessment Criteria
- **Acceptable Partial Fill**: >95% filled within 30 minutes
- **Unacceptable Partial Fill**: <95% filled or >30 minutes elapsed
- **Customer Impact**: High-value orders (>$10,000) require immediate attention

### 2.2 Resolution Procedures

**Automatic Resolution (Acceptable Fills)**
```javascript
// Automatic completion for fills >95%
async function processAcceptablePartialFill(purchaseId) {
  const purchase = await getPurchaseById(purchaseId);
  const fillRatio = purchase.filled_amount_aud / purchase.amount_aud;
  
  if (fillRatio >= 0.95) {
    // Mark as completed
    await updatePurchaseStatus(purchaseId, 'completed');
    
    // Refund small unfilled portion
    const refundAmount = purchase.amount_aud - purchase.filled_amount_aud;
    if (refundAmount > 0) {
      await refundToCustomerAccount(purchase.tenant_id, refundAmount);
    }
    
    // Log completion
    await logEvent('partial_fill_accepted', { purchaseId, fillRatio });
  }
}
```

**Manual Resolution (Unacceptable Fills)**
```sql
-- Cancel remaining order portion
UPDATE bitcoin_purchases 
SET status = 'cancelled',
    cancellation_reason = 'Partial fill timeout',
    updated_at = NOW()
WHERE id = $PURCHASE_ID;

-- Process refund for unfilled portion
UPDATE tenant_accounts 
SET balance_aud = balance_aud + $UNFILLED_AMOUNT,
    updated_at = NOW()
WHERE tenant_id = $TENANT_ID;

-- Create notification
INSERT INTO notifications (tenant_id, type, message, priority, created_at)
VALUES (
  $TENANT_ID,
  'partial_fill_resolved',
  'Your Bitcoin purchase was partially filled. Unfilled amount has been refunded.',
  'normal',
  NOW()
);
```

---

## 3. Manual Intervention Procedures

### 3.1 Emergency Admin Access

#### Secure Access Protocol
```bash
# Connect to production environment (requires MFA)
aws sso login --profile liquid-abt-prod

# Access admin panel with elevated privileges
kubectl exec -it liquid-abt-admin-pod -- /bin/bash

# Verify identity and log access
echo "Emergency access by: $USER at $(date)" >> /var/log/admin-access.log
```

#### Admin Override Commands
```sql
-- Emergency account freeze
UPDATE tenant_accounts 
SET status = 'frozen',
    freeze_reason = 'Emergency intervention',
    frozen_at = NOW(),
    frozen_by = $ADMIN_USER
WHERE tenant_id = $TENANT_ID;

-- Emergency refund processing
INSERT INTO emergency_refunds (
  tenant_id, 
  amount_aud, 
  reason, 
  approved_by, 
  created_at
) VALUES (
  $TENANT_ID,
  $REFUND_AMOUNT,
  'System failure recovery',
  $ADMIN_USER,
  NOW()
);
```

### 3.2 Customer Communication

#### Incident Notification Template
```javascript
const customerNotification = {
  subject: 'LIQUID ABT - Transaction Update',
  template: `
Dear ${customerName},

We experienced a temporary issue with your Bitcoin purchase (Transaction ID: ${transactionId}) 
on ${date}. 

Status: ${status}
Action Taken: ${resolution}
Expected Resolution: ${timeline}

Your funds remain secure and any affected amounts will be processed according to our 
recovery procedures. We apologize for any inconvenience.

For questions, please contact support@liquidtreasury.business

LIQUID ABT Support Team
  `,
  priority: 'high'
};
```

#### Regulatory Reporting
```sql
-- Create incident report for AUSTRAC compliance
INSERT INTO incident_reports (
  incident_type,
  severity,
  affected_customers,
  financial_impact,
  resolution_time,
  regulatory_notification_required,
  created_at
) VALUES (
  'bitcoin_purchase_failure',
  'medium',
  $AFFECTED_COUNT,
  $TOTAL_IMPACT_AUD,
  $RESOLUTION_MINUTES,
  CASE WHEN $TOTAL_IMPACT_AUD > 50000 THEN true ELSE false END,
  NOW()
);
```

---

## 4. Database Rollback Procedures

### 4.1 Transaction Rollback

#### Point-in-Time Recovery
```bash
# Create new RDS instance from automated backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier liquid-abt-recovery-$(date +%Y%m%d) \
  --db-snapshot-identifier liquid-abt-automated-backup-$(date +%Y-%m-%d) \
  --db-instance-class db.r5.xlarge

# Update connection strings to point to recovery instance
kubectl set env deployment/liquid-abt-api \
  DATABASE_URL=postgresql://user:pass@recovery-instance:5432/liquid_abt
```

#### Selective Data Recovery
```sql
-- Backup current state before rollback
CREATE TABLE bitcoin_purchases_backup_$(date +%Y%m%d) AS 
SELECT * FROM bitcoin_purchases 
WHERE created_at > '2025-01-06 10:00:00';

-- Restore specific transactions from backup
INSERT INTO bitcoin_purchases 
SELECT * FROM backup_database.bitcoin_purchases 
WHERE id IN ($RECOVERY_TRANSACTION_IDS)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = NOW();

-- Recalculate account balances
WITH transaction_sums AS (
  SELECT 
    tenant_id,
    SUM(CASE WHEN status = 'completed' THEN amount_aud ELSE 0 END) as total_spent,
    SUM(CASE WHEN status = 'completed' THEN amount_btc ELSE 0 END) as total_btc
  FROM bitcoin_purchases 
  GROUP BY tenant_id
)
UPDATE tenant_accounts ta
SET 
  balance_btc = ts.total_btc,
  updated_at = NOW()
FROM transaction_sums ts
WHERE ta.tenant_id = ts.tenant_id;
```

### 4.2 Data Consistency Checks

#### Post-Recovery Validation
```sql
-- Verify account balance consistency
SELECT 
  ta.tenant_id,
  ta.balance_aud,
  ta.balance_btc,
  COALESCE(bp_totals.total_spent, 0) as calculated_spent,
  COALESCE(bp_totals.total_btc, 0) as calculated_btc,
  CASE 
    WHEN ABS(ta.balance_btc - COALESCE(bp_totals.total_btc, 0)) > 0.00000001 
    THEN 'INCONSISTENT' 
    ELSE 'OK' 
  END as consistency_check
FROM tenant_accounts ta
LEFT JOIN (
  SELECT 
    tenant_id,
    SUM(CASE WHEN status = 'completed' THEN amount_aud ELSE 0 END) as total_spent,
    SUM(CASE WHEN status = 'completed' THEN amount_btc ELSE 0 END) as total_btc
  FROM bitcoin_purchases 
  GROUP BY tenant_id
) bp_totals ON ta.tenant_id = bp_totals.tenant_id
WHERE ta.status = 'active';
```

#### Automated Reconciliation
```javascript
async function reconcileAccountBalances() {
  const inconsistentAccounts = await findInconsistentAccounts();
  
  for (const account of inconsistentAccounts) {
    const correctBalance = await calculateCorrectBalance(account.tenant_id);
    
    await updateAccountBalance(account.tenant_id, correctBalance);
    await logReconciliation(account.tenant_id, account.old_balance, correctBalance);
  }
}
```

---

## 5. Communication Protocols

### 5.1 Internal Communication

#### Incident Response Team
- **Incident Commander**: Technical Lead
- **Communications Lead**: Customer Success Manager  
- **Technical Lead**: Senior Developer
- **Business Lead**: Product Manager
- **Compliance Officer**: Legal/Regulatory

#### Communication Channels
```yaml
primary: "#incidents" Slack channel
escalation: Direct phone calls to team leads
external: incidents@liquidtreasury.business
compliance: compliance@liquidtreasury.business
```

#### Status Updates
```javascript
// Automated status updates every 15 minutes during incidents
const statusUpdate = {
  timestamp: new Date().toISOString(),
  incident_id: 'INC-2025-001',
  status: 'investigating', // investigating, mitigating, resolved
  affected_services: ['bitcoin-purchases', 'account-balances'],
  customer_impact: 'Medium - some transactions delayed',
  next_update: '15 minutes',
  resolution_eta: '1 hour'
};
```

### 5.2 Customer Communication

#### Severity Levels
- **Critical**: Immediate notification, phone calls to high-value customers
- **High**: Email within 30 minutes, in-app notifications
- **Medium**: In-app notifications, email within 2 hours
- **Low**: Daily summary, no immediate action required

#### Communication Templates
```html
<!-- Critical Incident Email -->
<html>
<body>
  <h2>URGENT: LIQUID ABT Service Incident</h2>
  <p>We are currently experiencing issues with Bitcoin purchases. Your funds remain secure.</p>
  <ul>
    <li><strong>Incident ID:</strong> {{incident_id}}</li>
    <li><strong>Started:</strong> {{incident_start}}</li>
    <li><strong>Expected Resolution:</strong> {{eta}}</li>
    <li><strong>Your Account:</strong> No action required</li>
  </ul>
  <p>We will update you every 30 minutes until resolved.</p>
  <p>Support: 1800-LIQUID (1800-547843)</p>
</body>
</html>
```

---

## 6. Monitoring and Alerting

### 6.1 Automated Detection

#### Critical Alerts
```yaml
alerts:
  - name: "Bitcoin Purchase Failure Rate High"
    condition: "bitcoin_purchase_failures / bitcoin_purchase_total > 0.05"
    duration: "5 minutes"
    action: "page_on_call_engineer"
    
  - name: "Kraken API Circuit Breaker Open"
    condition: "kraken_circuit_breaker_state = 'OPEN'"
    duration: "1 minute" 
    action: "escalate_immediately"
    
  - name: "Database Connection Pool Exhausted"
    condition: "database_connections_available < 5"
    duration: "2 minutes"
    action: "auto_scale_connections"
```

#### Recovery Monitoring
```sql
-- Monitor recovery progress
CREATE VIEW recovery_dashboard AS
SELECT 
  COUNT(*) FILTER (WHERE status = 'failed') as failed_purchases,
  COUNT(*) FILTER (WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes') as stuck_purchases,
  COUNT(*) FILTER (WHERE status = 'completed' AND updated_at > NOW() - INTERVAL '1 hour') as recovered_purchases,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_recovery_time_seconds
FROM bitcoin_purchases 
WHERE created_at > NOW() - INTERVAL '24 hours';
```

### 6.2 Health Checks

#### Automated Recovery Health Check
```javascript
async function performRecoveryHealthCheck() {
  const checks = {
    kraken_api: await testKrakenConnection(),
    database: await testDatabaseConnection(),
    redis_cache: await testRedisConnection(),
    account_consistency: await verifyAccountConsistency(),
    pending_transactions: await countStuckTransactions()
  };
  
  const overallHealth = Object.values(checks).every(check => check.healthy);
  
  return {
    timestamp: new Date(),
    overall_healthy: overallHealth,
    checks,
    actions_required: checks.filter(check => !check.healthy)
  };
}
```

---

## 7. Testing Recovery Procedures

### 7.1 Disaster Recovery Drills

#### Monthly Drill Schedule
```yaml
week_1: "Database failover and recovery"
week_2: "Kraken API failure simulation"  
week_3: "Partial transaction recovery"
week_4: "Full system recovery test"
```

#### Test Scenarios
```javascript
// Simulate Bitcoin purchase failure
async function simulateOrderFailure() {
  // Create test purchase order
  const testOrder = await createTestPurchase({
    tenant_id: 'test_tenant_001',
    amount_aud: 1000,
    simulate_failure: true
  });
  
  // Verify failure detection
  await waitForFailureDetection(testOrder.id);
  
  // Test recovery procedures
  await executeRecoveryProcedure(testOrder.id);
  
  // Validate recovery success
  const recoveryResult = await validateRecovery(testOrder.id);
  assert(recoveryResult.success, 'Recovery procedure failed');
}
```

### 7.2 Recovery Time Objectives (RTO)

#### Target Recovery Times
- **Critical System Failure**: < 15 minutes
- **Bitcoin Purchase Failures**: < 5 minutes per transaction
- **Database Rollback**: < 30 minutes
- **Full System Recovery**: < 1 hour

#### Success Criteria
```sql
-- Measure actual recovery times
INSERT INTO recovery_metrics (
  incident_type,
  detection_time,
  response_time, 
  resolution_time,
  rto_met,
  lessons_learned
) VALUES (
  'bitcoin_purchase_failure',
  '00:02:30',
  '00:01:15', 
  '00:04:45',
  true,
  'Circuit breaker worked as expected, automated recovery successful'
);
```

---

## 8. Escalation Procedures

### 8.1 Escalation Matrix

| Severity | Initial Response | Escalation (30min) | Escalation (1hr) | Escalation (2hr) |
|----------|------------------|-------------------|------------------|------------------|
| Critical | On-call Engineer | Technical Lead    | CTO              | CEO              |
| High     | Support Team     | Technical Lead    | Engineering Manager | CTO           |
| Medium   | Support Team     | Team Lead         | Technical Lead   | Engineering Manager |
| Low      | Support Ticket   | Daily Review      | Weekly Review    | Monthly Review   |

### 8.2 External Escalation

#### Regulatory Notifications
```javascript
async function checkRegulatoryReporting(incident) {
  const criteria = {
    financial_impact: incident.financial_impact > 100000, // >$100K
    customer_count: incident.affected_customers > 100,
    duration: incident.duration_minutes > 240, // >4 hours
    data_breach: incident.involves_data_breach
  };
  
  if (Object.values(criteria).some(Boolean)) {
    await notifyAUSTRAC(incident);
    await notifyASIC(incident);  
    await notifyAPRA(incident);
  }
}
```

#### Customer Escalation
```sql
-- Identify customers requiring personal contact
SELECT 
  t.business_name,
  t.primary_contact_email,
  t.primary_contact_phone,
  SUM(bp.amount_aud) as total_affected
FROM tenants t
JOIN bitcoin_purchases bp ON t.id = bp.tenant_id
WHERE bp.status = 'failed' 
  AND bp.created_at > NOW() - INTERVAL '24 hours'
GROUP BY t.id
HAVING SUM(bp.amount_aud) > 10000 -- High-value customers
ORDER BY total_affected DESC;
```

---

## 9. Post-Incident Procedures

### 9.1 Incident Review

#### Post-Mortem Template
```markdown
# Incident Post-Mortem: {{incident_id}}

## Summary
- **Date**: {{date}}
- **Duration**: {{duration}}
- **Impact**: {{customer_impact}}
- **Root Cause**: {{root_cause}}

## Timeline
- {{time}}: Initial detection
- {{time}}: Response initiated
- {{time}}: Root cause identified
- {{time}}: Fix implemented
- {{time}}: Service restored
- {{time}}: Incident closed

## What Went Well
- {{positive_1}}
- {{positive_2}}

## What Could Be Improved
- {{improvement_1}}
- {{improvement_2}}

## Action Items
- [ ] {{action_1}} (Owner: {{owner}}, Due: {{date}})
- [ ] {{action_2}} (Owner: {{owner}}, Due: {{date}})

## Follow-up
- Monitoring improvements
- Process updates
- Training requirements
```

### 9.2 Process Improvements

#### Continuous Improvement
```sql
-- Track incident patterns
SELECT 
  incident_type,
  COUNT(*) as occurrence_count,
  AVG(resolution_time_minutes) as avg_resolution_time,
  MIN(detection_time_minutes) as best_detection_time
FROM incidents 
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY incident_type
ORDER BY occurrence_count DESC;
```

#### Automation Opportunities
```javascript
// Identify manual intervention patterns
async function identifyAutomationOpportunities() {
  const manualInterventions = await getManualInterventions();
  
  const patterns = manualInterventions.reduce((acc, intervention) => {
    acc[intervention.type] = (acc[intervention.type] || 0) + 1;
    return acc;
  }, {});
  
  // Prioritize automation for frequent manual interventions
  return Object.entries(patterns)
    .sort(([,a], [,b]) => b - a)
    .map(([type, count]) => ({ type, count, automation_priority: count > 5 ? 'high' : 'medium' }));
}
```

---

## Contact Information

### Emergency Contacts
- **Technical Lead**: +61 XXX XXX XXX
- **On-Call Engineer**: +61 XXX XXX XXX (24/7)
- **Business Continuity**: business-continuity@liquidtreasury.business
- **Legal/Compliance**: compliance@liquidtreasury.business
- **Customer Support**: 1800-LIQUID (1800-547843)

### External Contacts
- **Kraken Support**: support@kraken.com (24/7)
- **AWS Support**: Enterprise Support Plan
- **Legal Counsel**: XXXX Law Firm
- **Insurance Provider**: XXXX Insurance

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Next Review**: Monthly or after major incidents  
**Owner**: LIQUID ABT Technical Operations Team