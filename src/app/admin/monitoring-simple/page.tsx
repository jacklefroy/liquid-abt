'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface WebhookEvent {
  id: string;
  type: string;
  status: 'success' | 'failed' | 'pending';
  timestamp: string;
  error?: string;
}

interface MonitoringData {
  webhooks?: {
    stripe?: WebhookEvent[];
  };
  conversions?: {
    total: number;
    successful: number;
    successRate: number;
  };
  users?: {
    beta: {
      total: number;
      onboarded: number;
      pending: number;
    };
  };
  errors?: Array<{
    id: string;
    message: string;
    timestamp: string;
    level: 'critical' | 'error' | 'warning';
  }>;
  system?: {
    uptime: number;
    status: 'healthy' | 'degraded' | 'down';
  };
}

interface MockTransaction {
  orderId: string;
  type: string;
  amount: number;
  bitcoinAmount?: number;
  timestamp: string;
  success: boolean;
}

interface MockControlData {
  serviceInfo: {
    isMock: boolean;
    serviceName: string;
  };
  config: {
    mockBtcPrice: string;
    mockSuccessRate: string;
    mockNetworkDelay: string;
  };
  stats: {
    totalTransactions: number;
    successfulTransactions: number;
    successRate: number;
    currentBtcPrice: number;
  };
  history: MockTransaction[];
}

