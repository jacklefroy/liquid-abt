# LIQUID ABT - System Architecture Documentation

## Overview

LIQUID Automated Bitcoin Treasury (ABT) is a multi-tenant SaaS platform built on modern cloud-native architecture. The system is designed to handle 100,000+ Australian SMEs with automated Bitcoin treasury management while maintaining strict security, compliance, and performance requirements.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Applications                      │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Web Dashboard │   Mobile App    │   API Integrations      │
└─────────────────┴─────────────────┴─────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│                 Application Load Balancer                   │
│                     (AWS ALB)                              │
└─────────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│                   Kubernetes Cluster                        │
│                      (AWS EKS)                             │
├─────────────────┬─────────────────┬─────────────────────────┤
│  Application    │  Background     │   Monitoring &          │
│  Pods (2-10)    │  Workers (3-6)  │   Logging               │
└─────────────────┴─────────────────┴─────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│                    Data Layer                               │
├─────────────────┬─────────────────┬─────────────────────────┤
│  PostgreSQL     │  Redis Cache    │   Object Storage        │
│  (AWS RDS)      │ (ElastiCache)   │     (AWS S3)           │
└─────────────────┴─────────────────┴─────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│                 External Integrations                       │
├─────────────────┬─────────────────┬─────────────────────────┤
│  Bitcoin        │   Payment       │    Compliance &        │
│  Exchanges      │  Processors     │    Monitoring           │
│ (ZeroCap/Kraken)│ (Stripe/Square) │  (Sentry/DataDog)      │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Core Components

### 1. Application Layer

#### Main Application Service
- **Technology**: Node.js 18+ with TypeScript
- **Framework**: Express.js with security middleware
- **Replicas**: 2-10 pods (auto-scaling)
- **Resources**: 256Mi-512Mi RAM, 250m-500m CPU per pod
- **Responsibilities**:
  - REST API endpoints
  - Authentication and authorization
  - Multi-tenant request routing
  - Real-time dashboard updates
  - Webhook processing

#### Background Worker Service  
- **Technology**: Node.js with Bull Queue
- **Replicas**: 3-6 workers (auto-scaling)
- **Resources**: 512Mi-1Gi RAM, 500m-1000m CPU per pod
- **Responsibilities**:
  - Bitcoin purchase execution
  - Payment processor webhook processing
  - Scheduled treasury rules execution
  - Email/SMS notifications
  - Compliance reporting generation

### 2. Data Layer

#### Primary Database (PostgreSQL)
- **Service**: AWS RDS PostgreSQL 15
- **Configuration**: Multi-AZ with read replicas
- **Storage**: GP3 SSD with automated backup
- **Connection Pool**: 20 max connections per app pod
- **Schema Design**: Multi-tenant with schema isolation

**Key Tables**:
```sql
-- Tenant management
tenants (id, tenant_id, name, plan, settings, created_at)

-- User management  
users (id, tenant_id, email, role, permissions, created_at)

-- Treasury rules
treasury_rules (id, tenant_id, name, type, config, enabled, created_at)

-- Bitcoin purchases
bitcoin_purchases (id, tenant_id, amount, bitcoin_amount, price, status, created_at)

-- Payment integrations
payment_integrations (id, tenant_id, provider, account_id, credentials, status)

-- Audit trail
audit_events (id, tenant_id, user_id, event_type, details, hash, created_at)
```

#### Cache Layer (Redis)
- **Service**: AWS ElastiCache Redis 7.0
- **Configuration**: Cluster mode with 3 nodes
- **Use Cases**:
  - Session storage (JWT tokens)
  - API response caching
  - Rate limiting counters
  - Real-time Bitcoin pricing
  - Queue management (Bull Queue)
  - Circuit breaker state

#### Object Storage (S3)
- **Service**: AWS S3 with CloudFront CDN
- **Buckets**:
  - `liquid-abt-documents`: Tax reports, compliance documents
  - `liquid-abt-backups`: Database backups and archives
  - `liquid-abt-logs`: Application logs (long-term storage)
  - `liquid-abt-assets`: Static assets and uploads

### 3. Security Layer

