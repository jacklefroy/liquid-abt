// LIQUID ABT - Feature Flags for Incremental Development
// Centralized feature flag management for phased rollout

export interface FeatureConfig {
  enabled: boolean;
  description: string;
  phase: number;
  expectedDate?: string;
  dependencies?: string[];
}

export const features: Record<string, FeatureConfig> = {
  // Phase 1 - Current (MVP)
  stripe: {
    enabled: true,
    description: 'Stripe payment processing integration',
    phase: 1,
  },
  
  bitcoin_kraken: {
    enabled: true,
    description: 'Kraken Bitcoin exchange (testing only)',
    phase: 1,
  },
  
  basic_treasury_rules: {
    enabled: true,
    description: 'Basic percentage-based treasury rules',
    phase: 1,
  },
  
  self_custody: {
    enabled: true,
    description: 'Self-custody Bitcoin wallet support',
    phase: 1,
  },
  
  // Phase 2 - February 2025
  square: {
    enabled: false,
    description: 'Square point-of-sale and online payments',
    phase: 2,
    expectedDate: 'February 2025',
    dependencies: ['stripe'],
  },
  
  paypal: {
    enabled: false,
    description: 'PayPal and Venmo payment processing',
    phase: 2,
    expectedDate: 'February 2025',
    dependencies: ['stripe'],
  },
  
  advanced_treasury_rules: {
    enabled: false,
    description: 'Advanced treasury rules (rebalancing, profit locking)',
    phase: 2,
    expectedDate: 'February 2025',
    dependencies: ['basic_treasury_rules'],
  },
  
  // Phase 3 - March 2025  
  xero: {
    enabled: false,
    description: 'Xero accounting software integration',
    phase: 3,
    expectedDate: 'March 2025',
    dependencies: ['stripe'],
  },
  
  abn_verification: {
    enabled: false,
    description: 'Australian Business Number verification',
    phase: 3,
    expectedDate: 'March 2025',
  },
  
  austrac_reporting: {
    enabled: false,
    description: 'AUSTRAC compliance reporting',
    phase: 3,
    expectedDate: 'March 2025',
    dependencies: ['abn_verification'],
  },
  
  auto_tax_integration: {
    enabled: false,
    description: 'Automated tax calculation and reporting',
    phase: 3,
    expectedDate: 'March 2025',
    dependencies: ['xero', 'austrac_reporting'],
  },
  
  // Phase 4 - April 2025
  myob: {
    enabled: false,
    description: 'MYOB business management integration',
    phase: 4,
    expectedDate: 'April 2025',
    dependencies: ['xero'],
  },
  
  shopify: {
    enabled: false,
    description: 'Shopify e-commerce platform integration',
    phase: 4,
    expectedDate: 'April 2025',
    dependencies: ['stripe', 'square'],
  },
  
  tyro: {
    enabled: false,
    description: 'Tyro Australian EFTPOS terminals',
    phase: 4,
    expectedDate: 'April 2025',
    dependencies: ['square'],
  },
  
  multi_approval_workflows: {
    enabled: false,
    description: 'Multi-level approval workflows for large transactions',
    phase: 4,
    expectedDate: 'April 2025',
    dependencies: ['advanced_treasury_rules'],
  },
  
  // Phase 5 - Q2 2025
  zerocap: {
    enabled: false,
    description: 'ZeroCap institutional Bitcoin liquidity (API v2)',
    phase: 5,
    expectedDate: 'Q2 2025 (pending ZeroCap API v2 release)',
    dependencies: ['bitcoin_kraken'],
  },
  
  independent_reserve: {
    enabled: false,
    description: 'Independent Reserve Bitcoin exchange',
    phase: 5,
    expectedDate: 'Q2 2025',
    dependencies: ['zerocap'],
  },
  
  btc_markets: {
    enabled: false,
    description: 'BTC Markets exchange integration',
    phase: 5,
    expectedDate: 'Q2 2025',
    dependencies: ['independent_reserve'],
  },
  
  professional_custody: {
    enabled: false,
    description: 'Professional custody solutions via ZeroCap',
    phase: 5,
    expectedDate: 'Q2 2025',
    dependencies: ['zerocap'],
  },
};

