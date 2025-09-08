# LIQUID ABT Security Documentation

## Executive Summary

LIQUID ABT is a multi-tenant SaaS Bitcoin treasury platform designed with security-first principles. This document outlines our comprehensive security measures, architecture, and compliance frameworks to support third-party security reviews and audits.

## Security Architecture Overview

### Multi-Tenant Security Model
- **Tenant Isolation**: Database schema-level isolation using tenant UUIDs
- **Cross-Tenant Protection**: JWT token validation with tenant context verification
- **Data Segregation**: Complete data separation between tenants at all levels
- **Access Control**: Role-based permissions with tenant boundary enforcement

### Authentication & Authorization
- **JWT Tokens**: Stateless authentication with secure token generation
- **Multi-Factor Authentication**: TOTP support for enhanced security
- **Role-Based Access Control**: Owner, Admin, User, Viewer roles with granular permissions
- **Session Management**: Secure session handling with proper timeout and invalidation

## Infrastructure Security

### AWS Security Framework
- **VPC Isolation**: Private subnets with controlled internet access
- **Security Groups**: Restrictive inbound/outbound rules
- **WAF Protection**: Web Application Firewall for DDoS and attack mitigation
- **GuardDuty**: Threat detection and continuous security monitoring
- **Security Hub**: Centralized security findings and compliance dashboard

### Database Security
- **Encryption at Rest**: AES-256 encryption for all stored data
- **Encryption in Transit**: TLS 1.3 for all database connections
- **Connection Pooling**: Secure connection management with credential rotation
- **Backup Encryption**: All backups encrypted with separate keys
- **Schema Isolation**: Tenant data completely separated at database level

### Application Security
- **Input Validation**: Comprehensive validation on all user inputs
- **Output Encoding**: HTML/JSON encoding to prevent XSS
- **SQL Injection Prevention**: Parameterized queries exclusively
- **CSRF Protection**: Token-based CSRF protection for state-changing operations
- **Rate Limiting**: Comprehensive rate limiting across all endpoints

## Security Controls Implementation

### 1. Input Security
- **Validation Framework**: Joi validation schemas for all inputs
- **Sanitization**: Input sanitization before processing
- **Type Checking**: TypeScript strict mode with runtime validation
- **File Upload Security**: Content type validation and virus scanning

### 2. Output Security
- **Response Headers**: Security headers (CSP, HSTS, X-Frame-Options)
- **Content Type Enforcement**: Strict content type validation
- **JSON Encoding**: Proper JSON encoding to prevent injection
- **Error Handling**: Secure error responses without sensitive information

### 3. Authentication Security
- **Password Policy**: Strong password requirements (12+ chars, complexity)
- **Account Lockout**: Progressive lockout after failed attempts
- **Session Security**: Secure session tokens with proper expiration
- **Token Rotation**: Regular JWT token rotation and blacklisting

### 4. API Security
- **OAuth 2.0**: Secure third-party integrations with proper scoping
- **Webhook Security**: HMAC signature verification for all webhooks
- **Rate Limiting**: Per-endpoint and per-user rate limiting
- **API Versioning**: Versioned APIs with backward compatibility

## Data Protection & Privacy

### Encryption Standards
- **Data at Rest**: AES-256-GCM encryption
- **Data in Transit**: TLS 1.3 minimum
- **Key Management**: AWS KMS with key rotation
- **Secret Management**: AWS Systems Manager Parameter Store

### Data Classification
- **Public**: Marketing materials, public documentation
- **Internal**: System logs, analytics data
- **Confidential**: User data, transaction records
- **Restricted**: Authentication credentials, private keys

### Data Retention & Disposal
- **Retention Policy**: 7-year retention for Australian tax compliance
- **Secure Deletion**: Cryptographic erasure for data disposal
- **Right to Erasure**: GDPR-compliant data deletion procedures
- **Backup Management**: Encrypted backups with secure disposal

## Compliance Framework

### Australian Regulatory Compliance
- **ATO Requirements**: Complete transaction audit trails
- **AUSTRAC Compliance**: Anti-money laundering monitoring
- **Privacy Act**: Australian Privacy Principles compliance
- **Data Sovereignty**: All data stored in Australian data centers