#### Authentication & Authorization
- **JWT Tokens**: 24-hour expiry with refresh tokens
- **Multi-Factor Authentication**: TOTP support
- **Role-Based Access Control**: Owner, Admin, User, Viewer roles
- **API Rate Limiting**: Per-user and per-endpoint limits
- **CORS Configuration**: Whitelist for known domains

#### Data Protection
- **Encryption at Rest**: AES-256 for all stored data
- **Encryption in Transit**: TLS 1.3 for all communications
- **Secrets Management**: AWS Systems Manager Parameter Store
- **Key Rotation**: Automated 90-day rotation cycle
- **Data Anonymization**: PII scrubbing in logs and analytics

#### Network Security
- **VPC**: Private subnets for database and cache
- **Security Groups**: Restrictive inbound/outbound rules
- **WAF**: AWS WAF with OWASP Top 10 protection
- **DDoS Protection**: AWS Shield Advanced
- **Intrusion Detection**: AWS GuardDuty

### 4. Multi-Tenancy Architecture

#### Schema-Based Isolation
Each tenant gets a dedicated PostgreSQL schema:
```sql
-- Tenant schemas
CREATE SCHEMA tenant_12345678_abcd_1234_5678_123456789012;
CREATE SCHEMA tenant_87654321_dcba_4321_8765_210987654321;

-- Data isolation example
SELECT * FROM tenant_12345678_abcd_1234_5678_123456789012.bitcoin_purchases;
```

#### Request Flow
1. **Authentication**: JWT token validation with tenant context
2. **Tenant Resolution**: Extract tenant ID from token claims
3. **Schema Switching**: Database queries use tenant-specific schema
4. **Response Filtering**: Ensure no cross-tenant data leakage

#### Resource Isolation
- **Database**: Schema-level isolation with row-level security
- **Cache**: Tenant-prefixed keys (e.g., `tenant:12345:session:abc`)
- **Storage**: Tenant-specific S3 prefixes
- **Logging**: Tenant ID in all log entries

### 5. External Integrations

#### Bitcoin Exchanges

**Primary: ZeroCap**
- **Type**: Institutional Bitcoin exchange
- **API**: REST API with webhook support
- **Settlement**: 10-second average execution
- **Backup**: Automatic failover to Swyftx

**Secondary: Kraken**
- **Type**: Professional Bitcoin exchange  
- **API**: REST API with rate limiting
- **Settlement**: 60-second average execution
- **Use Case**: High-volume transactions and testing

#### Payment Processors

**Stripe Connect**
- **OAuth Flow**: Automated merchant onboarding
- **Webhooks**: Real-time payment notifications
- **Multi-Account**: Support for multiple Stripe accounts per tenant

**Square**  
- **OAuth Flow**: Point-of-sale integration
- **Webhooks**: Transaction and refund events
- **Features**: In-person and online payments

**PayPal**
- **REST API**: Payment processing and webhooks
- **Features**: International payment support

#### Accounting Software

**Xero Integration**
- **OAuth 2.0**: Automated connection flow
- **Real-time Sync**: Automatic transaction recording
- **Features**: CGT calculations and BAS generation

**MYOB Integration**
- **API Access**: Business account integration
- **Features**: Australian tax compliance automation

## Deployment Architecture

### Infrastructure as Code (Terraform)

```hcl
# EKS Cluster
resource "aws_eks_cluster" "liquid_abt" {
  name     = "liquid-abt-${var.environment}"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = "1.27"

  vpc_config {
    subnet_ids              = var.subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = true
  }
}

# RDS PostgreSQL
resource "aws_db_instance" "postgres" {
  identifier           = "liquid-abt-${var.environment}"
  engine              = "postgres"
  engine_version      = "15.4"
  instance_class      = var.db_instance_class
  allocated_storage   = var.db_allocated_storage
  storage_encrypted   = true
  multi_az           = var.environment == "production"
  
  db_name  = "liquid_abt"
  username = var.db_username
  password = var.db_password
  
  backup_retention_period = 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"
}

# ElastiCache Redis
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id         = "liquid-abt-${var.environment}"
  description                  = "Redis cluster for LIQUID ABT"
  port                         = 6379
  parameter_group_name         = "default.redis7"
  node_type                    = var.redis_node_type
  num_cache_clusters           = var.redis_num_nodes
  at_rest_encryption_enabled   = true
  transit_encryption_enabled   = true
}
```