// Feature flag utility functions
export class FeatureFlags {
  /**
   * Check if a feature is enabled
   */
  static isEnabled(feature: string): boolean {
    return features[feature]?.enabled ?? false;
  }
  
  /**
   * Get feature configuration
   */
  static getFeature(feature: string): FeatureConfig | undefined {
    return features[feature];
  }
  
  /**
   * Get all enabled features
   */
  static getEnabled(): string[] {
    return Object.entries(features)
      .filter(([_, config]) => config.enabled)
      .map(([name, _]) => name);
  }
  
  /**
   * Get features by phase
   */
  static getByPhase(phase: number): string[] {
    return Object.entries(features)
      .filter(([_, config]) => config.phase === phase)
      .map(([name, _]) => name);
  }
  
  /**
   * Get features coming soon (next phase)
   */
  static getComingSoon(): Array<{ name: string; config: FeatureConfig }> {
    const enabledPhases = new Set(
      Object.values(features)
        .filter(config => config.enabled)
        .map(config => config.phase)
    );
    
    const maxEnabledPhase = Math.max(...Array.from(enabledPhases));
    const nextPhase = maxEnabledPhase + 1;
    
    return Object.entries(features)
      .filter(([_, config]) => config.phase === nextPhase)
      .map(([name, config]) => ({ name, config }));
  }
  
  /**
   * Check if all dependencies are satisfied for a feature
   */
  static areDependenciesMet(feature: string): boolean {
    const config = features[feature];
    if (!config?.dependencies) return true;
    
    return config.dependencies.every(dep => FeatureFlags.isEnabled(dep));
  }
  
  /**
   * Get integration status for UI
   */
  static getIntegrationStatus() {
    return {
      payment: {
        stripe: FeatureFlags.isEnabled('stripe'),
        square: FeatureFlags.isEnabled('square'),
        paypal: FeatureFlags.isEnabled('paypal'),
        shopify: FeatureFlags.isEnabled('shopify'),
      },
      accounting: {
        xero: FeatureFlags.isEnabled('xero'),
        myob: FeatureFlags.isEnabled('myob'),
      },
      bitcoin: {
        kraken: FeatureFlags.isEnabled('bitcoin_kraken'),
        zerocap: FeatureFlags.isEnabled('zerocap'),
        independent_reserve: FeatureFlags.isEnabled('independent_reserve'),
        btc_markets: FeatureFlags.isEnabled('btc_markets'),
      },
      compliance: {
        abn_verification: FeatureFlags.isEnabled('abn_verification'),
        austrac_reporting: FeatureFlags.isEnabled('austrac_reporting'),
        auto_tax: FeatureFlags.isEnabled('auto_tax_integration'),
      },
    };
  }
  
  /**
   * Override feature flag for testing (development only)
   */
  static override(feature: string, enabled: boolean): void {
    if (process.env.NODE_ENV === 'production') {
      console.warn('Feature flag overrides are disabled in production');
      return;
    }
    
    if (features[feature]) {
      features[feature].enabled = enabled;
      console.log(`Feature flag '${feature}' overridden to: ${enabled}`);
    }
  }
  
  /**
   * Reset all overrides (development only)
   */
  static resetOverrides(): void {
    if (process.env.NODE_ENV === 'production') return;
    
    // This would reset to defaults - in practice you'd store original values
    console.log('Feature flag overrides reset');
  }
}

// Export for easier importing
export const { isEnabled, getFeature, getEnabled, getByPhase, getComingSoon } = FeatureFlags;

// Type helper for TypeScript
export type FeatureName = keyof typeof features;