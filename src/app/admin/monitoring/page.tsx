// LIQUID ABT - Admin Monitoring Dashboard
// Comprehensive monitoring dashboard for Phase 1 MVP operations

'use client';

import { useState, useEffect } from 'react';
import { 
  Activity, AlertTriangle, CheckCircle, Clock, CreditCard, 
  Database, DollarSign, Globe, Server, TrendingUp, Users,
  Zap, Bitcoin, RefreshCw, Shield, Loader2, XCircle, 
  ArrowUp, ArrowDown, Minus, Eye, AlertCircle
} from 'lucide-react';
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Line, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';

// ==============================================
// Types
// ==============================================

interface SystemMetrics {
  timestamp: string;
  status: 'healthy' | 'warning' | 'critical';
  uptime: number;
  health: HealthMetrics;
  stripe: StripeMetrics;
  bitcoin: BitcoinMetrics;
  database: DatabaseMetrics;
  api: APIMetrics;
  errors: ErrorMetrics;
  betaUsers: BetaUserMetrics;
  users: { active: number; total: number };
  transactions: { today: number; total: number; volume: number };
  revenue: { total: number; today: number };
  recentEvents: Event[];
}

interface HealthMetrics {
  cpu: number;
  memory: number;
  disk: number;
  status: string;
}

interface StripeMetrics {
  webhooksReceived: number;
  webhooksProcessed: number;
  webhookSuccessRate: number;
  paymentsToday: number;
  volumeToday: number;
  averageAmount: number;
  topCountries: Array<{ country: string; count: number }>;
  recentTransactions: Array<{
    id: string;
    amount: number;
    status: string;
    timestamp: string;
  }>;
}

interface BitcoinMetrics {
  purchasesToday: number;
  totalPurchased: number;
  averagePurchase: number;
  successRate: number;
  currentPrice: number;
  priceChange24h: number;
  exchangeStatus: {
    kraken: 'online' | 'offline' | 'degraded';
  };
}

interface DatabaseMetrics {
  connections: number;
  maxConnections: number;
  queryTime: number;
  slowQueries: number;
  tenantSchemas: number;
}

interface APIMetrics {
  requestsPerMinute: number;
  averageResponseTime: number;
  errorRate: number;
  slowRequests: number;
  topEndpoints: Array<{ path: string; count: number; avgTime: number }>;
}

interface ErrorMetrics {
  totalToday: number;
  criticalToday: number;
  errorRate: number;
  topErrors: Array<{ message: string; count: number; lastSeen: string }>;
  errorTrend: Array<{ time: string; count: number }>;
}

interface BetaUserMetrics {
  totalUsers: number;
  activeToday: number;
  onboardingCompletionRate: number;
  averageOnboardingTime: number;
  recentSignups: Array<{
    company: string;
    industry: string;
    timestamp: string;
    status: string;
  }>;
}

interface Event {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  timestamp: string;
  details?: any;
}

// ==============================================
// Main Monitoring Dashboard
// ==============================================

