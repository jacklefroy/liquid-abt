# LIQUID ABT - Admin Monitoring Dashboard

## 📊 Overview

The LIQUID ABT Monitoring Dashboard provides comprehensive real-time visibility into system health, performance, and business metrics for the Phase 1 MVP deployment. Built specifically for Bitcoin treasury automation monitoring.

**Dashboard URL**: `/admin/monitoring`

## 🎯 Key Features

### **Real-Time System Monitoring**
- **System Health**: CPU, memory, disk usage with color-coded alerts
- **API Performance**: Request rates, response times, error tracking
- **Database Metrics**: Connection pools, query performance, tenant schemas
- **Uptime Tracking**: System availability and service status

### **Stripe Integration Monitoring**
- **Webhook Processing**: Success rates, processing times, error tracking
- **Payment Volume**: Daily transactions, revenue, average amounts
- **Recent Transactions**: Real-time payment status and details
- **Geographic Analytics**: Payment distribution by country

### **Bitcoin Operations Tracking**
- **Purchase Analytics**: Daily Bitcoin purchases, success rates, volume
- **Price Monitoring**: Live BTC price with 24h change indicators
- **Exchange Status**: Kraken exchange health monitoring
- **Treasury Metrics**: Total Bitcoin accumulated, average purchase size

### **Beta User Analytics**
- **Onboarding Funnel**: Step-by-step completion rates and bottlenecks
- **User Activity**: Daily active users, engagement metrics
- **Completion Rates**: Full onboarding success tracking
- **Recent Signups**: Company details and onboarding status

### **Error Tracking & Alerting**
- **Error Rates**: System-wide error tracking with trending
- **Critical Alerts**: High-priority error identification
- **Top Errors**: Most frequent error messages and resolution
- **Error Trends**: Historical error patterns and analysis

### **Events & Audit Trail**
- **System Events**: Real-time event stream with severity levels
- **User Actions**: Audit trail for administrative actions
- **Integration Events**: Payment processor and exchange events
- **Security Events**: Authentication and access monitoring

## 🔧 Technical Architecture

### **Dashboard Components**

#### **Main Dashboard** (`/src/app/admin/monitoring/page.tsx`)
- Responsive React component with real-time updates
- Auto-refresh with configurable intervals (10s, 30s, 1m, 5m)
- Time range selection (5m, 1h, 24h, 7d)
- Professional dark theme with Bitcoin orange accents

#### **Metrics API** (`/src/app/api/monitoring/metrics/route.ts`)
- High-performance metrics collection endpoint
- Parallel data fetching for optimal response times
- PostgreSQL queries with optimized indexing
- Error handling with graceful degradation

#### **Real-Time Charts**
- Recharts integration for professional visualization
- Line charts for trends and time-series data
- Pie charts for distribution analytics
- Bar charts for comparative metrics

### **Data Sources**

#### **System Metrics**
- Node.js process monitoring (CPU, memory)
- Database connection pooling statistics
- API request/response analytics
- Error logging and aggregation

#### **Business Metrics**
- Stripe webhook processing rates
- Bitcoin purchase success tracking
- Beta user onboarding analytics
- Revenue and volume calculations

#### **Health Checks**
- Database query performance
- External service availability
- Rate limiting effectiveness
- Security event monitoring

## 📈 Key Performance Indicators (KPIs)

### **System Health KPIs**
- **Uptime Target**: 99.9%+ (Phase 1 requirement)
- **Response Time**: <200ms average API response
- **Error Rate**: <0.1% system-wide errors
- **Database Performance**: <100ms average query time

### **Business KPIs**
- **Beta User Target**: 5 Australian SMEs successfully onboarded
- **Onboarding Success**: 100% completion rate goal
- **Transaction Success**: 99%+ Stripe webhook processing
- **Bitcoin Purchase Success**: 95%+ exchange order completion

### **Alert Thresholds**
- **Critical**: CPU >90%, Memory >90%, Error rate >5%
- **Warning**: CPU >75%, Memory >75%, Error rate >1%
- **Performance**: API response >1000ms, DB queries >500ms

## 🚨 Monitoring Alerts

### **Status Indicators**
- 🟢 **Healthy**: All systems operational
- 🟡 **Warning**: Performance degraded but functional
- 🔴 **Critical**: Service interruption or failure

### **Alert Categories**

#### **System Alerts**
- High resource usage (CPU/Memory/Disk)
- Database connection exhaustion
- Slow query performance
- API response time degradation

#### **Business Alerts**
- Stripe webhook failures
- Bitcoin exchange connectivity issues
- Beta user onboarding failures
- Payment processing errors

#### **Security Alerts**
- Unusual error patterns
- Authentication failures
- Rate limiting triggers
- Data access violations

## 🔍 Monitoring Use Cases

### **Daily Operations**
1. **Morning Health Check**: Review overnight metrics and alerts
2. **Beta User Progress**: Track onboarding completions and blockers
3. **Transaction Monitoring**: Verify Stripe webhook processing
4. **Bitcoin Operations**: Confirm exchange connectivity and purchases

