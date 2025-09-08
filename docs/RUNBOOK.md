# LIQUID ABT - Operations Runbook

## Overview
This runbook provides step-by-step procedures for operating, monitoring, and troubleshooting the LIQUID ABT platform. It's designed for operations teams, DevOps engineers, and on-call personnel.

## Emergency Contacts

### Escalation Chain
1. **Level 1**: On-call Engineer (15 min response)
2. **Level 2**: Senior Engineer (30 min response)
3. **Level 3**: Platform Lead (1 hour response)
4. **Level 4**: CTO (2 hours response)

### Contact Information
- **Primary On-call**: +61 XXX XXX XXX
- **Platform Team**: platform-team@liquidtreasury.business
- **Emergency Slack**: #emergency-response

### External Vendors
- **ZeroCap**: support@zerocap.com, +61 XXX XXX XXX
- **AWS Support**: Premium Support, Case Priority: High
- **Sentry**: enterprise-support@sentry.io

## System Architecture

### Production Environment
- **Region**: ap-southeast-2 (Sydney)
- **EKS Cluster**: liquid-abt-production
- **RDS**: PostgreSQL 15 Multi-AZ
- **ElastiCache**: Redis 7.0 Cluster Mode
- **Load Balancer**: Application Load Balancer
- **Monitoring**: CloudWatch, Sentry, Prometheus/Grafana

### Key Services
1. **Main Application**: liquid-abt-app (2 replicas)
2. **Background Workers**: liquid-abt-workers (3 replicas)  
3. **Database**: PostgreSQL with read replicas
4. **Cache**: Redis cluster (3 nodes)
5. **Queue**: Bull Queue with Redis

## Service Health Monitoring

### Health Check Endpoints
```bash
# Application health
curl -f https://app.liquidtreasury.business/api/health

# Expected response:
{
  "status": "healthy",
  "services": {
    "database": {"status": "healthy", "latency": 45},
    "redis": {"status": "healthy", "latency": 12},
    "exchanges": {"kraken": {"status": "healthy", "latency": 150}}
  }
}
```

### Key Metrics to Monitor
- **Response Time**: p95 < 2000ms, p99 < 5000ms
- **Error Rate**: < 1% for 5-minute window
- **Database Connections**: < 80% of pool size
- **Redis Memory**: < 80% of available memory
- **Queue Length**: < 1000 pending jobs

### Alerting Thresholds
```yaml
Critical Alerts (PagerDuty):
  - Application down (health check failing)
  - Error rate > 5% for 5 minutes
  - Response time p99 > 10 seconds for 5 minutes
  - Database connection failures
  - Bitcoin purchase failures > 10% for 10 minutes

Warning Alerts (Slack):
  - Error rate > 1% for 10 minutes
  - Response time p95 > 3 seconds for 10 minutes
  - Queue length > 500 jobs
  - High memory/CPU usage > 80% for 15 minutes
```

## Common Operational Procedures

### Deployment

#### Standard Deployment
```bash
# 1. Verify staging deployment
kubectl get pods -n liquid-abt-staging
kubectl logs -f deployment/liquid-abt-app -n liquid-abt-staging

# 2. Check production health before deployment
curl -f https://app.liquidtreasury.business/api/health

# 3. Deploy to production (GitHub Actions handles this)
git push origin main

# 4. Monitor deployment
kubectl rollout status deployment/liquid-abt-app -n liquid-abt-production
kubectl get pods -n liquid-abt-production

# 5. Verify health after deployment
curl -f https://app.liquidtreasury.business/api/health

# 6. Check application logs
kubectl logs -f deployment/liquid-abt-app -n liquid-abt-production --tail=100
```

#### Emergency Rollback
```bash
# 1. Get current deployment revision
kubectl rollout history deployment/liquid-abt-app -n liquid-abt-production

# 2. Rollback to previous version
kubectl rollout undo deployment/liquid-abt-app -n liquid-abt-production

# 3. Monitor rollback
kubectl rollout status deployment/liquid-abt-app -n liquid-abt-production

# 4. Verify health
curl -f https://app.liquidtreasury.business/api/health
```

### Scaling