### International Standards
- **ISO 27001**: Information Security Management System
- **SOC 2 Type II**: Security, availability, and confidentiality controls
- **PCI DSS**: Payment card industry compliance (Level 1)
- **GDPR**: General Data Protection Regulation compliance

## Security Monitoring & Incident Response

### Monitoring Systems
- **Real-time Monitoring**: CloudWatch metrics and alarms
- **Security Information and Event Management (SIEM)**: Centralized logging
- **Intrusion Detection**: Network and host-based intrusion detection
- **Vulnerability Scanning**: Regular automated vulnerability assessments

### Incident Response Plan
- **Detection**: Automated alerting and monitoring
- **Assessment**: Incident classification and impact assessment
- **Containment**: Immediate threat containment procedures
- **Recovery**: System restoration and business continuity
- **Post-Incident**: Forensic analysis and process improvement

## Bitcoin-Specific Security

### Core Philosophy: "Your Cash, Your Bitcoin, Your Keys"
LIQUID ABT operates as a **non-custodial Bitcoin treasury platform**, meaning we never take possession of Bitcoin or hold client funds. Our security model is built around this fundamental principle.

### Bitcoin Address Validation & Security
- **Multi-Format Support**: Validates Legacy (1xxx), SegWit (3xxx), and Bech32 (bc1xxx) address formats
- **Checksum Verification**: Full Bitcoin address checksum validation to prevent typos and invalid addresses
- **Network Validation**: Ensures addresses are valid for Bitcoin mainnet (prevents testnet address usage)
- **Address Whitelisting**: Clients can maintain approved withdrawal address lists for enhanced security
- **Change Detection**: System alerts when client attempts to modify withdrawal addresses
- **Multi-Signature Support**: Validation of multi-signature address formats for institutional clients

### Transaction Security & Bitcoin Operations
- **Never-Custody Model**: LIQUID ABT never touches Bitcoin - all purchases automatically sent to client addresses
- **Immediate Withdrawal**: Bitcoin purchased through DCE partners is immediately withdrawn to client wallets
- **No Hot Wallet Risk**: Zero Bitcoin held in LIQUID systems eliminates custody security risks
- **Transaction Monitoring**: Real-time monitoring of all Bitcoin withdrawal transactions
- **Confirmation Tracking**: Multi-confirmation verification before marking transactions as complete
- **Failed Transaction Handling**: Automated retry logic with exponential backoff for failed withdrawals

### Bitcoin Network Security
- **Dynamic Fee Estimation**: Real-time Bitcoin network fee estimation to ensure timely confirmations
- **Replace-by-Fee (RBF) Support**: Handles RBF transactions from DCE partners appropriately
- **Mempool Monitoring**: Real-time Bitcoin mempool analysis for optimal transaction timing
- **Confirmation Requirements**: Configurable confirmation thresholds based on transaction amounts
- **Chain Reorganization Handling**: Robust handling of blockchain reorganizations and orphaned blocks
- **Network Congestion Management**: Adaptive strategies during high network congestion periods

### DCE Partner Integration Security
- **Licensed Exchange Partners**: Only AUSTRAC-registered DCE partners (ZeroCap, Independent Reserve, BTC Markets)
- **API Authentication**: Secure API key management with read-only permissions where possible
- **Order Verification**: Multi-layer verification of Bitcoin purchase orders before execution
- **Settlement Monitoring**: Real-time monitoring of DCE settlement processes
- **Failover Mechanisms**: Automatic failover to backup DCE partners during outages
- **Rate Limit Compliance**: Strict adherence to partner API rate limits and usage policies

### Self-Custody Security Guarantees
- **Zero Custodial Risk**: LIQUID ABT maintains no Bitcoin wallets or private keys
- **Client Sovereignty**: Clients maintain complete control over their Bitcoin at all times
- **Withdrawal Automation**: Automated withdrawal processes eliminate manual intervention risks
- **Address Verification**: Multiple verification steps before Bitcoin withdrawal execution
- **Transaction Immutability**: All Bitcoin transactions recorded in immutable audit trails
- **Private Key Isolation**: LIQUID systems never generate, store, or access Bitcoin private keys

