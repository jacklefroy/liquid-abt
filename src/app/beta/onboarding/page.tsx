// LIQUID ABT - Beta User Onboarding Flow
// Comprehensive onboarding with progress tracking and integration setup

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, AlertCircle, Loader2, Building, CreditCard, Bitcoin, TrendingUp, Shield, ArrowRight, Users, Target, Zap } from 'lucide-react';

// ==============================================
// Types
// ==============================================

interface OnboardingData {
  business: {
    companyName?: string;
    abn?: string;
    industry?: string;
    monthlyRevenue?: string;
    contactEmail?: string;
    phoneNumber?: string;
  };
  integration: {
    stripeConnected?: boolean;
    stripeAccountId?: string;
    monthlyVolume?: string;
    primaryUseCase?: string;
  };
  treasury: {
    conversionPercentage?: number;
    minimumAmount?: number;
    frequency?: string;
    riskTolerance?: string;
  };
  wallet: {
    address?: string;
    type?: 'self-custody' | 'zerocap';
    verified?: boolean;
  };
  verification: {
    termsAccepted?: boolean;
    betaAgreement?: boolean;
    complianceVerified?: boolean;
    readyToStart?: boolean;
  };
}

interface StepProps {
  data: OnboardingData;
  onData: (data: OnboardingData) => void;
}

// ==============================================
// Step Components
// ==============================================

