// LIQUID ABT - Jest Configuration for Next.js

const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  // Test environment
  testEnvironment: 'jsdom',
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  
  // Module paths
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/../(.*)$': '<rootDir>/$1',
  },
  
  // Test patterns
  testMatch: [
    '<rootDir>/**/__tests__/**/*.test.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{test,spec}.{js,jsx,ts,tsx}'
  ],
  
  // Coverage settings
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/generated/**',
    '!src/**/types/**',
    '!src/**/node_modules/**',
    '!**/*.config.{js,ts}',
  ],
  
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 75,
      statements: 75,
    },
    // Critical modules need higher coverage
    'src/lib/treasury-engine/**': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    'src/lib/security/**': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    'src/lib/auth/**': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    'src/lib/compliance/**': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  
  // Test environments for different types of tests
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/__tests__/unit/**/*.test.{js,jsx,ts,tsx}'],
      testEnvironment: 'node',
      preset: 'ts-jest',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.common.js'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@/../(.*)$': '<rootDir>/$1',
      },
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/src/**/__tests__/integration/**/*.test.{js,jsx,ts,tsx}'],
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.integration.js', '<rootDir>/jest.setup.common.js'],
      preset: 'ts-jest',
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@/../(.*)$': '<rootDir>/$1',
      },
    },
    {
      displayName: 'security',
      testMatch: ['<rootDir>/__tests__/security/**/*.test.{js,jsx,ts,tsx}'],
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.security.js', '<rootDir>/jest.setup.common.js'],
      preset: 'ts-jest',
      testTimeout: 60000, // Security tests may need more time
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@/../(.*)$': '<rootDir>/$1',
      },
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/__tests__/e2e/**/*.test.{js,jsx,ts,tsx}'],
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.e2e.js', '<rootDir>/jest.setup.common.js'],
      preset: 'ts-jest',
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@/../(.*)$': '<rootDir>/$1',
      },
    },
    {
      displayName: 'components',
      testMatch: ['<rootDir>/src/components/**/__tests__/**/*.test.{js,jsx,ts,tsx}'],
      testEnvironment: 'jsdom',
      preset: 'ts-jest',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.common.js'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@/../(.*)$': '<rootDir>/$1',
      },
    },
  ],
  
  // Coverage reporting
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'html', 'lcov', 'json-summary'],
  
  // Performance settings
  maxWorkers: '50%',
  
  // Timeout settings
  testTimeout: 30000, // 30 seconds for integration tests
  
  // Module transformation
  preset: 'ts-jest',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  
  // Global setup/teardown for database operations
  globalSetup: '<rootDir>/jest.global-setup.js',
  globalTeardown: '<rootDir>/jest.global-teardown.js',
  
  // Verbose output for CI/CD
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)