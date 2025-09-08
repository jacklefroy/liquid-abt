'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  
  useEffect(() => {
    // Redirect to login page on mount
    router.push('/login');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">LIQUID ABT</h1>
        <p className="text-gray-600">Bitcoin Treasury Platform</p>
        <p className="text-sm text-gray-500 mt-2">Redirecting to login...</p>
      </div>
    </div>
  );
}
