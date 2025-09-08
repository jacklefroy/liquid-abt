// LIQUID ABT - Security Metrics Dashboard Component
// Real-time security monitoring interface for administrators

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { Shield, AlertTriangle, Activity, TrendingUp, TrendingDown, Minus, Eye, Settings, Download } from 'lucide-react';

interface SecurityDashboardProps {
  tenantId?: string;
  userRole: string;
}

interface SecurityMetric {
  id: string;
  metricType: string;
  value: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
  metadata?: Record<string, any>;
}

interface SecurityAlert {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'investigating' | 'resolved' | 'false_positive';
  timestamp: string;
  recommendations?: string[];
  affectedResources?: string[];
}

interface SecurityStats {
  totalActiveAlerts: number;
  criticalAlerts: number;
  highSeverityAlerts: number;
  resolvedToday: number;
  averageResolutionTime: number;
  topThreats: Array<{
    type: string;
    count: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  systemHealth: {
    authenticationHealth: number;
    apiHealth: number;
    exchangeHealth: number;
    complianceHealth: number;
  };
}

const SEVERITY_COLORS = {
  low: '#10B981', // Green
  medium: '#F59E0B', // Yellow
  high: '#EF4444', // Red
  critical: '#DC2626' // Dark Red
};

const METRIC_TYPE_LABELS = {
  failed_login_attempts: 'Failed Logins',
  rate_limit_violations: 'Rate Limit Violations',
  suspicious_transactions: 'Suspicious Transactions',
  price_manipulation_alerts: 'Price Alerts',
  csrf_token_violations: 'CSRF Violations',
  jwt_token_anomalies: 'Token Anomalies',
  tenant_isolation_breaches: 'Isolation Breaches',
  api_abuse_attempts: 'API Abuse',
  unauthorized_access_attempts: 'Unauthorized Access',
  exchange_health_degradation: 'Exchange Issues',
  compliance_threshold_breaches: 'Compliance Alerts',
  bitcoin_address_violations: 'Address Violations'
};

export default function SecurityDashboard({ tenantId, userRole }: SecurityDashboardProps) {
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [metrics, setMetrics] = useState<SecurityMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'1h' | '24h' | '7d' | '30d'>('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchSecurityData = useCallback(async () => {
    try {
      const [statsResponse, alertsResponse, metricsResponse] = await Promise.all([
        fetch('/api/security/dashboard/stats', {
          headers: tenantId ? { 'X-Tenant-ID': tenantId } : {}
        }),
        fetch('/api/security/alerts?limit=20', {
          headers: tenantId ? { 'X-Tenant-ID': tenantId } : {}
        }),
        fetch(`/api/security/metrics?timeframe=${selectedTimeframe}`, {
          headers: tenantId ? { 'X-Tenant-ID': tenantId } : {}
        })
      ]);

      if (!statsResponse.ok || !alertsResponse.ok || !metricsResponse.ok) {
        throw new Error('Failed to fetch security data');
      }

      const [statsData, alertsData, metricsData] = await Promise.all([
        statsResponse.json(),
        alertsResponse.json(),
        metricsResponse.json()
      ]);

      setStats(statsData);
      setAlerts(alertsData.alerts || []);
      setMetrics(metricsData.metrics || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching security data:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, selectedTimeframe]);

  useEffect(() => {
    fetchSecurityData();
  }, [fetchSecurityData]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchSecurityData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [autoRefresh, fetchSecurityData]);

  const updateAlertStatus = async (alertId: string, status: string) => {
    try {
      const response = await fetch(`/api/security/alerts/${alertId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'X-Tenant-ID': tenantId } : {})
        },
        body: JSON.stringify({ status })
      });

      if (!response.ok) {
        throw new Error('Failed to update alert status');
      }

      await fetchSecurityData(); // Refresh data
    } catch (err) {
      console.error('Error updating alert status:', err);
    }
  };

  const exportSecurityReport = async () => {
    try {
      const response = await fetch('/api/security/reports/export', {
        headers: tenantId ? { 'X-Tenant-ID': tenantId } : {}
      });

      if (!response.ok) {
        throw new Error('Failed to export security report');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `security-report-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting security report:', err);
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'high':
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case 'medium':
        return <Activity className="h-4 w-4 text-yellow-500" />;
      default:
        return <Shield className="h-4 w-4 text-green-500" />;
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-red-500" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-green-500" />;
      default:
        return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  const formatMetricsForChart = (metrics: SecurityMetric[]) => {
    const hourlyData: Record<string, Record<string, number>> = {};
    
    metrics.forEach(metric => {
      const hour = new Date(metric.timestamp).toISOString().slice(0, 13) + ':00';
      if (!hourlyData[hour]) {
        hourlyData[hour] = {};
      }
      hourlyData[hour][metric.metricType] = (hourlyData[hour][metric.metricType] || 0) + metric.value;
    });

    return Object.entries(hourlyData)
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([hour, data]) => ({
        time: new Date(hour).toLocaleTimeString('en-AU', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        ...data
      }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-800">
          Failed to load security dashboard: {error}
        </AlertDescription>
      </Alert>
    );
  }

  const chartData = formatMetricsForChart(metrics);
  const threatDistribution = stats?.topThreats.map(threat => ({
    name: METRIC_TYPE_LABELS[threat.type as keyof typeof METRIC_TYPE_LABELS] || threat.type,
    value: threat.count,
    color: SEVERITY_COLORS.medium
  })) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Security Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Real-time security monitoring and threat detection
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2 text-sm text-gray-500">
            <div className={`h-2 w-2 rounded-full ${autoRefresh ? 'bg-green-500' : 'bg-gray-400'}`}></div>
            <span>Auto-refresh {autoRefresh ? 'On' : 'Off'}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportSecurityReport}
          >
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Alerts</p>
                <p className="text-2xl font-bold text-orange-600">
                  {stats?.totalActiveAlerts || 0}
                </p>
              </div>
              <Shield className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Critical Alerts</p>
                <p className="text-2xl font-bold text-red-600">
                  {stats?.criticalAlerts || 0}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-yellow-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">High Severity</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {stats?.highSeverityAlerts || 0}
                </p>
              </div>
              <Activity className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Resolved Today</p>
                <p className="text-2xl font-bold text-green-600">
                  {stats?.resolvedToday || 0}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="alerts" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="alerts">Security Alerts</TabsTrigger>
          <TabsTrigger value="metrics">Security Metrics</TabsTrigger>
          <TabsTrigger value="threats">Threat Analysis</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
        </TabsList>

        {/* Security Alerts Tab */}
        <TabsContent value="alerts" className="space-y-4">
          <div className="grid gap-4">
            {alerts.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <Shield className="h-12 w-12 text-green-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900">All Clear</h3>
                  <p className="text-gray-600">No active security alerts at this time.</p>
                </CardContent>
              </Card>
            ) : (
              alerts.map((alert) => (
                <Card key={alert.id} className="border-l-4" style={{ borderLeftColor: SEVERITY_COLORS[alert.severity] }}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          {getSeverityIcon(alert.severity)}
                          <Badge variant="secondary" className="text-xs">
                            {alert.severity.toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {alert.status}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {new Date(alert.timestamp).toLocaleString('en-AU')}
                          </span>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-1">
                          {alert.title}
                        </h3>
                        <p className="text-gray-600 mb-3">
                          {alert.description}
                        </p>
                        {alert.recommendations && alert.recommendations.length > 0 && (
                          <div className="mb-3">
                            <p className="text-sm font-medium text-gray-700 mb-1">Recommendations:</p>
                            <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                              {alert.recommendations.map((rec, index) => (
                                <li key={index}>{rec}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {alert.affectedResources && alert.affectedResources.length > 0 && (
                          <div className="mb-3">
                            <p className="text-sm font-medium text-gray-700 mb-1">Affected Resources:</p>
                            <div className="flex flex-wrap gap-1">
                              {alert.affectedResources.map((resource, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {resource}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col space-y-2 ml-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateAlertStatus(alert.id, 'investigating')}
                          disabled={alert.status !== 'new'}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Investigate
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateAlertStatus(alert.id, 'resolved')}
                          disabled={alert.status === 'resolved'}
                        >
                          Mark Resolved
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Security Metrics Tab */}
        <TabsContent value="metrics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Metrics Over Time</CardTitle>
              <div className="flex items-center space-x-2">
                {(['1h', '24h', '7d', '30d'] as const).map((timeframe) => (
                  <Button
                    key={timeframe}
                    variant={selectedTimeframe === timeframe ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedTimeframe(timeframe)}
                  >
                    {timeframe}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="failed_login_attempts" stroke="#EF4444" name="Failed Logins" />
                  <Line type="monotone" dataKey="suspicious_transactions" stroke="#F59E0B" name="Suspicious Transactions" />
                  <Line type="monotone" dataKey="rate_limit_violations" stroke="#8B5CF6" name="Rate Limit Violations" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Threat Analysis Tab */}
        <TabsContent value="threats" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Security Threats</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats?.topThreats.map((threat, index) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center space-x-2">
                          {getTrendIcon(threat.trend)}
                          <span className="font-medium">
                            {METRIC_TYPE_LABELS[threat.type as keyof typeof METRIC_TYPE_LABELS] || threat.type}
                          </span>
                        </div>
                      </div>
                      <Badge variant="secondary">
                        {threat.count} events
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Threat Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {threatDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={threatDistribution}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {threatDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={SEVERITY_COLORS.medium} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    No threat data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* System Health Tab */}
        <TabsContent value="health" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats && Object.entries(stats.systemHealth).map(([key, value]) => (
              <Card key={key}>
                <CardContent className="p-4">
                  <div className="text-center">
                    <h3 className="text-sm font-medium text-gray-600 mb-2">
                      {key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}
                    </h3>
                    <div className={`text-3xl font-bold ${
                      value >= 95 ? 'text-green-600' :
                      value >= 80 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {value}%
                    </div>
                    <div className={`w-full h-2 rounded-full mt-3 ${
                      value >= 95 ? 'bg-green-200' :
                      value >= 80 ? 'bg-yellow-200' : 'bg-red-200'
                    }`}>
                      <div
                        className={`h-full rounded-full ${
                          value >= 95 ? 'bg-green-500' :
                          value >= 80 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}