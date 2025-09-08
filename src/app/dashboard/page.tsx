'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Clock, RefreshCw } from 'lucide-react';

interface DashboardStats {
  portfolio: {
    totalBtcBalance: string;
    totalAudSpent: string;
    currentPortfolioValue: string;
    unrealizedGains: string;
    performancePercent: string;
    totalFees: string;
  };
  transactions: {
    total: number;
    last24Hours: number;
    last7Days: number;
    last30Days: number;
    conversionRate: string;
  };
  bitcoinPurchases: {
    total: number;
    today: number;
    thisMonth: number;
    totalBtcAcquired: string;
    todayBtc: string;
    monthBtc: string;
  };
  volume: {
    monthlyUsed: string;
    monthlyLimit: string;
    utilizationPercent: string;
    dailyLimit: string;
    maxTransactionLimit: string;
  };
  account: {
    companyName: string;
    subscriptionTier: string;
    isActive: boolean;
    totalRules: number;
    activeRules: number;
  };
  recentActivity: Array<{
    id: string;
    type: string;
    bitcoinAmount: string;
    fiatAmount: string;
    exchangeRate: string;
    fees: string;
    status: string;
    timestamp: string;
  }>;
  market: {
    currentBtcPrice: string;
    currency: string;
    lastUpdated: string;
  };
  generatedAt: string;
  tenantId: string;
}

