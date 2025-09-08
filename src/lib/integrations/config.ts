// LIQUID ABT - Integration Configuration
// Central configuration for all integrations with phase planning

import { IntegrationConfig } from './types';

export const IntegrationConfig: Record<string, Record<string, IntegrationConfig>> = {
  payment: {
    stripe: {
      enabled: true,
      name: 'Stripe',
      icon: '💳',
      description: 'Accept online payments worldwide',
      requiredEnvVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      category: 'payment',
    },
    square: {
      enabled: false, // Phase 2
      name: 'Square',
      icon: '◼️',
      description: 'Point of sale and online payments',
      requiredEnvVars: ['SQUARE_ACCESS_TOKEN', 'SQUARE_APPLICATION_ID', 'SQUARE_WEBHOOK_SECRET'],
      comingSoon: 'Phase 2 - February 2025',
      dependencies: ['stripe'],
      category: 'payment',
    },
    paypal: {
      enabled: false, // Phase 2
      name: 'PayPal',
      icon: '💰',
      description: 'PayPal and Venmo payments',
      requiredEnvVars: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'],
      comingSoon: 'Phase 2 - February 2025',
      dependencies: ['stripe'],
      category: 'payment',
    },
    shopify: {
      enabled: false, // Phase 4
      name: 'Shopify',
      icon: '🛍️',
      description: 'E-commerce platform integration',
      requiredEnvVars: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_WEBHOOK_SECRET'],
      comingSoon: 'Phase 4 - April 2025',
      dependencies: ['stripe', 'square'],
      category: 'payment',
    },
  },
  
  accounting: {
    xero: {
      enabled: false, // Phase 3
      name: 'Xero',
      icon: '📊',
      description: 'Australian accounting software integration',
      requiredEnvVars: ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET', 'XERO_WEBHOOK_KEY'],
      comingSoon: 'Phase 3 - March 2025',
      dependencies: ['stripe'],
      category: 'accounting',
    },
    myob: {
      enabled: false, // Phase 4
      name: 'MYOB',
      icon: '📈',
      description: 'Australian business management software',
      requiredEnvVars: ['MYOB_CLIENT_ID', 'MYOB_CLIENT_SECRET', 'MYOB_API_KEY'],
      comingSoon: 'Phase 4 - April 2025',
      dependencies: ['xero'],
      category: 'accounting',
    },
    quickbooks: {
      enabled: false, // Phase 4
      name: 'QuickBooks',
      icon: '📚',
      description: 'International accounting software',
      requiredEnvVars: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'],
      comingSoon: 'Phase 4 - April 2025',
      dependencies: ['xero'],
      category: 'accounting',
    },
  },
  
  bitcoin: {
    kraken: {
      enabled: true,
      name: 'Kraken',
      icon: '🐙',
      description: 'Bitcoin exchange (testing and development)',
      requiredEnvVars: ['KRAKEN_API_KEY', 'KRAKEN_PRIVATE_KEY'],
      category: 'bitcoin',
    },
    zerocap: {
      enabled: false, // Phase 5 - Waiting for API v2
      name: 'ZeroCap',
      icon: '🏦',
      description: 'Institutional Bitcoin liquidity provider',
      requiredEnvVars: ['ZEROCAP_API_KEY', 'ZEROCAP_API_SECRET', 'ZEROCAP_WEBHOOK_SECRET'],
      comingSoon: 'Q2 2025 - Pending ZeroCap API v2 release',
      dependencies: ['bitcoin_kraken'],
      category: 'bitcoin',
    },
    independent_reserve: {
      enabled: false, // Phase 5
      name: 'Independent Reserve',
      icon: '🇦🇺',
      description: 'Australian Bitcoin exchange',
      requiredEnvVars: ['IR_API_KEY', 'IR_API_SECRET'],
      comingSoon: 'Q2 2025',
      dependencies: ['zerocap'],
      category: 'bitcoin',
    },
    btc_markets: {
      enabled: false, // Phase 5
      name: 'BTC Markets',
      icon: '📈',
      description: 'Australian cryptocurrency exchange',
      requiredEnvVars: ['BTC_MARKETS_API_KEY', 'BTC_MARKETS_API_SECRET'],
      comingSoon: 'Q2 2025',
      dependencies: ['independent_reserve'],
      category: 'bitcoin',
    },
  },
  
  compliance: {
    abn_lookup: {
      enabled: false, // Phase 3
      name: 'ABN Lookup',
      icon: '🇦🇺',
      description: 'Australian Business Number verification',
      requiredEnvVars: ['ABN_LOOKUP_API_KEY'],
      comingSoon: 'Phase 3 - March 2025',
      category: 'compliance',
    },
    austrac: {
      enabled: false, // Phase 3
      name: 'AUSTRAC',
      icon: '🏛️',
      description: 'Australian Transaction Reports and Analysis Centre',
      requiredEnvVars: ['AUSTRAC_ENTITY_ID', 'AUSTRAC_REPORTING_ENTITY_NUMBER'],
      comingSoon: 'Phase 3 - March 2025',
      dependencies: ['abn_lookup'],
      category: 'compliance',
    },
    ato: {
      enabled: false, // Phase 3
      name: 'ATO Integration',
      icon: '🏛️',
      description: 'Australian Taxation Office reporting',
      requiredEnvVars: ['ATO_API_KEY', 'ATO_CLIENT_ID'],
      comingSoon: 'Phase 3 - March 2025',
      dependencies: ['abn_lookup'],
      category: 'compliance',
    },
  },
  
  notifications: {
    slack: {
      enabled: true,
      name: 'Slack',
      icon: '💬',
      description: 'Slack notifications for important events',
      requiredEnvVars: ['SLACK_BOT_TOKEN', 'SLACK_WEBHOOK_URL'],
      category: 'payment', // categorized as payment for now
    },
    sendgrid: {
      enabled: false, // Phase 2
      name: 'SendGrid',
      icon: '📧',
      description: 'Email notifications and marketing',
      requiredEnvVars: ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'],
      comingSoon: 'Phase 2 - February 2025',
      category: 'payment',
    },
    twilio: {
      enabled: false, // Phase 2
      name: 'Twilio',
      icon: '📱',
      description: 'SMS notifications and 2FA for Australian numbers',
      requiredEnvVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
      comingSoon: 'Phase 2 - February 2025',
      category: 'payment',
    },
  },
};

