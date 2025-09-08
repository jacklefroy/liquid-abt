'use client';

import { useState, useEffect } from 'react';

interface Transaction {
  id: string;
  type: 'payment' | 'bitcoin_purchase';
  // Payment fields
  amount?: string;
  currency?: string;
  stripePaymentId?: string;
  provider?: string;
  // Bitcoin purchase fields
  bitcoinAmount?: string;
  fiatAmount?: string;
  fiatCurrency?: string;
  exchangeRate?: string;
  fees?: string;
  transactionId?: string;
  // Common fields
  status: string;
  customerId?: string;
  createdAt: string;
  updatedAt: string;
  // Relations
  bitcoinPurchase?: {
    id: string;
    bitcoinAmount: string;
    fiatAmount: string;
    exchangeRate: string;
    status: string;
  };
  stripePayment?: {
    id: string;
    stripePaymentId: string;
    amount: string;
    currency: string;
    status: string;
  };
}

interface TransactionsResponse {
  success: boolean;
  transactions: Transaction[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  filters: {
    type: string;
    status: string;
    sortBy: string;
    sortOrder: string;
  };
}

export default function TransactionsPage() {
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    type: 'all',
    status: 'all',
    page: 1,
    limit: 25
  });

  useEffect(() => {
    fetchTransactions();
  }, [filters]);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('jwt_token');
      if (!token) {
        throw new Error('No authentication token');
      }

      const params = new URLSearchParams({
        page: filters.page.toString(),
        limit: filters.limit.toString(),
        type: filters.type,
        status: filters.status,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      const response = await fetch(`/api/dashboard/transactions?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key: string, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: key === 'page' ? value : 1 // Reset to page 1 when changing other filters
    }));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'succeeded':
      case 'completed':
        return 'bg-green-900 text-green-200';
      case 'pending':
      case 'processing':
        return 'bg-yellow-900 text-yellow-200';
      case 'failed':
      case 'error':
        return 'bg-red-900 text-red-200';
      default:
        return 'bg-gray-900 text-gray-200';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
          <p className="mt-4">Loading transactions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Transactions</h1>
        <p className="mt-2 text-gray-300">
          View your payment and Bitcoin purchase history
        </p>
      </div>

      {error && (
        <div className="bg-red-900 border border-red-700 text-red-100 px-6 py-4 rounded-lg">
          <h3 className="font-medium">Failed to load transactions</h3>
          <p className="mt-2 text-sm">{error}</p>
          <button
            onClick={fetchTransactions}
            className="mt-4 bg-red-800 hover:bg-red-700 px-4 py-2 rounded text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Filters */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h2 className="text-lg font-medium text-white mb-4">Filters</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Transaction Type
                </label>
                <select
                  value={filters.type}
                  onChange={(e) => handleFilterChange('type', e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="all">All Transactions</option>
                  <option value="payments">Payments Only</option>
                  <option value="purchases">Bitcoin Purchases Only</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="succeeded">Succeeded</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="failed">Failed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Per Page
                </label>
                <select
                  value={filters.limit}
                  onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value={10}>10 per page</option>
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                </select>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-gray-300">
                  Showing {data.transactions.length} of {data.pagination.totalCount.toLocaleString()} transactions
                </p>
              </div>
              <div className="text-sm text-gray-400">
                Page {data.pagination.page} of {data.pagination.totalPages}
              </div>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            {data.transactions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-700">
                    <tr>
                      <th className="text-left py-3 px-4 text-gray-300 font-medium">Date</th>
                      <th className="text-left py-3 px-4 text-gray-300 font-medium">Type</th>
                      <th className="text-right py-3 px-4 text-gray-300 font-medium">Amount</th>
                      <th className="text-right py-3 px-4 text-gray-300 font-medium">Bitcoin</th>
                      <th className="text-center py-3 px-4 text-gray-300 font-medium">Status</th>
                      <th className="text-left py-3 px-4 text-gray-300 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((transaction) => (
                      <tr key={transaction.id} className="border-b border-gray-700 hover:bg-gray-750">
                        <td className="py-3 px-4 text-white">
                          {formatDate(transaction.createdAt)}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 rounded text-xs ${
                            transaction.type === 'payment' 
                              ? 'bg-blue-900 text-blue-200'
                              : 'bg-orange-900 text-orange-200'
                          }`}>
                            {transaction.type === 'payment' ? 'Payment' : 'BTC Purchase'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-white">
                          {transaction.type === 'payment' ? (
                            <>
                              ${parseFloat(transaction.amount || '0').toLocaleString()} {transaction.currency}
                            </>
                          ) : (
                            <>
                              ${parseFloat(transaction.fiatAmount || '0').toLocaleString()} {transaction.fiatCurrency}
                            </>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-orange-400 font-mono">
                          {transaction.type === 'bitcoin_purchase' ? (
                            <>
                              {parseFloat(transaction.bitcoinAmount || '0').toFixed(6)} BTC
                            </>
                          ) : transaction.bitcoinPurchase ? (
                            <>
                              {parseFloat(transaction.bitcoinPurchase.bitcoinAmount).toFixed(6)} BTC
                            </>
                          ) : (
                            <span className="text-gray-500">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-1 rounded text-xs ${getStatusColor(transaction.status)}`}>
                            {transaction.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-400 text-sm">
                          {transaction.type === 'payment' ? (
                            <>
                              {transaction.provider} • {transaction.stripePaymentId?.substring(0, 12)}...
                            </>
                          ) : (
                            <>
                              Rate: ${parseFloat(transaction.exchangeRate || '0').toLocaleString()}
                              {transaction.fees && (
                                <> • Fees: ${parseFloat(transaction.fees).toFixed(2)}</>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-400">No transactions found</p>
                <p className="text-gray-500 text-sm mt-2">
                  Transactions will appear here once you start processing payments
                </p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between bg-gray-800 rounded-lg p-4 border border-gray-700">
              <button
                onClick={() => handleFilterChange('page', data.pagination.page - 1)}
                disabled={!data.pagination.hasPreviousPage || loading}
                className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md transition-colors"
              >
                Previous
              </button>

              <div className="flex space-x-2">
                {Array.from({ length: Math.min(5, data.pagination.totalPages) }, (_, i) => {
                  const page = Math.max(1, data.pagination.page - 2) + i;
                  if (page > data.pagination.totalPages) return null;
                  
                  return (
                    <button
                      key={page}
                      onClick={() => handleFilterChange('page', page)}
                      className={`px-3 py-2 rounded-md text-sm transition-colors ${
                        page === data.pagination.page
                          ? 'bg-orange-600 text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-white'
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => handleFilterChange('page', data.pagination.page + 1)}
                disabled={!data.pagination.hasNextPage || loading}
                className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}