interface ReconciliationStatus {
  success: boolean;
  tenantId: string;
  status: {
    hasRecentReconciliation: boolean;
    hoursSinceLastReconciliation: number | null;
    lastReconciliationTime: string | null;
    currentStatus: string;
    totalOrphanedPayments: number;
    totalMismatches: number;
    isHealthy: boolean;
  };
  recommendations: {
    shouldRunNewReconciliation: boolean;
    urgency: 'normal' | 'high';
    message: string;
  };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [reconciliationStatus, setReconciliationStatus] = useState<ReconciliationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingReconciliation, setCheckingReconciliation] = useState(false);

  useEffect(() => {
    fetchDashboardStats();
    fetchReconciliationStatus();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      const token = localStorage.getItem('jwt_token');
      if (!token) {
        throw new Error('No authentication token');
      }

      const response = await fetch('/api/dashboard/mock-stats', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchReconciliationStatus = async () => {
    try {
      const token = localStorage.getItem('jwt_token');
      if (!token) return;

      const response = await fetch('/api/reconciliation/process', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setReconciliationStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch reconciliation status:', error);
    }
  };

  const triggerReconciliation = async () => {
    setCheckingReconciliation(true);
    try {
      const token = localStorage.getItem('jwt_token');
      const response = await fetch('/api/reconciliation/process', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          triggerRecovery: true,
          lookbackHours: 24
        })
      });

      if (response.ok) {
        await fetchReconciliationStatus(); // Refresh status
        alert('Reconciliation completed successfully');
      } else {
        throw new Error('Reconciliation failed');
      }
    } catch (error) {
      console.error('Reconciliation error:', error);
      alert('Reconciliation failed. Please contact support if this continues.');
    } finally {
      setCheckingReconciliation(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
          <p className="mt-4">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900 border border-red-700 text-red-100 px-6 py-4 rounded-lg">
        <h3 className="font-medium">Failed to load dashboard</h3>
        <p className="mt-2 text-sm">{error}</p>
        <button
          onClick={fetchDashboardStats}
          className="mt-4 bg-red-800 hover:bg-red-700 px-4 py-2 rounded text-sm transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return <div className="text-white">No data available</div>;
  }

  const isPositiveGains = parseFloat(stats.portfolio.unrealizedGains) >= 0;
  const utilizationPercent = parseFloat(stats.volume.utilizationPercent);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="mt-2 text-gray-300">
          Welcome to {stats.account.companyName} Bitcoin Treasury
        </p>
      </div>

      {/* Reconciliation Status Alert */}
      {reconciliationStatus && (
        <div className={`rounded-lg p-4 border ${
          reconciliationStatus.status.isHealthy 
            ? 'bg-green-900/20 border-green-600' 
            : reconciliationStatus.recommendations.urgency === 'high'
            ? 'bg-red-900/20 border-red-600'
            : 'bg-yellow-900/20 border-yellow-600'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {reconciliationStatus.status.isHealthy ? (
                <CheckCircle className="h-5 w-5 text-green-400 mr-3" />
              ) : reconciliationStatus.recommendations.urgency === 'high' ? (
                <AlertTriangle className="h-5 w-5 text-red-400 mr-3" />
              ) : (
                <Clock className="h-5 w-5 text-yellow-400 mr-3" />
              )}
              
              <div>
                <h3 className={`font-medium ${
                  reconciliationStatus.status.isHealthy ? 'text-green-100' : 
                  reconciliationStatus.recommendations.urgency === 'high' ? 'text-red-100' : 
                  'text-yellow-100'
                }`}>
                  {reconciliationStatus.status.isHealthy ? 'All Systems Healthy' : 'Transaction Monitoring'}
                </h3>
                <p className={`text-sm ${
                  reconciliationStatus.status.isHealthy ? 'text-green-200' : 
                  reconciliationStatus.recommendations.urgency === 'high' ? 'text-red-200' : 
                  'text-yellow-200'
                }`}>
                  {reconciliationStatus.recommendations.message}
                </p>
                
                {reconciliationStatus.status.lastReconciliationTime && (
                  <p className="text-xs text-gray-400 mt-1">
                    Last checked: {new Date(reconciliationStatus.status.lastReconciliationTime).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              {(reconciliationStatus.status.totalOrphanedPayments > 0 || 
                reconciliationStatus.status.totalMismatches > 0) && (
                <div className="text-right text-sm">
                  {reconciliationStatus.status.totalOrphanedPayments > 0 && (
                    <div className="text-red-300">
                      {reconciliationStatus.status.totalOrphanedPayments} orphaned payments
                    </div>
                  )}
                  {reconciliationStatus.status.totalMismatches > 0 && (
                    <div className="text-yellow-300">
                      {reconciliationStatus.status.totalMismatches} mismatches
                    </div>
                  )}
                </div>
              )}
              
              <button
                onClick={triggerReconciliation}
                disabled={checkingReconciliation}
                className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm transition-colors"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${checkingReconciliation ? 'animate-spin' : ''}`} />
                {checkingReconciliation ? 'Checking...' : 'Check Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portfolio Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                <span className="text-sm font-bold text-white">₿</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-300">Bitcoin Balance</p>
              <p className="text-2xl font-semibold text-white">
                {parseFloat(stats.portfolio.totalBtcBalance).toFixed(6)} BTC
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                <span className="text-sm font-bold text-white">$</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-300">Portfolio Value</p>
              <p className="text-2xl font-semibold text-white">
                ${parseFloat(stats.portfolio.currentPortfolioValue).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                isPositiveGains ? 'bg-green-500' : 'bg-red-500'
              }`}>
                <span className="text-sm font-bold text-white">
                  {isPositiveGains ? '↑' : '↓'}
                </span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-300">Unrealized Gains</p>
              <p className={`text-2xl font-semibold ${
                isPositiveGains ? 'text-green-400' : 'text-red-400'
              }`}>
                {isPositiveGains ? '+' : ''}${parseFloat(stats.portfolio.unrealizedGains).toLocaleString()}
              </p>
              <p className={`text-xs ${
                isPositiveGains ? 'text-green-400' : 'text-red-400'
              }`}>
                {isPositiveGains ? '+' : ''}{parseFloat(stats.portfolio.performancePercent).toFixed(2)}%
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-sm font-bold text-white">#</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-300">Total Purchases</p>
              <p className="text-2xl font-semibold text-white">
                {stats.bitcoinPurchases.total}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transaction Stats */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-medium text-white mb-4">Transaction Activity</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-300">Last 24 hours</span>
              <span className="text-white font-medium">{stats.transactions.last24Hours}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Last 7 days</span>
              <span className="text-white font-medium">{stats.transactions.last7Days}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Last 30 days</span>
              <span className="text-white font-medium">{stats.transactions.last30Days}</span>
            </div>
            <div className="flex justify-between border-t border-gray-700 pt-3">
              <span className="text-gray-300">Conversion Rate</span>
              <span className="text-orange-400 font-medium">{stats.transactions.conversionRate}%</span>
            </div>
          </div>
        </div>

        {/* Volume Usage */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-medium text-white mb-4">Volume Usage</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-300">Monthly Limit</span>
                <span className="text-white">{utilizationPercent.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    utilizationPercent > 80 ? 'bg-red-500' :
                    utilizationPercent > 60 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
                ></div>
              </div>
              <div className="flex justify-between mt-1 text-sm text-gray-400">
                <span>${parseFloat(stats.volume.monthlyUsed).toLocaleString()}</span>
                <span>${parseFloat(stats.volume.monthlyLimit).toLocaleString()}</span>
              </div>
            </div>
            <div className="border-t border-gray-700 pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-300">Daily limit</span>
                <span className="text-white">${parseFloat(stats.volume.dailyLimit).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-300">Max transaction</span>
                <span className="text-white">${parseFloat(stats.volume.maxTransactionLimit).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Account Status */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-medium text-white mb-4">Account Status</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-300">Plan</span>
              <span className="text-orange-400 font-medium">{stats.account.subscriptionTier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Status</span>
              <span className={`font-medium ${
                stats.account.isActive ? 'text-green-400' : 'text-red-400'
              }`}>
                {stats.account.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Treasury Rules</span>
              <span className="text-white font-medium">
                {stats.account.activeRules}/{stats.account.totalRules}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">BTC Price</span>
              <span className="text-white font-medium">
                ${parseFloat(stats.market.currentBtcPrice).toLocaleString()} AUD
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-medium text-white mb-4">Recent Bitcoin Purchases</h3>
        {stats.recentActivity.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-gray-300 font-medium">Date</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-medium">Bitcoin</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-medium">AUD Spent</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-medium">Rate</th>
                  <th className="text-right py-3 px-4 text-gray-300 font-medium">Fees</th>
                  <th className="text-center py-3 px-4 text-gray-300 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentActivity.map((activity) => (
                  <tr key={activity.id} className="border-b border-gray-700 hover:bg-gray-750">
                    <td className="py-3 px-4 text-white">
                      {new Date(activity.timestamp).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right text-orange-400 font-mono">
                      {parseFloat(activity.bitcoinAmount).toFixed(6)} BTC
                    </td>
                    <td className="py-3 px-4 text-right text-white">
                      ${parseFloat(activity.fiatAmount).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-300">
                      ${parseFloat(activity.exchangeRate).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-400">
                      ${parseFloat(activity.fees).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-1 rounded text-xs ${
                        activity.status === 'completed' 
                          ? 'bg-green-900 text-green-200' 
                          : activity.status === 'pending'
                          ? 'bg-yellow-900 text-yellow-200'
                          : 'bg-red-900 text-red-200'
                      }`}>
                        {activity.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-400">No recent Bitcoin purchases</p>
            <p className="text-gray-500 text-sm mt-2">
              Set up treasury rules to start automated Bitcoin accumulation
            </p>
          </div>
        )}
      </div>
    </div>
  );
}