### Kubernetes Configuration

```yaml
# Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: liquid-abt-app
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    spec:
      containers:
      - name: app
        image: liquid-abt:latest
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"  
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 60
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10

---
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: liquid-abt-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: liquid-abt-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### CI/CD Pipeline (GitHub Actions)

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test_password
          POSTGRES_USER: test_user
          POSTGRES_DB: test_db
      redis:
        image: redis:7-alpine
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
    - run: npm ci
    - run: npm run type-check
    - run: npm run lint  
    - run: npm run test
    - run: npm run test:integration

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: docker/build-push-action@v5
      with:
        context: .
        push: true
        tags: ghcr.io/${{ github.repository }}/liquid-abt:${{ github.sha }}

  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
    - uses: azure/k8s-deploy@v1
      with:
        manifests: k8s/staging/
        images: ghcr.io/${{ github.repository }}/liquid-abt:${{ github.sha }}
        
  deploy-production:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
    - uses: azure/k8s-deploy@v1
      with:
        manifests: k8s/production/
        images: ghcr.io/${{ github.repository }}/liquid-abt:${{ github.sha }}
```

## Monitoring and Observability

### Application Performance Monitoring (APM)

**Sentry Integration**
- **Error Tracking**: Real-time error capture and alerting
- **Performance Monitoring**: Transaction tracing and bottleneck identification
- **Release Tracking**: Deploy-based error correlation

**Custom Metrics**
```typescript
// Business metrics
await metrics.recordBitcoinPurchase(tenantId, amount, processingTime);
await metrics.recordExchangeApiCall(exchange, operation, duration, success);

// System metrics  
await metrics.recordResponseTime(endpoint, method, duration);
await metrics.recordThroughput(endpoint);
await metrics.recordError(endpoint, error);
```

**Prometheus & Grafana**
- **System Metrics**: CPU, memory, network, disk usage
- **Application Metrics**: Request rates, error rates, response times
- **Business KPIs**: Purchase volumes, conversion rates, customer growth
- **Infrastructure Metrics**: Database connections, cache hit rates

### Logging Strategy

**Structured Logging (Winston)**
```typescript
logger.info('Bitcoin purchase initiated', {
  tenantId: 'tenant-123',
  purchaseId: 'purchase-456', 
  amount: 1000.00,
  correlationId: 'req-789',
  userId: 'user-101'
});
```

**Log Aggregation (CloudWatch)**
- **Application Logs**: Structured JSON with correlation IDs
- **System Logs**: Kubernetes container logs
- **Access Logs**: ALB access logs with request tracking
- **Audit Logs**: Compliance and security events

**Log Retention**
- **Application Logs**: 30 days in CloudWatch, 7 years in S3
- **Audit Logs**: 7 years in encrypted S3 storage
- **Access Logs**: 90 days for analysis, 1 year archived

### Alerting Configuration

**Critical Alerts (PagerDuty)**
- Application health check failures
- Database connection failures  
- High error rates (>5% for 5 minutes)
- Bitcoin purchase failure rate >10%
- Security events (unauthorized access attempts)

**Warning Alerts (Slack)**
- High response times (p95 > 3 seconds)
- Resource usage >80% (CPU/Memory)
- Queue length >500 jobs
- Exchange API latency >5 seconds

## Security Architecture

### Network Security

**VPC Configuration**
```
Public Subnets (ALB):     10.0.1.0/24, 10.0.2.0/24
Private Subnets (EKS):    10.0.10.0/24, 10.0.11.0/24  
Database Subnets:         10.0.20.0/24, 10.0.21.0/24
```

**Security Groups**
```yaml
ALB Security Group:
  Inbound: 443 (HTTPS) from 0.0.0.0/0
  Outbound: 3000 (App) to EKS Security Group

EKS Security Group:  
  Inbound: 3000 from ALB Security Group
  Outbound: 5432 (PostgreSQL) to Database Security Group
  Outbound: 6379 (Redis) to Cache Security Group
  Outbound: 443 (HTTPS) to 0.0.0.0/0

Database Security Group:
  Inbound: 5432 from EKS Security Group only
```

### Compliance Framework