export default function SimpleMonitoringDashboard() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  // Mock mode state
  const [mockData, setMockData] = useState<MockControlData | null>(null);
  const [mockLoading, setMockLoading] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);
  const [testPurchasing, setTestPurchasing] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/monitoring/metrics');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const fullData = await response.json();
      
      // Client-side filtering for simplified dashboard
      const filteredData: MonitoringData = {
        webhooks: {
          stripe: (fullData.webhooks?.stripe || []).slice(0, 10)
        },
        conversions: fullData.conversions || { total: 0, successful: 0, successRate: 0 },
        users: {
          beta: fullData.users?.beta || { total: 0, onboarded: 0, pending: 0 }
        },
        errors: (fullData.errors || [])
          .filter((err: any) => err.level === 'critical')
          .slice(0, 5),
        system: fullData.system || { uptime: 0, status: 'healthy' }
      };
      
      setData(filteredData);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch monitoring data');
    } finally {
      setLoading(false);
    }
  };

  const fetchMockData = async () => {
    try {
      setMockLoading(true);
      const response = await fetch('/api/admin/mock-control?history=true&limit=5');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      if (result.success) {
        setMockData(result.data);
        setMockError(null);
      } else {
        throw new Error(result.error || 'Failed to fetch mock data');
      }
    } catch (err) {
      setMockError(err instanceof Error ? err.message : 'Failed to fetch mock data');
    } finally {
      setMockLoading(false);
    }
  };

  const triggerTestPurchase = async () => {
    try {
      setTestPurchasing(true);
      const response = await fetch('/api/admin/mock-control', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: 100,
          customerReference: `dashboard_test_${Date.now()}`
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      if (result.success) {
        // Refresh mock data to show the new transaction
        await fetchMockData();
      } else {
        throw new Error(result.error || 'Test purchase failed');
      }
    } catch (err) {
      setMockError(err instanceof Error ? err.message : 'Test purchase failed');
    } finally {
      setTestPurchasing(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchMockData(); // Also fetch mock data on component mount
    const interval = setInterval(() => {
      fetchData();
      fetchMockData(); // Refresh mock data too
    }, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      success: 'default',
      healthy: 'default',
      failed: 'destructive',
      down: 'destructive',
      pending: 'secondary',
      degraded: 'secondary'
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-white mb-6">LIQUID ABT - Simple Monitoring</h1>
          <div className="text-gray-400">Loading monitoring data...</div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-white mb-6">LIQUID ABT - Simple Monitoring</h1>
          <Alert className="border-red-800 bg-red-900/20">
            <AlertDescription className="text-red-400">
              Error loading monitoring data: {error}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">LIQUID ABT - Simple Monitoring</h1>
          <div className="text-sm text-gray-400">
            Last updated: {lastUpdated?.toLocaleTimeString() || 'Never'}
            {loading && <span className="ml-2 text-orange-400">Refreshing...</span>}
          </div>
        </div>

        {error && (
          <Alert className="border-yellow-800 bg-yellow-900/20">
            <AlertDescription className="text-yellow-400">
              Warning: {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Mock Mode Dashboard Widget */}
        {mockData?.serviceInfo?.isMock && (
          <div className="space-y-4">
            {/* Mock Mode Active Banner */}
            <Alert className="border-orange-600 bg-orange-900/20">
              <AlertDescription className="text-orange-400 font-semibold text-center">
                🔧 MOCK MODE ACTIVE - Bitcoin Trading Simulation Enabled
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Current Mock BTC Price */}
              <Card className="bg-orange-900/20 border-orange-600">
                <CardHeader className="pb-3">
                  <CardTitle className="text-orange-400 text-sm">Mock BTC Price</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-300">
                    ${mockData.stats.currentBtcPrice?.toLocaleString('en-US') || mockData.config.mockBtcPrice}
                  </div>
                  <div className="text-xs text-orange-400 mt-1">AUD (Simulated)</div>
                </CardContent>
              </Card>

              {/* Mock Stats */}
              <Card className="bg-orange-900/20 border-orange-600">
                <CardHeader className="pb-3">
                  <CardTitle className="text-orange-400 text-sm">Mock Success Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-300">
                    {(mockData.stats.successRate * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-orange-400 mt-1">
                    {mockData.stats.successfulTransactions} of {mockData.stats.totalTransactions} successful
                  </div>
                </CardContent>
              </Card>

              {/* Test Purchase Button */}
              <Card className="bg-orange-900/20 border-orange-600">
                <CardHeader className="pb-3">
                  <CardTitle className="text-orange-400 text-sm">Test Purchase</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={triggerTestPurchase}
                    disabled={testPurchasing || mockLoading}
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                    size="sm"
                  >
                    {testPurchasing ? 'Processing...' : 'Buy $100 BTC'}
                  </Button>
                  {mockError && (
                    <div className="text-xs text-red-400 mt-2">{mockError}</div>
                  )}
                </CardContent>
              </Card>

              {/* Mock Network Delay */}
              <Card className="bg-orange-900/20 border-orange-600">
                <CardHeader className="pb-3">
                  <CardTitle className="text-orange-400 text-sm">Network Delay</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-300">
                    {mockData.config.mockNetworkDelay}ms
                  </div>
                  <div className="text-xs text-orange-400 mt-1">Simulated latency</div>
                </CardContent>
              </Card>
            </div>

            {/* Last 5 Mock Transactions */}
            <Card className="bg-orange-900/20 border-orange-600">
              <CardHeader>
                <CardTitle className="text-orange-400">Recent Mock Transactions (Last 5)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {mockLoading ? (
                  <div className="text-orange-400 text-sm">Loading transactions...</div>
                ) : mockData.history && mockData.history.length > 0 ? (
                  mockData.history.map((tx, index) => (
                    <div key={tx.orderId || index} className="flex items-center justify-between p-2 bg-orange-800/30 rounded border border-orange-700">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-orange-300">
                          {tx.type === 'buy' ? '💰' : tx.type === 'price_check' ? '📊' : '📝'} {tx.type.replace('_', ' ').toUpperCase()}
                        </div>
                        <div className="text-xs text-orange-400">
                          {tx.orderId && tx.type === 'buy' ? `Order: ${tx.orderId}` : ''}
                          {tx.amount && tx.type === 'buy' ? ` • $${tx.amount.toFixed(2)} AUD` : ''}
                          {tx.bitcoinAmount && tx.type === 'buy' ? ` → ${tx.bitcoinAmount.toFixed(8)} BTC` : ''}
                        </div>
                        <div className="text-xs text-orange-500">
                          {new Date(tx.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <Badge variant={tx.success ? 'default' : 'destructive'} className="ml-2">
                        {tx.success ? 'Success' : 'Failed'}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-orange-400 text-sm">No recent transactions</div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* System Uptime */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-white flex items-center justify-between">
                System Uptime
                {getStatusBadge(data?.system?.status || 'unknown')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-400">
                {data?.system?.uptime ? formatUptime(data.system.uptime) : 'Unknown'}
              </div>
            </CardContent>
          </Card>

          {/* Bitcoin Conversion Success Rate */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-white">Bitcoin Conversion Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-400">
                {data?.conversions?.successRate?.toFixed(1) || '0.0'}%
              </div>
              <div className="text-sm text-gray-400 mt-1">
                {data?.conversions?.successful || 0} of {data?.conversions?.total || 0} successful
              </div>
            </CardContent>
          </Card>

          {/* Beta User Count */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-white">Beta Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-400">
                {data?.users?.beta?.total || 0}
              </div>
              <div className="text-sm text-gray-400 mt-1 space-x-4">
                <span>Onboarded: {data?.users?.beta?.onboarded || 0}</span>
                <span>Pending: {data?.users?.beta?.pending || 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Stripe Webhook Status */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Stripe Webhook Status (Last 10)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data?.webhooks?.stripe?.length ? (
                data.webhooks.stripe.map((webhook) => (
                  <div key={webhook.id} className="flex items-center justify-between p-2 bg-gray-700 rounded">
                    <div>
                      <div className="text-sm font-medium text-white">{webhook.type}</div>
                      <div className="text-xs text-gray-400">
                        {new Date(webhook.timestamp).toLocaleString()}
                      </div>
                      {webhook.error && (
                        <div className="text-xs text-red-400 mt-1">{webhook.error}</div>
                      )}
                    </div>
                    {getStatusBadge(webhook.status)}
                  </div>
                ))
              ) : (
                <div className="text-gray-400 text-sm">No recent webhooks</div>
              )}
            </CardContent>
          </Card>

          {/* Last 5 Critical Errors */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Critical Errors (Last 5)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data?.errors?.length ? (
                data.errors.map((error) => (
                  <div key={error.id} className="p-2 bg-red-900/20 border border-red-800 rounded">
                    <div className="text-sm font-medium text-red-400">{error.message}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(error.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-green-400 text-sm">No critical errors ✓</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}