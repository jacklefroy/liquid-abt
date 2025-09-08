# LIQUID ABT - API Documentation

## Overview
LIQUID ABT provides a comprehensive RESTful API for Bitcoin treasury automation. The API follows REST principles with JSON request/response bodies and standard HTTP status codes.

## Base URL
- Production: `https://app.liquidtreasury.business/api`
- Staging: `https://staging.liquidtreasury.business/api`

## Authentication
All API requests require authentication via JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer your-jwt-token-here
```

### Getting a JWT Token
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@company.com",
  "password": "secure-password"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expires": "2025-01-07T10:00:00Z",
    "user": {
      "id": "user-uuid",
      "email": "user@company.com",
      "role": "admin",
      "tenantId": "tenant-uuid"
    }
  }
}
```

## Rate Limiting
API requests are rate limited to prevent abuse:
- **Authentication endpoints**: 5 requests per minute per IP
- **General API**: 100 requests per minute per user
- **Webhook endpoints**: 1000 requests per minute per tenant

Rate limit headers are included in all responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640682000
```

## Error Handling
All errors return a consistent JSON structure:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "field": "amount",
      "issue": "Must be greater than 0"
    }
  }
}
```

### Error Codes
- `VALIDATION_ERROR`: Invalid request parameters
- `AUTHENTICATION_ERROR`: Invalid or expired token
- `AUTHORIZATION_ERROR`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `INTERNAL_ERROR`: Server error
- `EXCHANGE_ERROR`: External exchange API error
- `INSUFFICIENT_FUNDS`: Not enough balance for operation

## Core Endpoints

### Health Check
```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-06T10:00:00Z",
  "services": {
    "database": { "status": "healthy", "latency": 45 },
    "redis": { "status": "healthy", "latency": 12 },
    "exchanges": {
      "kraken": { "status": "healthy", "latency": 150 }
    }
  }
}
```

### Treasury Dashboard

#### Get Treasury Overview
```http
GET /treasury/overview
```

Response:
```json
{
  "success": true,
  "data": {
    "totalBitcoin": 1.25894736,
    "totalFiatInvested": 125000.50,
    "currentValue": 140250.75,
    "totalGainLoss": 15250.25,
    "gainLossPercentage": 12.2,
    "averageBuyPrice": 99250.50,
    "currentBitcoinPrice": 111400.00,
    "totalPurchases": 47,
    "lastPurchaseDate": "2025-01-06T09:30:00Z"
  }
}
```

#### Get Purchase History
```http
GET /treasury/purchases?limit=50&offset=0&startDate=2024-12-01&endDate=2025-01-06
```

Response:
```json
{
  "success": true,
  "data": {
    "purchases": [
      {
        "id": "purchase-uuid",
        "amount": 2500.00,
        "bitcoinAmount": 0.02243589,
        "bitcoinPrice": 111400.00,
        "fee": 12.50,
        "status": "completed",
        "createdAt": "2025-01-06T09:30:00Z",
        "completedAt": "2025-01-06T09:31:15Z",
        "source": "stripe_webhook",
        "ruleId": "rule-uuid"
      }
    ],
    "total": 47,
    "hasMore": false
  }
}
```

### Treasury Rules Management

#### Get Treasury Rules
```http
GET /treasury/rules
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "rule-uuid",
      "name": "Daily Revenue Conversion",
      "type": "percentage",
      "enabled": true,
      "configuration": {
        "percentage": 25.0,
        "minimumAmount": 100.00,
        "maximumAmount": 5000.00
      },
      "triggers": {
        "paymentProcessors": ["stripe"],
        "minimumBalance": 1000.00
      },
      "createdAt": "2024-12-01T10:00:00Z",
      "updatedAt": "2025-01-02T15:30:00Z"
    }
  ]
}
```

#### Create Treasury Rule
```http
POST /treasury/rules
Content-Type: application/json

{
  "name": "Weekend DCA",
  "type": "scheduled",
  "enabled": true,
  "configuration": {
    "amount": 500.00,
    "frequency": "weekly",
    "dayOfWeek": 1,
    "timeOfDay": "09:00"
  }
}
```

#### Update Treasury Rule
```http
PUT /treasury/rules/{ruleId}
Content-Type: application/json

{
  "enabled": false,
  "configuration": {
    "percentage": 30.0
  }
}
```

#### Delete Treasury Rule
```http
DELETE /treasury/rules/{ruleId}
```

### Payment Processor Integrations

#### Get Connected Payment Processors
```http
GET /integrations/payment-processors
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "integration-uuid",
      "provider": "stripe",
      "accountId": "acct_1234567890",
      "status": "connected",
      "permissions": ["read_payments", "webhook_events"],
      "connectedAt": "2024-12-01T10:00:00Z",
      "lastSyncAt": "2025-01-06T09:30:00Z"
    }
  ]
}
```

#### Connect Payment Processor (Stripe)
```http
POST /integrations/payment-processors/stripe/connect
Content-Type: application/json

{
  "authorizationCode": "ac_1234567890abcdef",
  "state": "random-state-string"
}
```

#### Disconnect Payment Processor
```http
DELETE /integrations/payment-processors/{integrationId}
```

### Bitcoin Wallet Management

#### Get Wallet Configuration
```http
GET /wallet/config
```

Response:
```json
{
  "success": true,
  "data": {
    "walletType": "self_custody",
    "bitcoinAddress": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    "addressType": "bech32",
    "autoWithdraw": true,
    "minimumWithdrawThreshold": 0.001,
    "withdrawalFee": 0.0005,
    "lastWithdrawal": "2025-01-05T14:20:00Z"
  }
}
```