**Australian Regulatory Compliance**
- **AUSTRAC**: AML/CTF compliance monitoring
- **ATO**: Automated CGT calculations and reporting  
- **Privacy Act**: Data protection and privacy controls
- **Corporations Act**: Financial record keeping requirements

**Data Governance**
- **Data Classification**: Public, Internal, Confidential, Restricted
- **Data Retention**: Automated policies based on regulation requirements
- **Data Anonymization**: PII removal from non-production environments
- **Right to Erasure**: GDPR-compliant data deletion processes

**Audit & Compliance Monitoring**
```typescript
// Immutable audit trail
const auditEvent = {
  id: generateUUID(),
  tenantId,
  userId,
  eventType: 'bitcoin_purchase_completed',
  details: { purchaseId, amount },
  timestamp: new Date(),
  hash: calculateHash(previousHash + eventData)
};

await auditTrail.logEvent(auditEvent);
```

## Scalability & Performance

### Horizontal Scaling

**Application Tier**
- **Auto-scaling**: Based on CPU/Memory metrics
- **Load Distribution**: Round-robin with session affinity
- **Stateless Design**: No server-side session storage

**Database Tier**  
- **Read Replicas**: 2 read-only replicas for query distribution
- **Connection Pooling**: PgBouncer with 20 connections per app pod
- **Query Optimization**: Automated indexing recommendations

**Cache Tier**
- **Redis Cluster**: 3-node cluster with automatic failover
- **Cache Strategies**: Write-through, write-behind, and cache-aside
- **Cache Invalidation**: Tag-based invalidation system

### Performance Optimization

**Database Performance**
- **Indexing Strategy**: Composite indexes on tenant_id + timestamp
- **Query Optimization**: Prepared statements and query caching
- **Partitioning**: Time-based partitioning for large tables
- **Connection Pooling**: Optimized pool sizes per environment

**Application Performance**
- **Code Optimization**: Async/await patterns, streaming responses
- **Memory Management**: Garbage collection tuning
- **CPU Optimization**: Worker thread utilization for heavy operations
- **Bundle Optimization**: Tree shaking and code splitting

**Caching Strategy**
```typescript
// Smart caching with TTL and tags
await cache.set(cacheKey, data, {
  ttl: 300,  // 5 minutes
  tags: ['treasury_data', `tenant:${tenantId}`]
});

// Invalidate by tags
await cache.invalidateByTag(`tenant:${tenantId}`);
```

## Disaster Recovery

### Backup Strategy

**Database Backups**
- **Automated Snapshots**: Daily automated snapshots (7-day retention)
- **Point-in-time Recovery**: 7-day window for precise recovery
- **Cross-region Backup**: Weekly backups replicated to us-west-2
- **Backup Testing**: Monthly restore tests to validate integrity

**Application Data Backups**
- **Configuration Backup**: Git-based configuration management
- **Secrets Backup**: AWS Systems Manager Parameter Store replication  
- **File Storage Backup**: S3 cross-region replication
- **Code Repository**: GitHub with automated mirroring

### Recovery Procedures

**RTO/RPO Targets**
- **Recovery Time Objective (RTO)**: 4 hours
- **Recovery Point Objective (RPO)**: 1 hour
- **Data Loss Tolerance**: Maximum 1 hour of transactions

**Failover Scenarios**
1. **Database Failover**: Automated Multi-AZ failover (2-3 minutes)
2. **Application Failover**: Rolling deployment to healthy nodes
3. **Region Failover**: Manual failover to us-west-2 (4 hours)
4. **Complete Disaster**: Full restore from backups (4 hours)

### High Availability Design

**Application Layer HA**
- **Multi-AZ Deployment**: Pods distributed across availability zones
- **Health Checks**: Kubernetes liveness and readiness probes
- **Circuit Breakers**: Automatic failover for external API failures
- **Graceful Degradation**: Core functionality maintained during outages

**Data Layer HA**
- **Database**: Multi-AZ deployment with automatic failover
- **Cache**: Redis cluster with automatic node replacement  
- **Storage**: S3 with 99.999999999% durability
- **Networking**: Multiple availability zones with load balancing

---

**Document Information**
- **Version**: 1.0
- **Last Updated**: January 6, 2025
- **Author**: Platform Engineering Team
- **Review Cycle**: Quarterly
- **Distribution**: Engineering, Operations, Security Teams