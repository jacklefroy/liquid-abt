// LIQUID ABT - Jest Setup for DOM Testing

import '@testing-library/jest-dom'

// Mock Next.js router
jest.mock('next/router', () => ({
  useRouter: () => ({
    route: '/',
    pathname: '/',
    query: {},
    asPath: '/',
    push: jest.fn(),
    pop: jest.fn(),
    reload: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
    beforePopState: jest.fn(),
    events: {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    },
  }),
}))

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))

// Global test utilities
global.console = {
  ...console,
  // Suppress console logs in tests unless explicitly needed
  log: process.env.NODE_ENV === 'test' ? jest.fn() : console.log,
  warn: process.env.NODE_ENV === 'test' ? jest.fn() : console.warn,
  error: process.env.NODE_ENV === 'test' ? jest.fn() : console.error,
}

// Mock environment variables for tests (use environment variables or defaults)
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test_user:test_pass@localhost:5432/liquid_abt_test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret'
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key'
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret'