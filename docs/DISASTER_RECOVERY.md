# LIQUID ABT - Disaster Recovery Plan

## Overview

This document outlines the comprehensive disaster recovery (DR) procedures for LIQUID ABT platform. The plan is designed to ensure business continuity and minimize data loss in the event of various disaster scenarios.

## Recovery Objectives

### Service Level Objectives (SLOs)
- **Recovery Time Objective (RTO)**: 4 hours maximum
- **Recovery Point Objective (RPO)**: 1 hour maximum
- **Availability Target**: 99.9% uptime (8.77 hours downtime per year)
- **Data Loss Tolerance**: Maximum 1 hour of transactions

### Business Impact Analysis
- **Critical**: Customer Bitcoin purchases, treasury rules execution
- **High**: User authentication, payment processor integrations
- **Medium**: Reporting, notifications, compliance calculations
- **Low**: Administrative functions, analytics dashboards

## Infrastructure Components

### Primary Production Environment (Sydney - ap-southeast-2)
```
EKS Cluster: liquid-abt-production
Database: RDS PostgreSQL Multi-AZ (automatic failover)
Cache: ElastiCache Redis Cluster (3 nodes)
Storage: S3 with Cross-Region Replication
Load Balancer: Application Load Balancer (Multi-AZ)
```

### Disaster Recovery Environment (Melbourne - ap-southeast-4)
```
EKS Cluster: liquid-abt-dr (standby)
Database: RDS PostgreSQL (restored from backup)
Cache: ElastiCache Redis (standby)
Storage: S3 Cross-Region Replica
Load Balancer: Application Load Balancer (standby)
```

## Disaster Scenarios & Response Procedures

### Scenario 1: Application Pod Failures

**Detection**: Kubernetes health checks, monitoring alerts
**Impact**: Partial service degradation
**Response Time**: Immediate (automated)

#### Automated Response
1. **Kubernetes Auto-healing**: Pods restart automatically
2. **Load Balancer**: Traffic redirected to healthy pods
3. **Horizontal Pod Autoscaler**: Scales up to meet demand

#### Manual Intervention (if needed)
```bash
# Check pod status
kubectl get pods -n liquid-abt-production

# Force pod recreation
kubectl delete pod <pod-name> -n liquid-abt-production

# Scale deployment
kubectl scale deployment liquid-abt-app --replicas=5 -n liquid-abt-production

# Check rollout status
kubectl rollout status deployment/liquid-abt-app -n liquid-abt-production
```

### Scenario 2: Database Failures

**Detection**: Database health checks, connection monitoring
**Impact**: Complete service outage
**Response Time**: 5-10 minutes (automated failover)

#### RDS Multi-AZ Automatic Failover
1. **Detection**: AWS detects primary DB failure
2. **DNS Update**: RDS endpoint automatically points to standby
3. **Application Recovery**: Connection pools reconnect automatically

#### Manual Database Recovery
```bash
# Check RDS status
aws rds describe-db-instances --db-instance-identifier liquid-abt-production

# Force failover (if needed)
aws rds failover-db-cluster --db-cluster-identifier liquid-abt-production

# Monitor failover progress
aws rds describe-events --source-identifier liquid-abt-production --source-type db-instance
```

#### Point-in-Time Recovery
```bash
# Restore to specific point in time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier liquid-abt-production \
  --target-db-instance-identifier liquid-abt-recovery-$(date +%Y%m%d) \
  --restore-time "2025-01-06T10:30:00Z"

# Update application connection strings
kubectl patch deployment liquid-abt-app -n liquid-abt-production \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","env":[{"name":"DATABASE_URL","value":"new-database-url"}]}]}}}}'
```

### Scenario 3: Complete AWS Region Failure

**Detection**: Multi-service AWS outage, region-wide connectivity loss
**Impact**: Complete service outage in primary region
**Response Time**: 2-4 hours (manual failover to DR region)

#### DR Region Activation Procedure

##### Phase 1: Assessment and Decision (0-30 minutes)
1. **Incident Commander Assignment**: Platform Lead becomes IC
2. **Stakeholder Notification**: Notify executive team, customers
3. **Scope Assessment**: Determine extent of regional outage
4. **DR Decision**: Formal decision to activate DR site

##### Phase 2: Infrastructure Activation (30-90 minutes)
```bash
# Switch to DR region
export AWS_DEFAULT_REGION=ap-southeast-4

# 1. Restore database from latest backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier liquid-abt-dr-$(date +%Y%m%d) \
  --db-snapshot-identifier rds:liquid-abt-production-$(date +%Y-%m-%d -d '1 day ago')-automated

# 2. Start EKS cluster
aws eks update-kubeconfig --name liquid-abt-dr --region ap-southeast-4

# 3. Deploy application
kubectl apply -k k8s/dr/

# 4. Scale up pods
kubectl scale deployment liquid-abt-app --replicas=3 -n liquid-abt-dr

# 5. Update load balancer health checks
aws elbv2 modify-target-group --target-group-arn $DR_TARGET_GROUP_ARN \
  --health-check-path /api/health
```

##### Phase 3: DNS and Traffic Routing (90-120 minutes)
```bash
# Update Route 53 records to point to DR region
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "app.liquidtreasury.business",
        "Type": "CNAME",
        "TTL": 60,
        "ResourceRecords": [{"Value": "dr-alb.ap-southeast-4.elb.amazonaws.com"}]
      }
    }]
  }'

# Update health check endpoints
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "status.liquidtreasury.business",
        "Type": "CNAME",
        "TTL": 60,
        "ResourceRecords": [{"Value": "dr-status.ap-southeast-4.elb.amazonaws.com"}]
      }
    }]
  }'
```

##### Phase 4: Service Verification (120-150 minutes)
```bash
# Test critical endpoints
curl -f https://app.liquidtreasury.business/api/health
curl -f https://app.liquidtreasury.business/api/auth/status

# Test database connectivity
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-dr -- \
  psql $DATABASE_URL -c "SELECT count(*) FROM tenants;"

# Test Redis connectivity
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-dr -- \
  redis-cli -h $REDIS_HOST ping

# Run smoke tests
npm run test:smoke -- --base-url=https://app.liquidtreasury.business
```

##### Phase 5: Service Restoration (150-240 minutes)
1. **Background Jobs**: Restart queue processing
2. **External Integrations**: Verify payment processor webhooks
3. **Monitoring**: Configure alerts for DR environment
4. **Customer Notification**: Update status page, send communications

### Scenario 4: Data Corruption or Breach

**Detection**: Integrity checks, security monitoring, customer reports
**Impact**: Potential data loss, security compromise
**Response Time**: 30 minutes to 2 hours

#### Data Corruption Response
```bash
# 1. Isolate affected systems
kubectl scale deployment liquid-abt-app --replicas=0 -n liquid-abt-production

# 2. Assess corruption extent
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  node scripts/assess-data-corruption.js

# 3. Restore from clean backup
./scripts/restore-database.sh restore full/liquid_abt_full_$(date +%Y%m%d)_020000.sql.gz

# 4. Verify data integrity
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  node scripts/verify-data-integrity.js

# 5. Gradual service restoration
kubectl scale deployment liquid-abt-app --replicas=1 -n liquid-abt-production
# Monitor and scale up gradually
```

#### Security Breach Response
```bash
# 1. Immediate isolation
kubectl delete ingress liquid-abt-ingress -n liquid-abt-production

# 2. Revoke all JWT tokens
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  redis-cli -h $REDIS_HOST flushdb

# 3. Rotate all secrets
kubectl delete secret liquid-abt-secrets -n liquid-abt-production
kubectl apply -f k8s/production/secrets-rotated.yaml

# 4. Force password resets
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  node scripts/force-password-reset.js

# 5. Audit and investigate
kubectl exec -it deployment/liquid-abt-app -n liquid-abt-production -- \
  node scripts/security-audit.js --incident-mode
```

## Recovery Procedures by Component

### Database Recovery

#### Automated Backups
- **Frequency**: Every 6 hours with point-in-time recovery
- **Retention**: 7 days for automated snapshots
- **Cross-Region**: Daily copy to Melbourne region

#### Manual Database Recovery
```bash
# List available backups
aws rds describe-db-snapshots \
  --db-instance-identifier liquid-abt-production \
  --snapshot-type automated

# Restore specific backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier liquid-abt-restored-$(date +%Y%m%d) \
  --db-snapshot-identifier rds:liquid-abt-production-2025-01-06-02-00

# Create read replica for zero-downtime migration
aws rds create-db-instance-read-replica \
  --db-instance-identifier liquid-abt-migration-replica \
  --source-db-instance-identifier liquid-abt-restored-$(date +%Y%m%d)

# Promote read replica to standalone database
aws rds promote-read-replica \
  --db-instance-identifier liquid-abt-migration-replica
```

### Application Recovery

#### Container Image Recovery
```bash
# Pull previous known-good image
docker pull ghcr.io/liquidtreasury/liquid-abt:v1.2.3

# Update Kubernetes deployment
kubectl set image deployment/liquid-abt-app \
  app=ghcr.io/liquidtreasury/liquid-abt:v1.2.3 \
  -n liquid-abt-production

# Verify rollout
kubectl rollout status deployment/liquid-abt-app -n liquid-abt-production
```

#### Configuration Recovery
```bash
# Restore from Git configuration
git checkout production-config-$(date +%Y%m%d)
kubectl apply -k k8s/production/

# Restore secrets from AWS Systems Manager
aws ssm get-parameters-by-path \
  --path "/liquid-abt/production/secrets" \
  --recursive \
  --with-decryption \
  | jq -r '.Parameters[] | "\(.Name | split("/")[-1])=\(.Value)"' \
  > /tmp/restored-secrets.env

# Create new secret
kubectl create secret generic liquid-abt-secrets \
  --from-env-file=/tmp/restored-secrets.env \
  -n liquid-abt-production
```

### Cache Recovery

#### Redis Cluster Recovery
```bash
# Check cluster status
aws elasticache describe-replication-groups \
  --replication-group-id liquid-abt-production

# If cluster is down, recreate
aws elasticache create-replication-group \
  --replication-group-id liquid-abt-dr-$(date +%Y%m%d) \
  --description "DR Redis cluster" \
  --num-cache-clusters 3 \
  --cache-node-type cache.r6g.large

# Update application configuration
kubectl patch deployment liquid-abt-app -n liquid-abt-production \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","env":[{"name":"REDIS_URL","value":"redis://new-cluster-endpoint:6379"}]}]}}}}'
```

## Monitoring and Alerting During DR

### Critical Metrics Dashboard
- **Service Availability**: Health check success rate
- **Database Performance**: Connection count, query response time
- **Application Performance**: Response times, error rates
- **Infrastructure**: CPU, memory, network utilization

### Alert Escalation During DR
1. **Level 1 (0-15 min)**: On-call engineer, Slack notifications
2. **Level 2 (15-30 min)**: Platform lead, email alerts
3. **Level 3 (30-60 min)**: Engineering manager, phone calls
4. **Level 4 (60+ min)**: CTO, executive team

### Communication Plan

#### Internal Communication
- **Slack Channel**: #incident-response (real-time updates)
- **Status Calls**: Every 30 minutes during active incident
- **Documentation**: All actions logged in incident management system

#### External Communication
- **Status Page**: https://status.liquidtreasury.business
- **Customer Email**: Automated notifications for major outages
- **Social Media**: Twitter updates for widespread issues
- **Partner Notification**: Direct communication to key partners

## Testing and Validation

### DR Testing Schedule
- **Monthly**: Database backup/restore testing
- **Quarterly**: Partial DR site activation
- **Semi-annually**: Full DR failover test
- **Annually**: Comprehensive DR exercise with all stakeholders

### Test Procedures

#### Database Recovery Test
```bash
# 1. Create test restore environment
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier liquid-abt-test-restore \
  --db-snapshot-identifier rds:liquid-abt-production-latest

# 2. Verify data integrity
kubectl run test-pod --image=liquid-abt:latest -- \
  psql $TEST_DATABASE_URL -c "SELECT count(*) FROM bitcoin_purchases;"

# 3. Test application connectivity
kubectl run app-test --image=liquid-abt:latest --env="DATABASE_URL=$TEST_DATABASE_URL" -- \
  npm run test:database

# 4. Clean up test resources
aws rds delete-db-instance \
  --db-instance-identifier liquid-abt-test-restore \
  --skip-final-snapshot
```

#### Application Recovery Test
```bash
# 1. Deploy to staging with restored data
kubectl apply -k k8s/staging/ --dry-run=server

# 2. Run integration tests
npm run test:integration -- --env=staging

# 3. Load test critical endpoints
k6 run tests/load/critical-paths.js --env=staging

# 4. Verify external integrations
npm run test:integrations -- --env=staging
```

## Recovery Validation Checklist

### Technical Validation
- [ ] All pods are running and healthy
- [ ] Database connections successful
- [ ] Cache connectivity verified
- [ ] External API integrations working
- [ ] SSL certificates valid
- [ ] DNS resolution correct
- [ ] Load balancer health checks passing

### Functional Validation
- [ ] User authentication working
- [ ] Bitcoin purchase flow operational
- [ ] Payment processor webhooks processing
- [ ] Treasury rules executing
- [ ] Notifications being sent
- [ ] Reports generating correctly
- [ ] Audit logs being written

### Business Validation
- [ ] Customer accounts accessible
- [ ] Transaction history complete
- [ ] Compliance reports accurate
- [ ] No data loss detected
- [ ] Performance within SLO targets
- [ ] All critical business functions operational

## Post-Incident Procedures

### Immediate Post-Recovery (0-24 hours)
1. **System Monitoring**: Intensive monitoring for 24 hours
2. **Performance Tuning**: Optimize recovered systems
3. **Data Validation**: Comprehensive integrity checks
4. **Customer Communication**: Service restoration announcement

### Short-term Follow-up (1-7 days)
1. **Incident Analysis**: Root cause investigation
2. **Process Review**: Evaluate DR procedures effectiveness
3. **Documentation Update**: Record lessons learned
4. **Training Updates**: Revise DR training materials

### Long-term Improvements (1-4 weeks)
1. **Infrastructure Changes**: Implement preventive measures
2. **Procedure Updates**: Revise DR plans based on experience
3. **Tool Enhancements**: Improve monitoring and automation
4. **Team Training**: Conduct DR drills with updated procedures

## Recovery Cost Estimation

### DR Infrastructure Costs
- **Standby EKS Cluster**: $200/month (minimal nodes)
- **Standby RDS Instance**: $150/month (stopped when not in use)
- **Cross-Region Replication**: $50/month (S3 storage)
- **DNS and Load Balancer**: $25/month
- **Total Monthly DR Cost**: ~$425

### Recovery Scenario Costs
- **Database Failover**: $0 (automated, included in Multi-AZ)
- **Region Failover**: $500-1000 (temporary resources during recovery)
- **Data Corruption Recovery**: $200-500 (additional compute for restoration)
- **Security Breach Response**: $1000-2000 (forensics, additional security measures)

### Business Impact Costs
- **Revenue Loss**: ~$10,000/hour during complete outage
- **Customer Churn**: Estimated 2-5% for outages >4 hours
- **Compliance Penalties**: Potential AUD $50,000+ for extended data unavailability
- **Reputation Impact**: Difficult to quantify, but significant for trust-based platform

## Key Contacts and Information

### Emergency Contacts
- **Incident Commander**: +61 XXX XXX XXX
- **Platform Team Lead**: +61 XXX XXX XXX  
- **Database Administrator**: +61 XXX XXX XXX
- **Security Team**: +61 XXX XXX XXX

### Vendor Support
- **AWS Support**: Premium Support (24/7 phone)
- **GitHub Support**: Enterprise Support
- **ZeroCap Emergency**: +61 XXX XXX XXX
- **Sentry Support**: Enterprise Tier

### Access Credentials
- **AWS Console**: Stored in 1Password (Emergency Access)
- **Kubernetes**: Service account tokens in AWS Systems Manager
- **Database**: Connection strings in Kubernetes secrets
- **Monitoring**: Credentials in team password manager

### Documentation Links
- **Runbook**: https://docs.liquidtreasury.business/runbook
- **Architecture**: https://docs.liquidtreasury.business/architecture  
- **API Documentation**: https://docs.liquidtreasury.business/api
- **Incident Management**: https://incidents.liquidtreasury.business

---

**Document Information**
- **Version**: 1.0
- **Last Updated**: January 6, 2025
- **Next Review**: April 6, 2025
- **Owner**: Platform Engineering Team
- **Approved By**: CTO, Head of Engineering
- **Distribution**: Engineering, Operations, Executive Team