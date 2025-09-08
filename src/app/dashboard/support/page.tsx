'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, RefreshCw, MessageCircle } from 'lucide-react';
import Link from 'next/link';

interface TransactionIssue {
  id: string;
  type: 'failed_bitcoin_purchase' | 'orphaned_payment' | 'amount_mismatch' | 'withdrawal_failed';
  status: 'investigating' | 'resolving' | 'resolved' | 'escalated';
  stripePaymentId?: string;
  bitcoinPurchaseId?: string;
  amount: string;
  currency: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  estimatedResolution: string;
  supportTicketId?: string;
}

interface SupportTicket {
  id: string;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  lastUpdate: string;
  response?: string;
}

export default function SupportPage() {
  const [issues, setIssues] = useState<TransactionIssue[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Support ticket form
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketType, setTicketType] = useState('transaction_issue');

  useEffect(() => {
    fetchIssuesAndTickets();
  }, []);

  const fetchIssuesAndTickets = async () => {
    try {
      const token = localStorage.getItem('jwt_token');
      
      const [issuesResponse, ticketsResponse] = await Promise.all([
        fetch('/api/support/transaction-issues', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/support/tickets', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (issuesResponse.ok) {
        const issuesData = await issuesResponse.json();
        setIssues(issuesData.issues || []);
      }

      if (ticketsResponse.ok) {
        const ticketsData = await ticketsResponse.json();
        setTickets(ticketsData.tickets || []);
      }
    } catch (error) {
      console.error('Failed to fetch support data:', error);
    } finally {
      setLoading(false);
    }
  };

  const submitSupportTicket = async () => {
    if (!ticketSubject.trim() || !ticketDescription.trim()) {
      alert('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    
    try {
      const token = localStorage.getItem('jwt_token');
      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject: ticketSubject,
          description: ticketDescription,
          type: ticketType,
          priority: ticketType === 'transaction_issue' ? 'high' : 'medium'
        })
      });

      if (response.ok) {
        setTicketSubject('');
        setTicketDescription('');
        setTicketType('transaction_issue');
        await fetchIssuesAndTickets(); // Refresh data
        alert('Support ticket submitted successfully. We will respond within 2 hours for transaction issues.');
      } else {
        throw new Error('Failed to submit ticket');
      }
    } catch (error) {
      console.error('Failed to submit ticket:', error);
      alert('Failed to submit support ticket. Please try again or contact us directly.');
    } finally {
      setSubmitting(false);
    }
  };

  const triggerReconciliation = async () => {
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
        alert('Reconciliation process triggered. This will check for any stuck transactions and attempt recovery.');
        await fetchIssuesAndTickets();
      } else {
        throw new Error('Failed to trigger reconciliation');
      }
    } catch (error) {
      console.error('Failed to trigger reconciliation:', error);
      alert('Failed to trigger reconciliation. Please contact support.');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved': return 'text-green-400';
      case 'investigating': return 'text-yellow-400';
      case 'resolving': return 'text-blue-400';
      case 'escalated': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getTypeDescription = (type: string) => {
    switch (type) {
      case 'failed_bitcoin_purchase': return 'Bitcoin purchase failed after successful payment';
      case 'orphaned_payment': return 'Payment received but no Bitcoin purchase created';
      case 'amount_mismatch': return 'Payment amount doesn\'t match Bitcoin purchase';
      case 'withdrawal_failed': return 'Bitcoin withdrawal to your wallet failed';
      default: return type;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-400" />
            <span className="ml-3 text-lg text-white">Loading support information...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link 
              href="/dashboard" 
              className="flex items-center text-blue-400 hover:text-blue-300 transition-colors"
            >
              <ArrowLeft className="h-5 w-5 mr-2" />
              Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold text-white">Support & Transaction Issues</h1>
          </div>
          
          <button
            onClick={triggerReconciliation}
            className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Check for Issues
          </button>
        </div>

        {/* Critical Issues Alert */}
        {issues.length > 0 && (
          <div className="bg-red-900/30 border border-red-600 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <AlertTriangle className="h-6 w-6 text-red-400 mr-3" />
              <h2 className="text-xl font-semibold text-white">Transaction Issues Detected</h2>
            </div>
            <p className="text-red-200 mb-4">
              We've detected {issues.length} issue(s) with your transactions. Our team is actively working to resolve them.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Transaction Issues */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Transaction Issues</h2>
            
            {issues.length === 0 ? (
              <div className="bg-gray-800 rounded-lg p-8 text-center">
                <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">All Clear!</h3>
                <p className="text-gray-400">No transaction issues detected. All your payments and Bitcoin purchases are processing normally.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {issues.map((issue) => (
                  <div key={issue.id} className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-medium text-white">{getTypeDescription(issue.type)}</h3>
                        <p className="text-sm text-gray-400">Issue #{issue.id}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(issue.status)}`}>
                        {issue.status.toUpperCase()}
                      </span>
                    </div>
                    
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Amount:</span>
                        <span className="text-white font-medium">{issue.amount} {issue.currency}</span>
                      </div>
                      {issue.stripePaymentId && (
                        <div className="flex justify-between">
                          <span className="text-gray-400">Payment ID:</span>
                          <span className="text-white font-mono text-xs">{issue.stripePaymentId}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-400">Estimated Resolution:</span>
                        <span className="text-white">{issue.estimatedResolution}</span>
                      </div>
                    </div>
                    
                    <div className="mt-4 p-3 bg-gray-700 rounded text-sm text-gray-300">
                      {issue.description}
                    </div>
                    
                    {issue.supportTicketId && (
                      <div className="mt-3 text-xs text-blue-400">
                        Support Ticket: #{issue.supportTicketId}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Support Tickets & Contact */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Support Center</h2>
            
            {/* Quick Help */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="text-lg font-medium text-white mb-4">Need Help?</h3>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-700 p-4 rounded-lg text-center">
                  <Clock className="h-8 w-8 text-blue-400 mx-auto mb-2" />
                  <div className="text-sm font-medium text-white">Response Time</div>
                  <div className="text-xs text-gray-400">< 2 hours</div>
                </div>
                <div className="bg-gray-700 p-4 rounded-lg text-center">
                  <MessageCircle className="h-8 w-8 text-green-400 mx-auto mb-2" />
                  <div className="text-sm font-medium text-white">Live Support</div>
                  <div className="text-xs text-gray-400">9 AM - 6 PM AEDT</div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Issue Type</label>
                  <select
                    value={ticketType}
                    onChange={(e) => setTicketType(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="transaction_issue">Transaction Issue</option>
                    <option value="bitcoin_purchase">Bitcoin Purchase Problem</option>
                    <option value="stripe_integration">Stripe Integration</option>
                    <option value="account_settings">Account Settings</option>
                    <option value="general_inquiry">General Inquiry</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-2">Subject</label>
                  <input
                    type="text"
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="Brief description of your issue"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-2">Description</label>
                  <textarea
                    value={ticketDescription}
                    onChange={(e) => setTicketDescription(e.target.value)}
                    placeholder="Please provide detailed information about your issue, including any transaction IDs or error messages"
                    rows={4}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <button
                  onClick={submitSupportTicket}
                  disabled={submitting || !ticketSubject.trim() || !ticketDescription.trim()}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Submitting...' : 'Submit Support Ticket'}
                </button>
              </div>
            </div>

            {/* Recent Tickets */}
            {tickets.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <h3 className="text-lg font-medium text-white mb-4">Your Recent Tickets</h3>
                <div className="space-y-3">
                  {tickets.map((ticket) => (
                    <div key={ticket.id} className="flex justify-between items-start p-3 bg-gray-700 rounded">
                      <div>
                        <div className="font-medium text-white">{ticket.subject}</div>
                        <div className="text-sm text-gray-400">#{ticket.id} • {ticket.lastUpdate}</div>
                        {ticket.response && (
                          <div className="text-sm text-blue-300 mt-1">Latest: {ticket.response}</div>
                        )}
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        ticket.status === 'resolved' ? 'bg-green-600 text-white' :
                        ticket.status === 'in_progress' ? 'bg-blue-600 text-white' :
                        'bg-yellow-600 text-white'
                      }`}>
                        {ticket.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Emergency Contact */}
        <div className="bg-red-900/20 border border-red-600 rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-2">Emergency Contact</h3>
          <p className="text-red-200 text-sm">
            For urgent issues involving missing funds or critical transaction failures, contact us immediately:
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            <a
              href="mailto:emergency@liquidtreasury.business"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              emergency@liquidtreasury.business
            </a>
            <span className="text-gray-500">|</span>
            <span className="text-white">+61 2 8123 4567 (24/7 Emergency Line)</span>
          </div>
        </div>

      </div>
    </div>
  );
}