export default function MonitoringDashboard() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const [selectedTimeRange, setSelectedTimeRange] = useState('1h');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [refreshInterval, selectedTimeRange]);

  const fetchMetrics = async () => {
    try {
      const response = await fetch(`/api/monitoring/metrics?range=${selectedTimeRange}`);
      const data = await response.json();
      setMetrics(data);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && !metrics) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading monitoring data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">System Monitoring</h1>
              <p className="text-sm text-gray-500">
                Phase 1 MVP - Last updated: {lastUpdate?.toLocaleTimeString()}
              </p>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* Time Range Selector */}
              <select 
                value={selectedTimeRange}
                onChange={(e) => setSelectedTimeRange(e.target.value)}
                className="px-3 py-1 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
              >
                <option value="5m">Last 5 minutes</option>
                <option value="1h">Last hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
              </select>
              
              {/* Refresh Interval */}
              <select 
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="px-3 py-1 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
              >
                <option value="10">Refresh: 10s</option>
                <option value="30">Refresh: 30s</option>
                <option value="60">Refresh: 1m</option>
                <option value="300">Refresh: 5m</option>
              </select>
              
              {/* Manual Refresh */}
              <button 
                onClick={fetchMetrics}
                disabled={isLoading}
                className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* System Status Bar */}
      <SystemStatusBar metrics={metrics} />

      {/* Main Grid */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Critical Metrics */}
          <div className="lg:col-span-3">
            <CriticalMetrics metrics={metrics} />
          </div>

          {/* Stripe Integration */}
          <div className="lg:col-span-2">
            <StripeMetrics metrics={metrics?.stripe} />
          </div>

          {/* Bitcoin Operations */}
          <div>
            <BitcoinMetrics metrics={metrics?.bitcoin} />
          </div>

          {/* System Health */}
          <div>
            <SystemHealth metrics={metrics?.health} />
          </div>

          {/* Database Performance */}
          <div>
            <DatabaseMetrics metrics={metrics?.database} />
          </div>

          {/* API Performance */}
          <div>
            <APIMetrics metrics={metrics?.api} />
          </div>

          {/* Error Tracking */}
          <div className="lg:col-span-2">
            <ErrorTracking errors={metrics?.errors} />
          </div>

          {/* Beta User Activity */}
          <div>
            <BetaUserActivity users={metrics?.betaUsers} />
          </div>

          {/* Recent Events */}
          <div className="lg:col-span-3">
            <RecentEvents events={metrics?.recentEvents || []} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// Status Bar Component
// ==============================================

function SystemStatusBar({ metrics }: { metrics: SystemMetrics | null }) {
  if (!metrics) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500';
      case 'warning': return 'bg-yellow-500';
      case 'critical': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return CheckCircle;
      case 'warning': return AlertTriangle;
      case 'critical': return XCircle;
      default: return Clock;
    }
  };

  const StatusIcon = getStatusIcon(metrics.status);

  return (
    <div className={`${getStatusColor(metrics.status)} text-white`}>
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <StatusIcon className="w-5 h-5" />
            <span className="font-semibold capitalize">{metrics.status}</span>
            <span className="text-sm opacity-75">
              Uptime: {Math.floor(metrics.uptime / 3600)}h {Math.floor((metrics.uptime % 3600) / 60)}m
            </span>
          </div>
          
          <div className="flex items-center space-x-6 text-sm">
            <div className="flex items-center space-x-1">
              <Users className="w-4 h-4" />
              <span>{metrics.users?.active || 0} active</span>
            </div>
            <div className="flex items-center space-x-1">
              <Activity className="w-4 h-4" />
              <span>{metrics.transactions?.today || 0} transactions</span>
            </div>
            <div className="flex items-center space-x-1">
              <DollarSign className="w-4 h-4" />
              <span>${(metrics.revenue?.today || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// Critical Metrics Component
// ==============================================

function CriticalMetrics({ metrics }: { metrics: SystemMetrics | null }) {
  if (!metrics) return null;

  const criticalStats = [
    {
      title: 'Active Users',
      value: metrics.users?.active || 0,
      change: '+12%',
      trend: 'up',
      icon: Users,
      color: 'text-blue-600',
    },
    {
      title: 'Transactions Today',
      value: metrics.transactions?.today || 0,
      change: '+8%',
      trend: 'up',
      icon: Activity,
      color: 'text-green-600',
    },
    {
      title: 'Revenue Today',
      value: `$${(metrics.revenue?.today || 0).toLocaleString()}`,
      change: '+15%',
      trend: 'up',
      icon: DollarSign,
      color: 'text-emerald-600',
    },
    {
      title: 'Error Rate',
      value: `${((metrics.errors?.errorRate || 0) * 100).toFixed(2)}%`,
      change: '-2%',
      trend: 'down',
      icon: AlertTriangle,
      color: 'text-red-600',
    },
    {
      title: 'API Response Time',
      value: `${metrics.api?.averageResponseTime || 0}ms`,
      change: '-5ms',
      trend: 'down',
      icon: Zap,
      color: 'text-yellow-600',
    },
    {
      title: 'Beta Users',
      value: metrics.betaUsers?.totalUsers || 0,
      change: 'Target: 5',
      trend: 'neutral',
      icon: Shield,
      color: 'text-purple-600',
    },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Critical Metrics</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {criticalStats.map((stat, index) => {
          const Icon = stat.icon;
          const TrendIcon = stat.trend === 'up' ? ArrowUp : stat.trend === 'down' ? ArrowDown : Minus;
          
          return (
            <div key={index} className="text-center">
              <div className={`mx-auto w-12 h-12 ${stat.color.replace('text-', 'bg-').replace('-600', '-100')} rounded-full flex items-center justify-center mb-2`}>
                <Icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-sm text-gray-500">{stat.title}</div>
              <div className={`text-xs flex items-center justify-center mt-1 ${
                stat.trend === 'up' ? 'text-green-600' : 
                stat.trend === 'down' ? 'text-red-600' : 
                'text-gray-500'
              }`}>
                <TrendIcon className="w-3 h-3 mr-1" />
                {stat.change}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==============================================
// Stripe Metrics Component
// ==============================================

function StripeMetrics({ metrics }: { metrics?: StripeMetrics }) {
  if (!metrics) return <div className="bg-white rounded-lg shadow p-6">Loading Stripe metrics...</div>;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Stripe Integration</h2>
        <CreditCard className="w-5 h-5 text-blue-600" />
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="text-center p-4 bg-blue-50 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">{metrics.webhooksReceived}</div>
          <div className="text-sm text-gray-600">Webhooks Received</div>
        </div>
        <div className="text-center p-4 bg-green-50 rounded-lg">
          <div className="text-2xl font-bold text-green-600">{metrics.webhookSuccessRate}%</div>
          <div className="text-sm text-gray-600">Success Rate</div>
        </div>
        <div className="text-center p-4 bg-purple-50 rounded-lg">
          <div className="text-2xl font-bold text-purple-600">${metrics.volumeToday.toLocaleString()}</div>
          <div className="text-sm text-gray-600">Volume Today</div>
        </div>
        <div className="text-center p-4 bg-orange-50 rounded-lg">
          <div className="text-2xl font-bold text-orange-600">{metrics.paymentsToday}</div>
          <div className="text-sm text-gray-600">Payments Today</div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent Transactions</h3>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {metrics.recentTransactions?.slice(0, 5).map((tx, index) => (
            <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${
                  tx.status === 'succeeded' ? 'bg-green-500' : 
                  tx.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-sm font-mono">{tx.id.slice(-8)}</span>
              </div>
              <div className="text-sm font-semibold">${tx.amount}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==============================================
// Bitcoin Metrics Component
// ==============================================

function BitcoinMetrics({ metrics }: { metrics?: BitcoinMetrics }) {
  if (!metrics) return <div className="bg-white rounded-lg shadow p-6">Loading Bitcoin metrics...</div>;

  const priceChangeColor = metrics.priceChange24h >= 0 ? 'text-green-600' : 'text-red-600';
  const PriceIcon = metrics.priceChange24h >= 0 ? ArrowUp : ArrowDown;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Bitcoin Operations</h2>
        <Bitcoin className="w-5 h-5 text-orange-500" />
      </div>
      
      <div className="space-y-4">
        <div className="text-center p-4 bg-orange-50 rounded-lg">
          <div className="text-2xl font-bold text-orange-600">
            ${metrics.currentPrice.toLocaleString()}
          </div>
          <div className={`text-sm flex items-center justify-center ${priceChangeColor}`}>
            <PriceIcon className="w-4 h-4 mr-1" />
            {Math.abs(metrics.priceChange24h).toFixed(2)}% (24h)
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="text-lg font-bold text-gray-900">{metrics.purchasesToday}</div>
            <div className="text-xs text-gray-600">Purchases Today</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="text-lg font-bold text-gray-900">{metrics.successRate}%</div>
            <div className="text-xs text-gray-600">Success Rate</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="text-lg font-bold text-gray-900">
              ${metrics.averagePurchase.toLocaleString()}
            </div>
            <div className="text-xs text-gray-600">Avg Purchase</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="text-lg font-bold text-gray-900">
              {metrics.totalPurchased.toFixed(4)} BTC
            </div>
            <div className="text-xs text-gray-600">Total Purchased</div>
          </div>
        </div>

        {/* Exchange Status */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Exchange Status</h3>
          <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
            <span className="text-sm">Kraken</span>
            <div className="flex items-center">
              <div className={`w-2 h-2 rounded-full mr-2 ${
                metrics.exchangeStatus.kraken === 'online' ? 'bg-green-500' : 
                metrics.exchangeStatus.kraken === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              <span className="text-sm capitalize">{metrics.exchangeStatus.kraken}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// System Health Component
// ==============================================

function SystemHealth({ metrics }: { metrics?: HealthMetrics }) {
  if (!metrics) return <div className="bg-white rounded-lg shadow p-6">Loading health metrics...</div>;

  const healthItems = [
    { name: 'CPU', value: metrics.cpu, max: 100, color: 'bg-blue-500' },
    { name: 'Memory', value: metrics.memory, max: 100, color: 'bg-green-500' },
    { name: 'Disk', value: metrics.disk, max: 100, color: 'bg-purple-500' },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">System Health</h2>
        <Server className="w-5 h-5 text-gray-600" />
      </div>
      
      <div className="space-y-4">
        {healthItems.map((item) => (
          <div key={item.name}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-medium text-gray-700">{item.name}</span>
              <span className="text-sm text-gray-600">{item.value}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${item.color} ${item.value > 80 ? 'bg-red-500' : item.value > 60 ? 'bg-yellow-500' : item.color}`}
                style={{ width: `${item.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 bg-gray-50 rounded-lg">
        <div className="text-sm text-gray-600">System Status</div>
        <div className={`text-lg font-semibold capitalize ${
          metrics.status === 'healthy' ? 'text-green-600' : 
          metrics.status === 'warning' ? 'text-yellow-600' : 'text-red-600'
        }`}>
          {metrics.status}
        </div>
      </div>
    </div>
  );
}

// ==============================================
// Database Metrics Component
// ==============================================

function DatabaseMetrics({ metrics }: { metrics?: DatabaseMetrics }) {
  if (!metrics) return <div className="bg-white rounded-lg shadow p-6">Loading database metrics...</div>;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Database</h2>
        <Database className="w-5 h-5 text-indigo-600" />
      </div>
      
      <div className="space-y-3">
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
          <span className="text-sm text-gray-600">Connections</span>
          <span className="font-semibold">{metrics.connections}/{metrics.maxConnections}</span>
        </div>
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
          <span className="text-sm text-gray-600">Avg Query Time</span>
          <span className="font-semibold">{metrics.queryTime}ms</span>
        </div>
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
          <span className="text-sm text-gray-600">Slow Queries</span>
          <span className="font-semibold text-red-600">{metrics.slowQueries}</span>
        </div>
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
          <span className="text-sm text-gray-600">Tenant Schemas</span>
          <span className="font-semibold text-blue-600">{metrics.tenantSchemas}</span>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// API Metrics Component
// ==============================================

function APIMetrics({ metrics }: { metrics?: APIMetrics }) {
  if (!metrics) return <div className="bg-white rounded-lg shadow p-6">Loading API metrics...</div>;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">API Performance</h2>
        <Globe className="w-5 h-5 text-emerald-600" />
      </div>
      
      <div className="space-y-3">
        <div className="text-center p-3 bg-emerald-50 rounded-lg">
          <div className="text-2xl font-bold text-emerald-600">{metrics.requestsPerMinute}</div>
          <div className="text-sm text-gray-600">Requests/min</div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="text-lg font-bold">{metrics.averageResponseTime}ms</div>
            <div className="text-xs text-gray-600">Avg Response</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="text-lg font-bold text-red-600">{(metrics.errorRate * 100).toFixed(1)}%</div>
            <div className="text-xs text-gray-600">Error Rate</div>
          </div>
        </div>

        {/* Top Endpoints */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Endpoints</h3>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {metrics.topEndpoints?.slice(0, 3).map((endpoint, index) => (
              <div key={index} className="flex justify-between items-center text-xs p-2 bg-gray-50 rounded">
                <span className="font-mono truncate">{endpoint.path}</span>
                <div className="flex items-center space-x-2">
                  <span>{endpoint.count}</span>
                  <span className="text-gray-500">{endpoint.avgTime}ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// Error Tracking Component
// ==============================================

function ErrorTracking({ errors }: { errors?: ErrorMetrics }) {
  if (!errors) return <div className="bg-white rounded-lg shadow p-6">Loading error metrics...</div>;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Error Tracking</h2>
        <AlertTriangle className="w-5 h-5 text-red-600" />
      </div>
      
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="text-center p-4 bg-red-50 rounded-lg">
          <div className="text-2xl font-bold text-red-600">{errors.totalToday}</div>
          <div className="text-sm text-gray-600">Total Today</div>
        </div>
        <div className="text-center p-4 bg-yellow-50 rounded-lg">
          <div className="text-2xl font-bold text-yellow-600">{errors.criticalToday}</div>
          <div className="text-sm text-gray-600">Critical</div>
        </div>
        <div className="text-center p-4 bg-gray-50 rounded-lg">
          <div className="text-2xl font-bold text-gray-900">{(errors.errorRate * 100).toFixed(2)}%</div>
          <div className="text-sm text-gray-600">Error Rate</div>
        </div>
      </div>

      {/* Error Trend Chart */}
      {errors.errorTrend && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Error Trend</h3>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={errors.errorTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top Errors */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Errors</h3>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {errors.topErrors?.slice(0, 5).map((error, index) => (
            <div key={index} className="p-2 bg-gray-50 rounded">
              <div className="flex justify-between items-start">
                <span className="text-sm font-medium text-red-600 truncate">{error.message}</span>
                <span className="text-xs text-gray-500 ml-2">{error.count}x</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">Last: {error.lastSeen}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==============================================
// Beta User Activity Component
// ==============================================

function BetaUserActivity({ users }: { users?: BetaUserMetrics }) {
  if (!users) return <div className="bg-white rounded-lg shadow p-6">Loading beta user metrics...</div>;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Beta Users</h2>
        <Shield className="w-5 h-5 text-purple-600" />
      </div>
      
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">{users.totalUsers}/5</div>
            <div className="text-sm text-gray-600">Total Users</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{users.activeToday}</div>
            <div className="text-sm text-gray-600">Active Today</div>
          </div>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-lg font-bold text-gray-900">{users.onboardingCompletionRate}%</div>
          <div className="text-sm text-gray-600">Completion Rate</div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent Signups</h3>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {users.recentSignups?.slice(0, 3).map((signup, index) => (
              <div key={index} className="p-2 bg-gray-50 rounded">
                <div className="font-medium text-sm">{signup.company}</div>
                <div className="text-xs text-gray-600">{signup.industry}</div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs text-gray-500">{signup.timestamp}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    signup.status === 'completed' ? 'bg-green-100 text-green-800' :
                    signup.status === 'in-progress' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {signup.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// Recent Events Component
// ==============================================

function RecentEvents({ events }: { events: Event[] }) {
  const getEventIcon = (type: string) => {
    switch (type) {
      case 'success': return CheckCircle;
      case 'warning': return AlertTriangle;
      case 'error': return XCircle;
      default: return Activity;
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'success': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      default: return 'text-blue-600';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Recent Events</h2>
        <Eye className="w-5 h-5 text-gray-600" />
      </div>
      
      <div className="space-y-3 max-h-80 overflow-y-auto">
        {events.slice(0, 10).map((event) => {
          const Icon = getEventIcon(event.type);
          const colorClass = getEventColor(event.type);
          
          return (
            <div key={event.id} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <Icon className={`w-5 h-5 mt-0.5 ${colorClass}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{event.message}</p>
                <p className="text-xs text-gray-500 mt-1">{event.timestamp}</p>
                {event.details && (
                  <pre className="text-xs text-gray-600 mt-2 bg-gray-100 p-2 rounded overflow-x-auto">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
        
        {events.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No recent events</p>
          </div>
        )}
      </div>
    </div>
  );
}