#### Scale Application Pods
```bash
# Scale up during high load
kubectl scale deployment/liquid-abt-app --replicas=5 -n liquid-abt-production

# Scale background workers
kubectl scale deployment/liquid-abt-workers --replicas=6 -n liquid-abt-production

# Monitor scaling
kubectl get pods -n liquid-abt-production -w
```

#### Auto-scaling Configuration
```yaml
# HPA is configured for:
# - Min replicas: 2
# - Max replicas: 10
# - Target CPU: 70%
# - Target Memory: 80%

# Check HPA status
kubectl get hpa -n liquid-abt-production
kubectl describe hpa liquid-abt-app-hpa -n liquid-abt-production
```

### Database Operations

#### Connection Management
```bash
# Check database connections
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Kill long-running queries
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "SELECT pid, query_start, query FROM pg_stat_activity WHERE state = 'active' ORDER BY query_start;"

# Kill specific query
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "SELECT pg_terminate_backend(PID);"
```

#### Database Maintenance
```bash
# Check database size and table sizes
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "\dt+"

# Run VACUUM on large tables
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "VACUUM ANALYZE bitcoin_purchases;"

# Check slow queries
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "SELECT query, mean_time, calls FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"
```

#### Backup Verification
```bash
# Check latest backup
aws rds describe-db-snapshots \
  --db-instance-identifier liquid-abt-production \
  --query 'DBSnapshots[0]' \
  --region ap-southeast-2

# Restore from backup (EMERGENCY ONLY)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier liquid-abt-restore-$(date +%Y%m%d) \
  --db-snapshot-identifier rds:liquid-abt-production-YYYY-MM-DD-HH-mm \
  --region ap-southeast-2
```

### Cache Operations (Redis)

#### Redis Health Check
```bash
# Connect to Redis
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  redis-cli -h $REDIS_HOST -p $REDIS_PORT ping

# Check memory usage
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  redis-cli -h $REDIS_HOST -p $REDIS_PORT info memory

# Check connected clients
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  redis-cli -h $REDIS_HOST -p $REDIS_PORT info clients
```

#### Cache Invalidation
```bash
# Clear all caches (EMERGENCY ONLY)
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  redis-cli -h $REDIS_HOST -p $REDIS_PORT flushall

# Clear specific cache patterns
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  redis-cli -h $REDIS_HOST -p $REDIS_PORT --scan --pattern "liquid_abt:exchange_rate:*" | xargs redis-cli -h $REDIS_HOST -p $REDIS_PORT del
```

## Incident Response Procedures

### Application Down (P0 Incident)

#### Immediate Response (0-5 minutes)
1. **Acknowledge Alert**: Respond to PagerDuty alert
2. **Check Service Status**: Verify if this is a partial or complete outage
3. **Notify Stakeholders**: Post in #emergency-response Slack channel
4. **Check Dependencies**: Verify AWS services, database, Redis status

```bash
# Quick health checks
curl -I https://app.liquidtreasury.business/api/health
kubectl get pods -n liquid-abt-production
kubectl get services -n liquid-abt-production
```

#### Investigation (5-15 minutes)
1. **Check Application Logs**:
```bash
kubectl logs -f deployment/liquid-abt-app -n liquid-abt-production --tail=100
kubectl logs -f deployment/liquid-abt-workers -n liquid-abt-production --tail=100
```

2. **Check Infrastructure**:
```bash
# Check node health
kubectl get nodes
kubectl describe nodes

# Check resource usage
kubectl top pods -n liquid-abt-production
kubectl top nodes
```

3. **Check External Dependencies**:
   - AWS Service Health Dashboard
   - ZeroCap API status
   - Stripe API status

#### Resolution Steps
1. **If Application Pods are Down**:
```bash
# Restart deployment
kubectl rollout restart deployment/liquid-abt-app -n liquid-abt-production
kubectl rollout status deployment/liquid-abt-app -n liquid-abt-production
```

2. **If Database is Down**:
   - Check RDS console for automated failover
   - If needed, manually failover to standby instance
   - Update DNS if using custom endpoint

3. **If Load Balancer Issues**:
```bash
# Check ALB target groups
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:ap-southeast-2:ACCOUNT:targetgroup/liquid-abt-tg/ID
```

### High Error Rate (P1 Incident)

#### Investigation Steps
1. **Identify Error Patterns**:
```bash
# Check recent error logs
kubectl logs deployment/liquid-abt-app -n liquid-abt-production --since=10m | grep ERROR

# Check Sentry for error trends
# Visit Sentry dashboard for detailed stack traces
```

2. **Check Exchange API Status**:
   - Verify ZeroCap API health
   - Check circuit breaker status in application logs
   - Review recent API response times

3. **Database Query Performance**:
```bash
# Check for slow queries
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';"
```

#### Mitigation Steps
1. **If Exchange API Issues**:
   - Enable circuit breaker if not already active
   - Switch to backup exchange if available
   - Notify customers via status page

2. **If Database Issues**:
   - Kill long-running queries
   - Scale up read replicas if needed
   - Consider enabling query caching

### Bitcoin Purchase Failures (P1 Incident)

#### Investigation
1. **Check Purchase Queue**:
```bash
# Check queue length and failed jobs
kubectl exec -it deployment/liquid-abt-workers -n liquid-abt-production -- \
  node -e "
    const Queue = require('bull');
    const queue = new Queue('bitcoin-purchases', process.env.REDIS_URL);
    queue.getActive().then(jobs => console.log('Active jobs:', jobs.length));
    queue.getFailed().then(jobs => console.log('Failed jobs:', jobs.length));
  "
```

2. **Check Exchange Integration**:
   - Review ZeroCap API logs
   - Verify API credentials are not expired
   - Check rate limiting status

3. **Check Customer Funds**:
   - Verify Stripe Connect account balances
   - Check for payment processing issues

#### Resolution
1. **Retry Failed Purchases**:
```bash
# Retry failed jobs in queue
kubectl exec -it deployment/liquid-abt-workers -n liquid-abt-production -- \
  node scripts/retry-failed-purchases.js
```

2. **Manual Purchase Execution** (if needed):
```bash
# Execute specific purchase manually
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  node scripts/manual-purchase.js --purchase-id="purchase-uuid"
```

## Maintenance Procedures

### Weekly Maintenance Window
**Time**: Sundays 2:00 AM - 4:00 AM AEDT
**Duration**: 2 hours maximum

#### Pre-maintenance Checklist
- [ ] Notify customers 48 hours in advance
- [ ] Update status page with maintenance window
- [ ] Verify backup completion
- [ ] Check for any critical alerts

#### Maintenance Steps
1. **Database Maintenance**:
```bash
# Run VACUUM and ANALYZE on large tables
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "VACUUM ANALYZE bitcoin_purchases;"

kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "VACUUM ANALYZE audit_events;"
```

2. **Cache Cleanup**:
```bash
# Clear expired cache entries
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  redis-cli -h $REDIS_HOST -p $REDIS_PORT eval "return redis.call('del', unpack(redis.call('keys', 'liquid_abt:expired:*')))" 0
```

3. **Log Rotation**:
```bash
# Rotate application logs (if not using log aggregation)
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  find /app/logs -name "*.log" -mtime +7 -delete
```

#### Post-maintenance Checklist
- [ ] Verify all services are healthy
- [ ] Run smoke tests
- [ ] Update status page
- [ ] Monitor for 30 minutes

### Monthly Security Updates

#### Security Scanning
```bash
# Scan Docker images for vulnerabilities
docker scan liquid-abt:latest

# Check for dependency vulnerabilities
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  npm audit --production
```

#### Certificate Management
```bash
# Check SSL certificate expiry
echo | openssl s_client -servername app.liquidtreasury.business -connect app.liquidtreasury.business:443 2>/dev/null | openssl x509 -noout -dates
```

## Monitoring and Alerting Configuration

### CloudWatch Alarms
```bash
# CPU Utilization
aws cloudwatch put-metric-alarm \
  --alarm-name "LIQUID-ABT-High-CPU" \
  --alarm-description "High CPU utilization" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80.0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2

# Memory Utilization  
aws cloudwatch put-metric-alarm \
  --alarm-name "LIQUID-ABT-High-Memory" \
  --alarm-description "High memory utilization" \
  --metric-name MemoryUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80.0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

### Prometheus Queries
```promql
# Error rate
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100