### ZeroCap API Security (Primary DCE Partner)
- **Institutional-Grade Integration**: Secure integration with ZeroCap's institutional trading platform
- **Order Authentication**: HMAC-SHA256 signature authentication for all trading orders
- **Settlement Verification**: Real-time verification of Bitcoin settlement to client addresses
- **Balance Monitoring**: Continuous monitoring of DCE balances to prevent over-trading
- **Circuit Breakers**: Automated trading halts during unusual market or system conditions
- **Compliance Integration**: Automated AUSTRAC reporting through ZeroCap's compliance systems

### Bitcoin Treasury Risk Management
- **Price Slippage Protection**: Maximum slippage limits on all Bitcoin purchases
- **Volume Limits**: Configurable daily/monthly volume limits per client
- **Market Impact Analysis**: Assessment of market impact for large Bitcoin purchases
- **Liquidity Monitoring**: Real-time monitoring of DCE liquidity across trading pairs
- **Counterparty Risk Management**: Diversification across multiple licensed DCE partners
- **Emergency Halt Procedures**: Manual override capabilities for treasury operations

## Third-Party Integration Security

### Payment Processor Security
- **OAuth 2.0**: Secure authorization flows
- **Token Management**: Secure storage and rotation of API tokens
- **Webhook Validation**: HMAC signature verification
- **Data Minimization**: Only necessary data collected and stored

### Exchange Integration Security
- **API Key Management**: Secure storage with minimal permissions
- **Transaction Validation**: Multi-layer transaction verification
- **Rate Limiting**: Exchange-specific rate limit compliance
- **Failover Security**: Secure failover to backup exchanges

## Security Testing & Validation

### Automated Security Testing
- **Static Analysis**: Code analysis for security vulnerabilities
- **Dynamic Testing**: Runtime security testing
- **Dependency Scanning**: Third-party library vulnerability scanning
- **Infrastructure Testing**: Infrastructure configuration validation

### Penetration Testing
- **External Testing**: Third-party penetration testing quarterly
- **Internal Testing**: Monthly internal security assessments
- **Red Team Exercises**: Simulated attack scenarios
- **Bug Bounty Program**: External security researcher participation

## Business Continuity & Disaster Recovery

### Backup Strategy
- **Automated Backups**: Daily encrypted backups with 30-day retention
- **Cross-Region Replication**: Backups stored in multiple AWS regions
- **Recovery Testing**: Monthly backup restoration testing
- **Point-in-Time Recovery**: Database point-in-time recovery capability

### Disaster Recovery Plan
- **RTO (Recovery Time Objective)**: 4 hours maximum downtime
- **RPO (Recovery Point Objective)**: 15 minutes maximum data loss
- **Failover Procedures**: Automated failover to secondary regions
- **Communication Plan**: Stakeholder notification and status updates

## Security Governance

### Security Team Structure
- **CISO**: Chief Information Security Officer oversight
- **Security Engineers**: Implementation and maintenance
- **DevSecOps**: Security integration in development lifecycle
- **Compliance Officer**: Regulatory compliance and auditing

### Risk Management
- **Risk Assessment**: Quarterly comprehensive risk assessments
- **Vulnerability Management**: Monthly vulnerability scanning and patching
- **Threat Modeling**: Application-level threat modeling and mitigation
- **Security Metrics**: KPIs for security posture measurement

## Third-Party Security Validation

### External Audits
- **Annual Security Audit**: Comprehensive third-party security assessment
- **Penetration Testing**: Quarterly external penetration testing
- **Compliance Audits**: Regular compliance verification audits
- **Code Reviews**: External security code review for critical components

### Security Certifications
- **ISO 27001 Certification**: Information Security Management
- **SOC 2 Type II Report**: Security and availability controls
- **PCI DSS Compliance**: Payment processing security standards
- **Australian Government ISM**: Information Security Manual compliance

## Contact Information

### Security Team
- **Security Email**: security@liquidtreasury.business
- **Emergency Contact**: +61 (emergency number)
- **Bug Bounty**: security-bounty@liquidtreasury.business
- **Compliance**: compliance@liquidtreasury.business

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Next Review**: March 2025  
**Classification**: Confidential