### **Weekly Reviews**
1. **Performance Trends**: Identify gradual performance degradation
2. **Error Pattern Analysis**: Review recurring issues and solutions
3. **Beta User Feedback**: Correlate metrics with user feedback
4. **Capacity Planning**: Database growth and resource utilization

### **Incident Response**
1. **Real-Time Alerting**: Immediate notification of critical issues
2. **Root Cause Analysis**: Drill down into error details and context
3. **Impact Assessment**: Understand business impact of technical issues
4. **Recovery Monitoring**: Verify system recovery after incidents

## 🎛️ Dashboard Controls

### **Time Range Selection**
- **5 Minutes**: Real-time troubleshooting and immediate response
- **1 Hour**: Current operational status and recent trends
- **24 Hours**: Daily performance review and overnight analysis
- **7 Days**: Weekly trend analysis and capacity planning

### **Refresh Controls**
- **Auto-Refresh**: 10s, 30s, 1m, 5m intervals
- **Manual Refresh**: Immediate data update
- **Last Updated**: Timestamp of most recent data fetch

### **Metric Filters**
- **System Focus**: Infrastructure and performance metrics
- **Business Focus**: Revenue, users, and transaction metrics
- **Error Focus**: Error tracking and incident analysis

## 📊 Charts & Visualizations

### **Line Charts**
- **Error Trends**: Historical error patterns over time
- **API Performance**: Response time trends and throughput
- **User Activity**: Beta user engagement over time

### **Pie Charts**
- **Error Distribution**: Error types and frequency
- **Transaction Status**: Success vs failure rates
- **Geographic Distribution**: Payment origin analysis

### **Bar Charts**
- **Top API Endpoints**: Most used endpoints and performance
- **Error Frequency**: Most common error messages
- **Beta User Progress**: Onboarding step completion

### **Metrics Cards**
- **Critical KPIs**: Large format key performance indicators
- **Status Indicators**: Color-coded health and performance status
- **Trend Arrows**: Visual trend indicators (up/down/stable)

## 🔗 Integration Points

### **External Dependencies**
- **Stripe API**: Webhook and payment data collection
- **Kraken Exchange**: Bitcoin purchase and price monitoring
- **PostgreSQL**: All metrics and analytical data storage
- **System Resources**: OS-level performance monitoring

### **Internal Services**
- **Authentication System**: User activity and security monitoring
- **Payment Processing**: Transaction success and failure tracking
- **Bitcoin Treasury**: Purchase automation and wallet monitoring
- **Error Logging**: Centralized error collection and analysis

## 🛡️ Security & Access Control

### **Admin Access Only**
- Dashboard restricted to system administrators
- JWT token validation for all monitoring endpoints
- Role-based access control integration
- Audit logging for dashboard access

### **Data Protection**
- No sensitive financial data displayed in plain text
- PII masking for user information
- Secure API endpoints with rate limiting
- HTTPS-only access for all monitoring endpoints

## 🔮 Future Enhancements

### **Phase 2 Additions**
- **Multi-Exchange Monitoring**: Square, PayPal integration metrics
- **Advanced Treasury Rules**: Complex rule performance tracking
- **User Segmentation**: Advanced user behavior analytics
- **Performance Optimization**: Query optimization and caching

### **Phase 3 Additions**
- **Compliance Monitoring**: AUSTRAC and ATO reporting metrics
- **Accounting Integration**: Xero and MYOB sync monitoring
- **Tax Calculation**: CGT calculation performance tracking
- **Audit Trail**: Complete regulatory compliance monitoring

### **Enterprise Features**
- **Custom Dashboards**: Tenant-specific monitoring views
- **Advanced Alerting**: Email/SMS/Slack notification integration
- **API Monitoring**: Third-party API health and performance
- **Machine Learning**: Predictive alerting and anomaly detection

## 📞 Support & Maintenance

### **Monitoring the Monitoring**
- Dashboard performance tracking
- API endpoint health checks
- Database query optimization
- Chart rendering performance

### **Data Retention**
- **Real-time Data**: 7 days detailed metrics
- **Hourly Aggregates**: 30 days historical data
- **Daily Summaries**: 1 year trend analysis
- **Archive Storage**: Long-term compliance records

---

## 🚀 Getting Started

### **Access the Dashboard**
1. Navigate to `/admin/monitoring` in your browser
2. Authenticate with admin credentials
3. Select appropriate time range for analysis
4. Configure auto-refresh based on monitoring needs

### **Key Metrics to Monitor**
1. **System Status Bar**: Overall health indicator
2. **Critical Metrics**: Active users, transactions, errors
3. **Stripe Integration**: Webhook success and payment volume
4. **Bitcoin Operations**: Purchase success and exchange status
5. **Beta Users**: Onboarding progress and completion rates

### **Troubleshooting Guide**
- **Slow Dashboard**: Check database connection and query performance
- **Missing Data**: Verify API endpoints and data collection services
- **Chart Errors**: Check Recharts compatibility and data formatting
- **Authentication Issues**: Verify JWT token and session management

The LIQUID ABT Monitoring Dashboard provides complete visibility into Phase 1 MVP operations, ensuring successful beta deployment and seamless transition to full production scale.

---

*Last Updated: January 2025*  
*Version: Phase 1 MVP*