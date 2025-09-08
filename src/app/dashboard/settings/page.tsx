'use client';

import { useState, useEffect } from 'react';
import { TreasuryRule, RuleType } from '@/types/database';

interface StripeStatus {
  connected: boolean;
  accountId?: string;
  connectedAt?: string;
  capabilities?: string[];
  requiresAction?: boolean;
}

interface TreasuryRuleForm {
  name: string;
  ruleType: RuleType;
  conversionPercentage?: number;
  thresholdAmount?: number;
  fixedAmount?: number;
  minTransactionAmount?: number;
  maxTransactionAmount?: number;
  isActive: boolean;
}

export default function SettingsPage() {
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [treasuryRule, setTreasuryRule] = useState<TreasuryRuleForm>({
    name: '',
    ruleType: RuleType.PERCENTAGE,
    conversionPercentage: 10,
    isActive: false
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    // Check for OAuth success parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const stripeConnected = urlParams.get('stripe_connected');
    const accountId = urlParams.get('account_id');
    const message = urlParams.get('message');
    
    if (stripeConnected === 'true') {
      console.log('OAuth success detected:', { stripeConnected, accountId, message });
      setSuccess(message || 'Stripe account connected successfully!');
      
      // Temporarily store success state for status endpoint
      localStorage.setItem('stripe_oauth_success', 'true');
      localStorage.setItem('stripe_oauth_account_id', accountId || '');
      
      // Clean up URL parameters
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
    
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No authentication token');

      // Load Stripe status
      const stripeHeaders: Record<string, string> = { 'Authorization': `Bearer ${token}` };
      
      // Include OAuth success indicator if available
      const oauthSuccess = localStorage.getItem('stripe_oauth_success');
      if (oauthSuccess === 'true') {
        stripeHeaders['x-stripe-oauth-success'] = 'true';
      }
      
      const stripeResponse = await fetch('/api/integrations/stripe/status', {
        headers: stripeHeaders
      });

      if (stripeResponse.ok) {
        const stripeData = await stripeResponse.json();
        setStripeStatus(stripeData);
        
        // If we got a connected status and OAuth flag was set, clear the temporary flag
        if (stripeData.connected && oauthSuccess === 'true') {
          localStorage.removeItem('stripe_oauth_success');
          localStorage.removeItem('stripe_oauth_account_id');
          console.log('OAuth success flag cleared - connection confirmed');
        }
      }

      // Load treasury rules
      const rulesResponse = await fetch('/api/treasury/rules', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (rulesResponse.ok) {
        const rulesData = await rulesResponse.json();
        if (rulesData.length > 0) {
          const rule = rulesData[0];
          setTreasuryRule({
            name: rule.name || '',
            ruleType: rule.ruleType || RuleType.PERCENTAGE,
            conversionPercentage: rule.conversionPercentage || 10,
            thresholdAmount: rule.thresholdAmount || 1000,
            fixedAmount: rule.fixedAmount || 100,
            minTransactionAmount: rule.minTransactionAmount || 10,
            maxTransactionAmount: rule.maxTransactionAmount || 10000,
            isActive: rule.isActive || false
          });
        }
      }

    } catch (err) {
      console.error('Failed to load settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectStripe = async () => {
    console.log('Starting Stripe connection...');
    try {
      const token = localStorage.getItem('token');
      console.log('Token found:', !!token);
      console.log('Token value:', token);
      
      if (!token) {
        alert('Please log in again');
        return;
      }
      
      console.log('Calling /api/integrations/stripe/connect...');
      const response = await fetch('/api/integrations/stripe/connect', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response data:', data);
      
      if (data.redirectUrl) {
        console.log('Redirecting to:', data.redirectUrl);
        window.location.href = data.redirectUrl;
      } else if (data.authUrl) {
        console.log('Redirecting to:', data.authUrl);
        window.location.href = data.authUrl;
      } else {
        console.error('No redirect URL received:', data);
        alert('Failed to get Stripe connection URL');
      }
    } catch (error) {
      console.error('Connect error:', error);
      alert('Connection failed: ' + error.message);
    }
  };

  const saveTreasuryRule = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const token = localStorage.getItem('token');
      if (!token) throw new Error('No authentication token');

      const response = await fetch('/api/treasury/rules', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(treasuryRule)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      setSuccess('Treasury rule saved successfully!');
      await loadSettings(); // Reload to get updated data
    } catch (err) {
      console.error('Failed to save treasury rule:', err);
      setError(err instanceof Error ? err.message : 'Failed to save treasury rule');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
          <p className="mt-4">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="mt-2 text-gray-300">Configure your Bitcoin treasury automation</p>
      </div>

      {error && (
        <div className="bg-red-900 border border-red-700 text-red-100 px-6 py-4 rounded-lg">
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-900 border border-green-700 text-green-100 px-6 py-4 rounded-lg">
          <p>{success}</p>
        </div>
      )}

      {/* Stripe Integration */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Payment Integration</h2>
        
        <div className="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
          <div>
            <h3 className="font-medium text-white">Stripe Connect</h3>
            <p className="text-sm text-gray-400">
              Connect your Stripe account to process payments automatically
            </p>
            {stripeStatus?.connected && stripeStatus.accountId && (
              <p className="text-xs text-green-400 mt-1">
                Connected: {stripeStatus.accountId}
              </p>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <span className={`px-3 py-1 rounded text-sm ${
              stripeStatus?.connected 
                ? 'bg-green-900 text-green-200' 
                : 'bg-red-900 text-red-200'
            }`}>
              {stripeStatus?.connected ? 'Connected' : 'Not Connected'}
            </span>
            {console.log('Debug - stripeStatus:', stripeStatus)}
            {console.log('Debug - stripeStatus?.connected:', stripeStatus?.connected)}
            {console.log('Debug - !stripeStatus?.connected:', !stripeStatus?.connected)}
            {!stripeStatus?.connected ? (
              <button
                onClick={() => {
                  console.log('Connect Stripe clicked!');
                  handleConnectStripe();
                }}
                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md transition-colors"
              >
                Connect Stripe
              </button>
            ) : (
              <span className="text-green-500">Connected</span>
            )}
          </div>
        </div>

        {stripeStatus?.requiresAction && (
          <div className="mt-4 p-4 bg-yellow-900 border border-yellow-700 rounded-lg">
            <p className="text-yellow-200 text-sm">
              Action required: Your Stripe account needs additional verification to process payments.
            </p>
          </div>
        )}
      </div>

      {/* Treasury Rules */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Treasury Rules</h2>
        
        <div className="space-y-4">
          {/* Rule Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Rule Name
            </label>
            <input
              type="text"
              value={treasuryRule.name}
              onChange={(e) => setTreasuryRule({...treasuryRule, name: e.target.value})}
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="e.g., Main Conversion Rule"
            />
          </div>

          {/* Rule Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Conversion Type
            </label>
            <select
              value={treasuryRule.ruleType}
              onChange={(e) => setTreasuryRule({...treasuryRule, ruleType: e.target.value as RuleType})}
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value={RuleType.PERCENTAGE}>Percentage of each payment</option>
              <option value={RuleType.THRESHOLD}>When balance reaches threshold</option>
              <option value={RuleType.FIXED_AMOUNT}>Fixed amount on schedule</option>
              <option value={RuleType.DCA}>Dollar cost averaging</option>
            </select>
          </div>

          {/* Percentage Settings */}
          {treasuryRule.ruleType === RuleType.PERCENTAGE && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Conversion Percentage (%)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="range"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={treasuryRule.conversionPercentage || 10}
                  onChange={(e) => setTreasuryRule({...treasuryRule, conversionPercentage: parseFloat(e.target.value)})}
                  className="flex-1"
                />
                <span className="text-orange-400 font-mono w-16 text-right">
                  {treasuryRule.conversionPercentage?.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Convert {treasuryRule.conversionPercentage?.toFixed(1)}% of each payment to Bitcoin
              </p>
            </div>
          )}

          {/* Threshold Settings */}
          {treasuryRule.ruleType === RuleType.THRESHOLD && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Threshold Amount (AUD)
              </label>
              <input
                type="number"
                value={treasuryRule.thresholdAmount || 1000}
                onChange={(e) => setTreasuryRule({...treasuryRule, thresholdAmount: parseFloat(e.target.value)})}
                className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                min="10"
                step="10"
              />
              <p className="text-xs text-gray-400 mt-1">
                Convert accumulated balance to Bitcoin when it reaches this amount
              </p>
            </div>
          )}

          {/* Fixed Amount Settings */}
          {treasuryRule.ruleType === RuleType.FIXED_AMOUNT && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Fixed Amount (AUD)
              </label>
              <input
                type="number"
                value={treasuryRule.fixedAmount || 100}
                onChange={(e) => setTreasuryRule({...treasuryRule, fixedAmount: parseFloat(e.target.value)})}
                className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                min="10"
                step="10"
              />
              <p className="text-xs text-gray-400 mt-1">
                Convert this fixed amount to Bitcoin on schedule
              </p>
            </div>
          )}

          {/* Transaction Limits */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Minimum Transaction (AUD)
              </label>
              <input
                type="number"
                value={treasuryRule.minTransactionAmount || 10}
                onChange={(e) => setTreasuryRule({...treasuryRule, minTransactionAmount: parseFloat(e.target.value)})}
                className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Maximum Transaction (AUD)
              </label>
              <input
                type="number"
                value={treasuryRule.maxTransactionAmount || 10000}
                onChange={(e) => setTreasuryRule({...treasuryRule, maxTransactionAmount: parseFloat(e.target.value)})}
                className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                min="1"
              />
            </div>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="ruleActive"
              checked={treasuryRule.isActive}
              onChange={(e) => setTreasuryRule({...treasuryRule, isActive: e.target.checked})}
              className="w-4 h-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 focus:ring-2"
            />
            <label htmlFor="ruleActive" className="text-sm font-medium text-gray-300">
              Enable this treasury rule
            </label>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t border-gray-700">
            <button
              onClick={saveTreasuryRule}
              disabled={saving || !stripeStatus?.connected}
              className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-2 rounded-md transition-colors"
            >
              {saving ? 'Saving...' : 'Save Treasury Rule'}
            </button>
            {!stripeStatus?.connected && (
              <p className="text-sm text-gray-400 mt-2">
                Connect Stripe first to enable treasury rules
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
        <h3 className="font-medium text-blue-200 mb-2">Important Safety Information</h3>
        <ul className="text-sm text-blue-300 space-y-1">
          <li>• Treasury rules will automatically convert your AUD to Bitcoin</li>
          <li>• All Bitcoin purchases are sent to your configured wallet address</li>
          <li>• You maintain full control of your Bitcoin private keys</li>
          <li>• Rules can be paused or modified at any time</li>
          <li>• Test with small amounts first to verify everything works correctly</li>
        </ul>
      </div>
    </div>
  );
}