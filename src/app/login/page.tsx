'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Bitcoin, Shield, TrendingUp } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Mock authentication - accept any credentials
      const response = await fetch('/api/auth/mock-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = await response.json();
        
        // Store the mock JWT token
        localStorage.setItem('token', data.token);
        console.log('Token saved to localStorage:', data.token);
        console.log('Verification - localStorage.getItem("token"):', localStorage.getItem('token'));
        
        // Also save user info if needed
        if (data.user) {
          localStorage.setItem('user', JSON.stringify(data.user));
        }
        
        // Redirect to dashboard
        router.push('/dashboard');
      } else {
        throw new Error('Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-orange-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        
        {/* Logo and Title */}
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-orange-500 rounded-full p-3">
              <Bitcoin className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">LIQUID ABT</h1>
          <p className="mt-2 text-gray-300">Automated Bitcoin Treasury</p>
          <p className="text-sm text-orange-400 mt-1">Demo Mode - Any credentials will work</p>
        </div>

        {/* Login Form */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="demo@company.com"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="demo123"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full flex justify-center items-center px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </>
              )}
            </button>
            
            {/* Debug button for testing */}
            <button
              type="button"
              onClick={() => {
                const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjp7ImlkIjoidXNlcl90ZXN0XzEyMyIsImVtYWlsIjoiZGVtb0Bjb21wYW55LmNvbSIsImZpcnN0TmFtZSI6IkRlbW8iLCJsYXN0TmFtZSI6IlVzZXIiLCJyb2xlIjoib3duZXIiLCJ0ZW5hbnRJZCI6InRlbmFudF90ZXN0XzEyMyJ9LCJ0ZW5hbnRJZCI6InRlbmFudF90ZXN0XzEyMyIsInRlbmFudCI6eyJpZCI6InRlbmFudF90ZXN0XzEyMyIsImNvbXBhbnlOYW1lIjoiRGVtbyBDb21wYW55IEx0ZCIsInN1YnNjcmlwdGlvblRpZXIiOiJwcm8iLCJzY2hlbWFOYW1lIjoidGVuYW50X3Rlc3QifSwiaWF0IjoxNzU3MjkzMzc1LCJleHAiOjE3NTczMjE0MDF9.ENiRQKA8K0bieJiw1dUKFtnxyqRiBOrkVL5YWSyo0MI';
                localStorage.setItem('token', testToken);
                alert('Test token set! Check localStorage.getItem("token") in console, then try the dashboard.');
              }}
              className="w-full mt-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
            >
              🔧 Set Test Token (Debug)
            </button>
          </form>
        </div>

        {/* Features Preview */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <Shield className="h-6 w-6 text-green-400 mx-auto mb-2" />
            <p className="text-xs text-gray-300">Transaction Recovery</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <TrendingUp className="h-6 w-6 text-blue-400 mx-auto mb-2" />
            <p className="text-xs text-gray-300">Reconciliation Status</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <Bitcoin className="h-6 w-6 text-orange-400 mx-auto mb-2" />
            <p className="text-xs text-gray-300">Portfolio Tracking</p>
          </div>
        </div>

        {/* Demo Instructions */}
        <div className="bg-blue-900/20 border border-blue-600 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-400 mb-2">Demo Instructions</h3>
          <div className="text-xs text-blue-300 space-y-1">
            <p>• Use any email and password to login</p>
            <p>• Test data includes mock transactions and issues</p>
            <p>• All safety systems are functional for testing</p>
          </div>
        </div>

      </div>
    </div>
  );
}