#### Update Wallet Configuration
```http
PUT /wallet/config
Content-Type: application/json

{
  "bitcoinAddress": "bc1qnew-address-here",
  "autoWithdraw": true,
  "minimumWithdrawThreshold": 0.002
}
```

### Compliance & Reporting

#### Get Tax Summary
```http
GET /compliance/tax-summary?taxYear=2024
```

Response:
```json
{
  "success": true,
  "data": {
    "taxYear": 2024,
    "totalPurchases": 156750.50,
    "totalSales": 0,
    "capitalGainsLosses": 0,
    "method": "FIFO",
    "records": [
      {
        "date": "2024-12-01",
        "type": "purchase",
        "amount": 2500.00,
        "bitcoinAmount": 0.025,
        "pricePerBitcoin": 100000.00
      }
    ],
    "generatedAt": "2025-01-06T10:00:00Z"
  }
}
```

#### Generate ATO Report
```http
POST /compliance/ato-report
Content-Type: application/json

{
  "reportType": "annual",
  "taxYear": 2024,
  "format": "pdf"
}
```

#### Get Audit Trail
```http
GET /compliance/audit-trail?startDate=2024-12-01&endDate=2025-01-06&limit=100
```

Response:
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "audit-uuid",
        "timestamp": "2025-01-06T09:30:00Z",
        "eventType": "bitcoin_purchase_completed",
        "userId": "user-uuid",
        "details": {
          "purchaseId": "purchase-uuid",
          "amount": 2500.00,
          "bitcoinAmount": 0.02243589
        },
        "ipAddress": "192.168.1.100",
        "userAgent": "Mozilla/5.0...",
        "hash": "sha256-hash-here"
      }
    ],
    "total": 1247,
    "hasMore": true
  }
}
```

### User & Team Management

#### Get Team Members
```http
GET /team/members
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "user-uuid",
      "email": "admin@company.com",
      "role": "owner",
      "permissions": ["all"],
      "status": "active",
      "lastLogin": "2025-01-06T08:30:00Z",
      "createdAt": "2024-12-01T10:00:00Z"
    }
  ]
}
```

#### Invite Team Member
```http
POST /team/invite
Content-Type: application/json

{
  "email": "newmember@company.com",
  "role": "user",
  "permissions": ["view_dashboard", "view_reports"]
}
```

### Notifications & Alerts

#### Get Notification Settings
```http
GET /notifications/settings
```

#### Update Notification Settings
```http
PUT /notifications/settings
Content-Type: application/json

{
  "email": {
    "enabled": true,
    "purchaseConfirmations": true,
    "weeklyReports": true,
    "systemAlerts": true
  },
  "slack": {
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/services/...",
    "channel": "#treasury-alerts"
  }
}
```

### Webhooks

#### Register Webhook
```http
POST /webhooks
Content-Type: application/json

{
  "url": "https://your-app.com/webhooks/liquid-abt",
  "events": ["purchase.completed", "purchase.failed", "rule.triggered"],
  "secret": "your-webhook-secret"
}
```

#### List Webhooks
```http
GET /webhooks
```

#### Test Webhook
```http
POST /webhooks/{webhookId}/test
```

### Webhook Events

#### Purchase Completed
```json
{
  "event": "purchase.completed",
  "timestamp": "2025-01-06T09:31:15Z",
  "data": {
    "id": "purchase-uuid",
    "amount": 2500.00,
    "bitcoinAmount": 0.02243589,
    "bitcoinPrice": 111400.00,
    "tenantId": "tenant-uuid"
  }
}
```

#### Purchase Failed
```json
{
  "event": "purchase.failed",
  "timestamp": "2025-01-06T09:30:00Z",
  "data": {
    "id": "purchase-uuid",
    "amount": 2500.00,
    "error": "Exchange API unavailable",
    "retryAt": "2025-01-06T09:35:00Z",
    "tenantId": "tenant-uuid"
  }
}
```

## SDK Examples

### Node.js SDK
```javascript
import { LiquidABT } from '@liquid-abt/sdk';

const client = new LiquidABT({
  apiKey: 'your-api-key',
  environment: 'production'
});

// Get treasury overview
const overview = await client.treasury.getOverview();
console.log(`Total Bitcoin: ${overview.totalBitcoin} BTC`);

// Create treasury rule
const rule = await client.treasury.createRule({
  name: 'Daily 10% Conversion',
  type: 'percentage',
  configuration: { percentage: 10.0 }
});
```

### Python SDK
```python
from liquid_abt import LiquidABT

client = LiquidABT(
    api_key='your-api-key',
    environment='production'
)

# Get purchase history
purchases = client.treasury.get_purchases(limit=50)
for purchase in purchases:
    print(f"Purchase: {purchase.amount} AUD = {purchase.bitcoin_amount} BTC")
```

## Testing

### Sandbox Environment
Use the sandbox environment for testing:
- Base URL: `https://sandbox.liquidtreasury.business/api`
- All Bitcoin purchases are simulated
- Use test payment processor credentials
- No real money is involved

### Test Cards (Stripe)
```
// Successful payment
4242424242424242

// Declined payment
4000000000000002

// Insufficient funds
4000000000009995
```

## Support

- **Documentation**: https://docs.liquidtreasury.business
- **API Status**: https://status.liquidtreasury.business
- **Support Email**: support@liquidtreasury.business
- **Slack Community**: https://slack.liquidtreasury.business