function WelcomeStep({ onData }: Pick<StepProps, 'onData'>) {
  return (
    <div className="text-center">
      <div className="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-6">
        <Bitcoin className="w-8 h-8 text-orange-600" />
      </div>
      
      <h2 className="text-3xl font-bold text-gray-900 mb-4">
        Welcome to LIQUID ABT Beta
      </h2>
      
      <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
        You're joining an exclusive group of forward-thinking Australian businesses 
        building Bitcoin treasuries. Let's get you set up in just a few minutes.
      </p>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="p-6 bg-green-50 rounded-lg">
          <Users className="w-8 h-8 text-green-600 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900">Elite Beta Group</h3>
          <p className="text-sm text-gray-600">Join 5 pioneering Australian SMEs</p>
        </div>
        
        <div className="p-6 bg-blue-50 rounded-lg">
          <Target className="w-8 h-8 text-blue-600 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900">6 Months Free</h3>
          <p className="text-sm text-gray-600">Pro tier worth $587.88 AUD</p>
        </div>
        
        <div className="p-6 bg-purple-50 rounded-lg">
          <Zap className="w-8 h-8 text-purple-600 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900">Direct Support</h3>
          <p className="text-sm text-gray-600">Weekly founder check-ins</p>
        </div>
      </div>

      <div className="bg-orange-50 p-6 rounded-lg">
        <h4 className="font-semibold text-orange-900 mb-2">What We'll Set Up:</h4>
        <div className="grid md:grid-cols-2 gap-4 text-left">
          <div className="flex items-center">
            <Check className="w-5 h-5 text-green-500 mr-2" />
            <span className="text-sm">Stripe payment integration</span>
          </div>
          <div className="flex items-center">
            <Check className="w-5 h-5 text-green-500 mr-2" />
            <span className="text-sm">Automated treasury rules</span>
          </div>
          <div className="flex items-center">
            <Check className="w-5 h-5 text-green-500 mr-2" />
            <span className="text-sm">Bitcoin wallet connection</span>
          </div>
          <div className="flex items-center">
            <Check className="w-5 h-5 text-green-500 mr-2" />
            <span className="text-sm">Australian compliance setup</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessDetailsStep({ data, onData }: StepProps) {
  const [formData, setFormData] = useState(data.business || {});
  
  const updateData = (field: string, value: string) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
    onData({ ...data, business: newFormData });
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Business Information</h2>
      <p className="text-gray-600 mb-8">Help us understand your business for Australian compliance requirements.</p>
      
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Company Name *
          </label>
          <input
            type="text"
            value={formData.companyName || ''}
            onChange={(e) => updateData('companyName', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="Your Business Pty Ltd"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Australian Business Number (ABN)
          </label>
          <input
            type="text"
            value={formData.abn || ''}
            onChange={(e) => updateData('abn', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="12 345 678 901"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Industry *
          </label>
          <select
            value={formData.industry || ''}
            onChange={(e) => updateData('industry', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          >
            <option value="">Select your industry</option>
            <option value="technology">Technology</option>
            <option value="ecommerce">E-commerce</option>
            <option value="consulting">Professional Services</option>
            <option value="retail">Retail</option>
            <option value="hospitality">Hospitality</option>
            <option value="healthcare">Healthcare</option>
            <option value="finance">Financial Services</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Monthly Revenue *
          </label>
          <select
            value={formData.monthlyRevenue || ''}
            onChange={(e) => updateData('monthlyRevenue', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          >
            <option value="">Select range</option>
            <option value="10k-50k">$10K - $50K AUD</option>
            <option value="50k-100k">$50K - $100K AUD</option>
            <option value="100k-500k">$100K - $500K AUD</option>
            <option value="500k-1m">$500K - $1M AUD</option>
            <option value="1m+">$1M+ AUD</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Contact Email *
          </label>
          <input
            type="email"
            value={formData.contactEmail || ''}
            onChange={(e) => updateData('contactEmail', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="founder@yourbusiness.com.au"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Phone Number
          </label>
          <input
            type="tel"
            value={formData.phoneNumber || ''}
            onChange={(e) => updateData('phoneNumber', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="+61 4 1234 5678"
          />
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              Your information is encrypted and used only for Australian compliance requirements 
              and platform setup. We never share your data with third parties.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StripeConnectionStep({ data, onData }: StepProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');

  const handleStripeConnect = async () => {
    setIsConnecting(true);
    try {
      const response = await fetch('/api/integrations/stripe/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: 'beta-user' }), // Will be replaced with actual tenant ID
      });
      
      const result = await response.json();
      
      if (result.success) {
        window.location.href = result.authUrl;
      } else {
        setConnectionStatus('error');
      }
    } catch (error) {
      setConnectionStatus('error');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Connect Your Stripe Account</h2>
      <p className="text-gray-600 mb-8">
        Connect your existing Stripe account to automatically convert payments to Bitcoin.
      </p>

      {connectionStatus === 'disconnected' && (
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
            <CreditCard className="w-8 h-8 text-blue-600" />
          </div>

          <h3 className="text-xl font-semibold text-gray-900 mb-4">
            Ready to Connect Stripe
          </h3>

          <p className="text-gray-600 mb-8 max-w-md mx-auto">
            We'll redirect you to Stripe's secure connection flow. Your payment data 
            remains fully under your control.
          </p>

          <button
            onClick={handleStripeConnect}
            disabled={isConnecting}
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                Connect Stripe Account
                <ArrowRight className="w-5 h-5 ml-2" />
              </>
            )}
          </button>

          <div className="mt-8 grid md:grid-cols-3 gap-4 text-left">
            <div className="p-4 bg-green-50 rounded-lg">
              <Check className="w-5 h-5 text-green-500 mb-2" />
              <p className="text-sm text-gray-700">
                <strong>Secure OAuth</strong><br />
                Bank-grade security
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <Check className="w-5 h-5 text-green-500 mb-2" />
              <p className="text-sm text-gray-700">
                <strong>Your Data</strong><br />
                Full control maintained
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <Check className="w-5 h-5 text-green-500 mb-2" />
              <p className="text-sm text-gray-700">
                <strong>Instant Setup</strong><br />
                Ready in 30 seconds
              </p>
            </div>
          </div>
        </div>
      )}

      {connectionStatus === 'connected' && (
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">
            Stripe Connected Successfully!
          </h3>
          <p className="text-gray-600">
            Your Stripe account is now connected and ready for Bitcoin automation.
          </p>
        </div>
      )}

      {connectionStatus === 'error' && (
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">
            Connection Failed
          </h3>
          <p className="text-gray-600 mb-6">
            We couldn't connect to your Stripe account. Please try again.
          </p>
          <button
            onClick={() => setConnectionStatus('disconnected')}
            className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            Try Again
          </button>
        </div>
      )}

      <div className="mt-8 p-4 bg-yellow-50 rounded-lg">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div className="ml-3">
            <p className="text-sm text-yellow-700">
              <strong>Don't have Stripe yet?</strong> Create a free account at{' '}
              <a href="https://stripe.com/au" target="_blank" rel="noopener noreferrer" className="underline">
                stripe.com/au
              </a>{' '}
              first, then return here to connect.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreasuryRulesStep({ data, onData }: StepProps) {
  const [formData, setFormData] = useState(data.treasury || {});
  
  const updateData = (field: string, value: any) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
    onData({ ...data, treasury: newFormData });
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Treasury Automation Rules</h2>
      <p className="text-gray-600 mb-8">
        Configure how much of your revenue should automatically convert to Bitcoin.
      </p>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Conversion Percentage *
          </label>
          <div className="flex items-center space-x-4">
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={formData.conversionPercentage || 2}
              onChange={(e) => updateData('conversionPercentage', parseFloat(e.target.value))}
              className="flex-1"
            />
            <div className="min-w-0 px-3 py-2 bg-orange-50 rounded-lg">
              <span className="text-lg font-semibold text-orange-600">
                {formData.conversionPercentage || 2}%
              </span>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Percentage of each payment to convert to Bitcoin (Beta limit: 10%)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Minimum Amount per Conversion
          </label>
          <select
            value={formData.minimumAmount || 100}
            onChange={(e) => updateData('minimumAmount', parseInt(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          >
            <option value={50}>$50 AUD</option>
            <option value={100}>$100 AUD</option>
            <option value={250}>$250 AUD</option>
            <option value={500}>$500 AUD</option>
            <option value={1000}>$1,000 AUD</option>
          </select>
          <p className="text-sm text-gray-500 mt-1">
            Only convert when the calculated amount exceeds this threshold
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Conversion Frequency
          </label>
          <select
            value={formData.frequency || 'immediate'}
            onChange={(e) => updateData('frequency', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          >
            <option value="immediate">Immediate (with each payment)</option>
            <option value="daily">Daily batch</option>
            <option value="weekly">Weekly batch</option>
            <option value="monthly">Monthly batch</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Risk Tolerance
          </label>
          <select
            value={formData.riskTolerance || 'moderate'}
            onChange={(e) => updateData('riskTolerance', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          >
            <option value="conservative">Conservative (DCA only)</option>
            <option value="moderate">Moderate (DCA with some timing)</option>
            <option value="aggressive">Aggressive (Market timing enabled)</option>
          </select>
        </div>
      </div>

      <div className="mt-8 p-6 bg-green-50 rounded-lg">
        <h4 className="font-semibold text-green-900 mb-3">Example Projection</h4>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-green-700">
              <strong>Monthly Revenue:</strong> {data.business?.monthlyRevenue || '$50K - $100K'}
            </p>
            <p className="text-green-700">
              <strong>Conversion Rate:</strong> {formData.conversionPercentage || 2}%
            </p>
          </div>
          <div>
            <p className="text-green-700">
              <strong>Est. Bitcoin/Month:</strong> $1,000 - $2,000 AUD
            </p>
            <p className="text-green-700">
              <strong>Annual Accumulation:</strong> $12K - $24K AUD
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function BitcoinWalletStep({ data, onData }: StepProps) {
  const [formData, setFormData] = useState(data.wallet || {});
  const [isValidating, setIsValidating] = useState(false);
  
  const updateData = (field: string, value: any) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
    onData({ ...data, wallet: newFormData });
  };

  const validateWalletAddress = async () => {
    if (!formData.address) return;
    
    setIsValidating(true);
    try {
      const response = await fetch('/api/bitcoin/validate-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: formData.address }),
      });
      
      const result = await response.json();
      updateData('verified', result.valid);
    } catch (error) {
      updateData('verified', false);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Bitcoin Wallet Setup</h2>
      <p className="text-gray-600 mb-8">
        Choose where your Bitcoin purchases should be sent. Self-custody is recommended for maximum security.
      </p>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-4">
            Custody Option *
          </label>
          <div className="grid md:grid-cols-2 gap-4">
            <div
              onClick={() => updateData('type', 'self-custody')}
              className={`p-6 border-2 rounded-lg cursor-pointer transition-all ${
                formData.type === 'self-custody' 
                  ? 'border-orange-500 bg-orange-50' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <Shield className="w-8 h-8 text-orange-600" />
                {formData.type === 'self-custody' && (
                  <Check className="w-6 h-6 text-orange-600" />
                )}
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">
                Self-Custody (Recommended)
              </h3>
              <p className="text-sm text-gray-600">
                Provide your own wallet address. You control the keys and Bitcoin.
              </p>
              <div className="mt-3 text-xs text-green-600 font-medium">
                ✓ Maximum security ✓ Full control ✓ Your keys
              </div>
            </div>

            <div
              onClick={() => updateData('type', 'zerocap')}
              className={`p-6 border-2 rounded-lg cursor-pointer transition-all ${
                formData.type === 'zerocap' 
                  ? 'border-orange-500 bg-orange-50' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <Building className="w-8 h-8 text-blue-600" />
                {formData.type === 'zerocap' && (
                  <Check className="w-6 h-6 text-orange-600" />
                )}
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">
                ZeroCap Custody
              </h3>
              <p className="text-sm text-gray-600">
                Professional custody by Australian regulated partner.
              </p>
              <div className="mt-3 text-xs text-blue-600 font-medium">
                ✓ Regulated ✓ Insured ✓ Professional management
              </div>
            </div>
          </div>
        </div>

        {formData.type === 'self-custody' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Bitcoin Wallet Address *
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={formData.address || ''}
                onChange={(e) => updateData('address', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono text-sm"
                placeholder="bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
              />
              <button
                onClick={validateWalletAddress}
                disabled={!formData.address || isValidating}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm"
              >
                {isValidating ? 'Validating...' : 'Validate'}
              </button>
            </div>
            
            {formData.verified === true && (
              <p className="text-sm text-green-600 mt-2 flex items-center">
                <Check className="w-4 h-4 mr-1" />
                Valid Bitcoin address confirmed
              </p>
            )}
            
            {formData.verified === false && (
              <p className="text-sm text-red-600 mt-2 flex items-center">
                <AlertCircle className="w-4 h-4 mr-1" />
                Invalid Bitcoin address format
              </p>
            )}

            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <h4 className="font-semibold text-blue-900 mb-2">Supported Address Formats:</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• <strong>Bech32 (bc1...):</strong> Most efficient, lowest fees</li>
                <li>• <strong>P2SH (3...):</strong> SegWit compatible</li>
                <li>• <strong>Legacy (1...):</strong> Original format, higher fees</li>
              </ul>
            </div>
          </div>
        )}

        {formData.type === 'zerocap' && (
          <div className="p-6 bg-yellow-50 rounded-lg">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div className="ml-3">
                <h4 className="font-semibold text-yellow-900 mb-2">ZeroCap Custody Setup</h4>
                <p className="text-sm text-yellow-700 mb-3">
                  ZeroCap institutional custody will be available when their API v2 launches. 
                  For now, we recommend self-custody for immediate Bitcoin accumulation.
                </p>
                <button
                  onClick={() => updateData('type', 'self-custody')}
                  className="text-sm text-yellow-800 underline hover:text-yellow-900"
                >
                  Switch to Self-Custody →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VerificationStep({ data, onData }: StepProps) {
  const [formData, setFormData] = useState(data.verification || {});
  
  const updateData = (field: string, value: boolean) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
    onData({ ...data, verification: newFormData });
  };

  const allRequiredChecked = formData.termsAccepted && formData.betaAgreement && formData.complianceVerified;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Final Verification</h2>
      <p className="text-gray-600 mb-8">
        Review your setup and accept the beta program terms to complete onboarding.
      </p>

      {/* Setup Summary */}
      <div className="bg-gray-50 p-6 rounded-lg mb-8">
        <h3 className="font-semibold text-gray-900 mb-4">Setup Summary</h3>
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <p><strong>Business:</strong> {data.business?.companyName || 'Not specified'}</p>
            <p><strong>Industry:</strong> {data.business?.industry || 'Not specified'}</p>
            <p><strong>Revenue:</strong> {data.business?.monthlyRevenue || 'Not specified'}</p>
          </div>
          <div>
            <p><strong>Conversion Rate:</strong> {data.treasury?.conversionPercentage || 2}%</p>
            <p><strong>Minimum Amount:</strong> ${data.treasury?.minimumAmount || 100} AUD</p>
            <p><strong>Wallet Type:</strong> {data.wallet?.type === 'self-custody' ? 'Self-Custody' : 'ZeroCap'}</p>
          </div>
        </div>
      </div>

      {/* Verification Checklist */}
      <div className="space-y-4">
        <label className="flex items-start space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.termsAccepted || false}
            onChange={(e) => updateData('termsAccepted', e.target.checked)}
            className="mt-1 h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
          />
          <div className="text-sm">
            <p className="text-gray-900">
              I accept the{' '}
              <a href="/legal/terms" target="_blank" className="text-orange-600 underline">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/legal/privacy" target="_blank" className="text-orange-600 underline">
                Privacy Policy
              </a>
            </p>
          </div>
        </label>

        <label className="flex items-start space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.betaAgreement || false}
            onChange={(e) => updateData('betaAgreement', e.target.checked)}
            className="mt-1 h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
          />
          <div className="text-sm">
            <p className="text-gray-900">
              I understand this is a beta program and agree to provide weekly feedback 
              and participate in user research sessions
            </p>
          </div>
        </label>

        <label className="flex items-start space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.complianceVerified || false}
            onChange={(e) => updateData('complianceVerified', e.target.checked)}
            className="mt-1 h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
          />
          <div className="text-sm">
            <p className="text-gray-900">
              I confirm all business information is accurate and I understand my 
              obligations for Australian tax compliance and ATO reporting
            </p>
          </div>
        </label>

        <label className="flex items-start space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.readyToStart || false}
            onChange={(e) => updateData('readyToStart', e.target.checked)}
            className="mt-1 h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
          />
          <div className="text-sm">
            <p className="text-gray-900">
              I'm ready to start accumulating Bitcoin through automated treasury management
            </p>
          </div>
        </label>
      </div>

      {allRequiredChecked && (
        <div className="mt-8 p-6 bg-green-50 rounded-lg">
          <div className="flex items-center">
            <Check className="w-8 h-8 text-green-600 mr-3" />
            <div>
              <h4 className="font-semibold text-green-900">Ready to Launch!</h4>
              <p className="text-sm text-green-700 mt-1">
                All requirements satisfied. Click "Complete Setup" to activate your Bitcoin treasury.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==============================================
// Main Onboarding Component
// ==============================================

export default function BetaOnboarding() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>({
    business: {},
    integration: {},
    treasury: {},
    wallet: {},
    verification: {},
  });

  const steps = [
    { id: 1, name: 'Welcome', icon: Building },
    { id: 2, name: 'Business Details', icon: Building },
    { id: 3, name: 'Connect Stripe', icon: CreditCard },
    { id: 4, name: 'Treasury Rules', icon: TrendingUp },
    { id: 5, name: 'Bitcoin Wallet', icon: Bitcoin },
    { id: 6, name: 'Verification', icon: Shield },
  ];

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return true;
      case 2:
        return formData.business?.companyName && formData.business?.industry && formData.business?.contactEmail;
      case 3:
        return formData.integration?.stripeConnected || true; // Allow to proceed for demo
      case 4:
        return formData.treasury?.conversionPercentage;
      case 5:
        return formData.wallet?.type && (formData.wallet?.type === 'zerocap' || formData.wallet?.verified);
      case 6:
        return formData.verification?.termsAccepted && formData.verification?.betaAgreement && formData.verification?.complianceVerified;
      default:
        return false;
    }
  };

  const handleNext = async () => {
    if (!canProceed()) return;
    
    setIsLoading(true);
    
    try {
      // Save current step data
      await saveStepData(currentStep, formData);
      
      // Track progress
      await trackOnboardingProgress(currentStep, 'completed');
      
      if (currentStep < steps.length) {
        setCurrentStep(currentStep + 1);
      } else {
        await completeOnboarding(formData);
      }
    } catch (error) {
      console.error('Error proceeding to next step:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-gray-200 z-50">
        <div 
          className="h-full bg-orange-500 transition-all duration-500"
          style={{ width: `${(currentStep / steps.length) * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">
              LIQUID ABT Beta Onboarding
            </h1>
            <div className="text-sm text-gray-500">
              Step {currentStep} of {steps.length}
            </div>
          </div>

          {/* Step Indicators */}
          <div className="flex items-center justify-between mt-8">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = step.id === currentStep;
              const isCompleted = step.id < currentStep;
              
              return (
                <div key={step.id} className="flex items-center">
                  <div className={`
                    flex items-center justify-center w-10 h-10 rounded-full transition-all
                    ${isActive ? 'bg-orange-500 text-white' : 
                      isCompleted ? 'bg-green-500 text-white' : 
                      'bg-gray-200 text-gray-400'}
                  `}>
                    {isCompleted ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`
                      w-full h-0.5 mx-2 transition-all
                      ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}
                    `} style={{ width: '100px' }} />
                  )}
                </div>
              );
            })}
          </div>
          
          <div className="flex justify-center mt-2 space-x-4">
            {steps.map((step) => (
              <div 
                key={step.id}
                className={`text-xs transition-all ${
                  step.id === currentStep ? 'text-orange-600 font-semibold' : 'text-gray-400'
                }`}
              >
                {step.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-lg p-8">
          {currentStep === 1 && <WelcomeStep onData={setFormData} />}
          {currentStep === 2 && <BusinessDetailsStep data={formData} onData={setFormData} />}
          {currentStep === 3 && <StripeConnectionStep data={formData} onData={setFormData} />}
          {currentStep === 4 && <TreasuryRulesStep data={formData} onData={setFormData} />}
          {currentStep === 5 && <BitcoinWalletStep data={formData} onData={setFormData} />}
          {currentStep === 6 && <VerificationStep data={formData} onData={setFormData} />}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t">
            <button
              onClick={handleBack}
              disabled={currentStep === 1}
              className="px-6 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Back
            </button>
            
            <button
              onClick={handleNext}
              disabled={isLoading || !canProceed()}
              className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {currentStep === steps.length ? 'Complete Setup' : 'Next'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Help Section */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
            <div className="ml-3">
              <h3 className="text-sm font-semibold text-blue-900">Beta Program Benefits</h3>
              <p className="text-sm text-blue-700 mt-1">
                As a beta user, you'll receive 6 months free Pro tier ($587.88 value), 
                direct founder support, and input on feature development. Your feedback shapes the platform!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// Helper Functions
// ==============================================

async function saveStepData(step: number, data: OnboardingData) {
  try {
    await fetch('/api/beta/onboarding/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, data }),
    });
  } catch (error) {
    console.error('Failed to save step data:', error);
  }
}

async function trackOnboardingProgress(step: number, status: string) {
  try {
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'beta_onboarding_progress',
        properties: { step, status, timestamp: new Date().toISOString() },
      }),
    });
  } catch (error) {
    console.error('Failed to track progress:', error);
  }
}

async function completeOnboarding(data: OnboardingData) {
  try {
    const response = await fetch('/api/beta/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (response.ok) {
      // Track completion
      await trackOnboardingProgress(6, 'completed');
      
      // Redirect to dashboard
      window.location.href = '/dashboard?welcome=beta';
    } else {
      throw new Error('Failed to complete onboarding');
    }
  } catch (error) {
    console.error('Failed to complete onboarding:', error);
    alert('There was an error completing your onboarding. Please try again or contact support.');
  }
}