// Helper functions
export const getIntegrationsByCategory = (category: string) => {
  const result: Record<string, IntegrationConfig> = {};
  
  Object.entries(IntegrationConfig).forEach(([categoryName, integrations]) => {
    Object.entries(integrations).forEach(([name, config]) => {
      if (config.category === category) {
        result[name] = config;
      }
    });
  });
  
  return result;
};

export const getEnabledIntegrations = () => {
  const result: Record<string, IntegrationConfig> = {};
  
  Object.entries(IntegrationConfig).forEach(([categoryName, integrations]) => {
    Object.entries(integrations).forEach(([name, config]) => {
      if (config.enabled) {
        result[name] = config;
      }
    });
  });
  
  return result;
};

export const getComingSoonIntegrations = () => {
  const result: Record<string, IntegrationConfig & { category: string }> = {};
  
  Object.entries(IntegrationConfig).forEach(([categoryName, integrations]) => {
    Object.entries(integrations).forEach(([name, config]) => {
      if (!config.enabled && config.comingSoon) {
        result[name] = { ...config, category: config.category };
      }
    });
  });
  
  return result;
};

export const checkEnvVars = (vars: string[]): { configured: boolean; missing: string[] } => {
  const missing = vars.filter(v => !process.env[v]);
  return {
    configured: missing.length === 0,
    missing,
  };
};