# Response time p95
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Database connection pool usage
pg_stat_database_numbackends / pg_settings_max_connections * 100

# Queue length
redis_list_length{key="bitcoin_purchases"}
```

### Grafana Dashboard URLs
- **System Overview**: https://monitoring.liquidtreasury.business/d/system-overview
- **Application Metrics**: https://monitoring.liquidtreasury.business/d/app-metrics
- **Business KPIs**: https://monitoring.liquidtreasury.business/d/business-kpis

## Recovery Procedures

### Disaster Recovery

#### RTO (Recovery Time Objective): 4 hours
#### RPO (Recovery Point Objective): 1 hour

#### Full System Recovery
1. **Assess Damage**: Determine scope of the disaster
2. **Activate DR Site**: If primary region is unavailable
3. **Restore Database**: From latest backup
4. **Update DNS**: Point to DR environment
5. **Verify Functionality**: Run full test suite
6. **Notify Stakeholders**: Update status page and customers

#### Database Recovery
```bash
# Restore from automated backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier liquid-abt-dr-$(date +%Y%m%d) \
  --db-snapshot-identifier rds:liquid-abt-production-$(date +%Y-%m-%d -d '1 day ago')-automated \
  --region ap-southeast-2

# Update connection strings in application
kubectl patch deployment liquid-abt-app -n liquid-abt-production \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","env":[{"name":"DATABASE_URL","value":"new-database-url"}]}]}}}}'
```

### Data Corruption Recovery

#### Bitcoin Purchase Data
```bash
# Identify corrupted records
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "SELECT id, created_at, amount, bitcoin_amount FROM bitcoin_purchases WHERE bitcoin_amount IS NULL OR bitcoin_amount <= 0;"

# Restore from backup if needed
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  node scripts/restore-purchases-from-backup.js --date="2025-01-06"
```

#### Tenant Data Isolation Breach
```bash
# Audit tenant data access
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  psql $DATABASE_URL -c "SELECT * FROM audit_events WHERE event_type = 'data_access' AND created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC;"

# Verify tenant isolation
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  node scripts/verify-tenant-isolation.js
```

## Performance Tuning

### Database Optimization
```sql
-- Check for missing indexes
SELECT schemaname, tablename, attname, n_distinct, correlation 
FROM pg_stats 
WHERE schemaname = 'public' AND n_distinct > 100;

-- Create recommended indexes
CREATE INDEX CONCURRENTLY idx_bitcoin_purchases_tenant_created 
ON bitcoin_purchases (tenant_id, created_at);

-- Update table statistics
ANALYZE bitcoin_purchases;
```

### Application Performance
```bash
# Check Node.js memory usage
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  node -e "console.log(process.memoryUsage())"

# Enable heap profiling (temporary)
kubectl patch deployment liquid-abt-app -n liquid-abt-production \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","env":[{"name":"NODE_OPTIONS","value":"--inspect=0.0.0.0:9229"}]}]}}}}'
```

## Contact Information and Escalation

### Internal Team
- **Platform Team Lead**: platform-lead@liquidtreasury.business
- **DevOps Engineer**: devops@liquidtreasury.business  
- **Security Team**: security@liquidtreasury.business
- **Customer Success**: support@liquidtreasury.business

### External Partners
- **ZeroCap Technical Support**: 
  - Email: tech-support@zerocap.com
  - Phone: +61 2 XXXX XXXX
  - Escalation: partnerships@zerocap.com

- **AWS Support**:
  - Console: AWS Support Center
  - Premium Support Line: Available 24/7
  - TAM: aws-tam@liquidtreasury.business

### Compliance and Legal
- **Legal Team**: legal@liquidtreasury.business
- **Compliance Officer**: compliance@liquidtreasury.business
- **Data Protection Officer**: privacy@liquidtreasury.business

---

**Document Version**: 1.0  
**Last Updated**: January 6, 2025  
**Next Review**: February 6, 2025  
**Owner**: Platform Team