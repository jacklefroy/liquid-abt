// LIQUID ABT - Integration Status API
// API endpoint to check integration configuration and health status

import { NextRequest, NextResponse } from 'next/server';
import { IntegrationConfig, checkEnvVars } from '@/lib/integrations/config';
import { paymentProcessorFactory } from '@/lib/integrations/payment';
import { FeatureFlags } from '@/lib/features';

export async function GET(request: NextRequest) {
  try {
    // Check if user has admin privileges (in real implementation)
    // const userInfo = await validateJWT(token);
    // if (!userInfo || (userInfo.role !== 'ADMIN' && userInfo.role !== 'OWNER')) {
    //   return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // }
    
    const status = {
      payment: await getPaymentIntegrationsStatus(),
      accounting: getAccountingIntegrationsStatus(),
      bitcoin: getBitcoinIntegrationsStatus(),
      compliance: getComplianceIntegrationsStatus(),
      notifications: getNotificationIntegrationsStatus(),
      summary: getSummary(),
    };
    
    return NextResponse.json(status);
    
  } catch (error) {
    console.error('Integration status API error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function getPaymentIntegrationsStatus() {
  const paymentIntegrations = IntegrationConfig.payment;
  const results: any[] = [];
  
  for (const [key, config] of Object.entries(paymentIntegrations)) {
    const envCheck = checkEnvVars(config.requiredEnvVars);
    let healthy = false;
    let connected = false;
    
    if (config.enabled && envCheck.configured) {
      try {
        const processor = paymentProcessorFactory.get(key);
        if (processor) {
          healthy = await processor.healthCheck();
          connected = healthy; // For now, healthy = connected
        }
      } catch (error) {
        console.warn(`Health check failed for ${key}:`, error);
      }
    }
    
    results.push({
      id: key,
      ...config,
      configured: envCheck.configured,
      connected,
      healthy,
      missing: envCheck.missing,
      featureEnabled: FeatureFlags.isEnabled(key),
      lastHealthCheck: new Date(),
    });
  }
  
  return results;
}

function getAccountingIntegrationsStatus() {
  return Object.entries(IntegrationConfig.accounting).map(([key, config]) => {
    const envCheck = checkEnvVars(config.requiredEnvVars);
    
    return {
      id: key,
      ...config,
      configured: envCheck.configured,
      connected: false, // Will be implemented in Phase 3
      healthy: false,
      missing: envCheck.missing,
      featureEnabled: FeatureFlags.isEnabled(key),
      lastHealthCheck: null,
    };
  });
}

function getBitcoinIntegrationsStatus() {
  return Object.entries(IntegrationConfig.bitcoin).map(([key, config]) => {
    const envCheck = checkEnvVars(config.requiredEnvVars);
    
    // Special handling for Kraken (currently enabled)
    let healthy = false;
    if (key === 'kraken' && config.enabled && envCheck.configured) {
      // In a real implementation, we would check Kraken health here
      healthy = true; // Assume healthy for now
    }
    
    return {
      id: key,
      ...config,
      configured: envCheck.configured,
      connected: config.enabled && envCheck.configured,
      healthy,
      missing: envCheck.missing,
      featureEnabled: FeatureFlags.isEnabled(key === 'kraken' ? 'bitcoin_kraken' : key),
      lastHealthCheck: config.enabled ? new Date() : null,
    };
  });
}

function getComplianceIntegrationsStatus() {
  return Object.entries(IntegrationConfig.compliance).map(([key, config]) => {
    const envCheck = checkEnvVars(config.requiredEnvVars);
    
    return {
      id: key,
      ...config,
      configured: envCheck.configured,
      connected: false, // Will be implemented in Phase 3
      healthy: false,
      missing: envCheck.missing,
      featureEnabled: FeatureFlags.isEnabled(key),
      lastHealthCheck: null,
    };
  });
}

function getNotificationIntegrationsStatus() {
  return Object.entries(IntegrationConfig.notifications).map(([key, config]) => {
    const envCheck = checkEnvVars(config.requiredEnvVars);
    
    // Special handling for Slack (currently available)
    let healthy = false;
    let connected = false;
    if (key === 'slack' && config.enabled && envCheck.configured) {
      healthy = true; // Assume healthy for now
      connected = true;
    }
    
    return {
      id: key,
      ...config,
      configured: envCheck.configured,
      connected,
      healthy,
      missing: envCheck.missing,
      featureEnabled: true, // Notifications don't use feature flags currently
      lastHealthCheck: config.enabled ? new Date() : null,
    };
  });
}

function getSummary() {
  const enabledIntegrations = Object.entries(IntegrationConfig)
    .flatMap(([category, integrations]) => 
      Object.entries(integrations).filter(([_, config]) => config.enabled)
    ).length;
    
  const totalIntegrations = Object.entries(IntegrationConfig)
    .flatMap(([category, integrations]) => Object.entries(integrations))
    .length;
    
  const comingSoonIntegrations = Object.entries(IntegrationConfig)
    .flatMap(([category, integrations]) => 
      Object.entries(integrations).filter(([_, config]) => !config.enabled && config.comingSoon)
    ).length;
  
  return {
    totalIntegrations,
    enabledIntegrations,
    comingSoonIntegrations,
    currentPhase: 1,
    nextPhaseDate: 'February 2025',
    platformStatus: 'Phase 1 MVP - Stripe Integration Active',
  };
}