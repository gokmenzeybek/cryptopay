module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.(js|jsx|ts|tsx)',
    '**/*.(test|spec).(js|jsx|ts|tsx)'
  ],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    'services/**/*.js',
    'middleware/**/*.js',
    'server.js',
    '!src/index.js',
    '!**/node_modules/**',
    '!**/build/**',
    '!**/coverage/**'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Module aliases plus the real Node crypto implementation.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@services/(.*)$': '<rootDir>/services/$1',
    '^@middleware/(.*)$': '<rootDir>/middleware/$1',
    '^crypto$': '<rootDir>/tests/shims/nodeCrypto.js'
  },
  
  // Transform configuration
  transform: {
    '^.+\\.(mjs|js|jsx)$': 'babel-jest'
  },

  // Transform ESM-only dependencies in node_modules
  transformIgnorePatterns: [
    '/node_modules/(?!.*(?:@noble/|@scure/|@vercel/))'
  ],
  
  // Test timeout
  testTimeout: 10000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Reset modules between tests
  resetModules: true,

  // E2E suites boot a real server on :5002 and need a live Postgres;
  // they run with their own config: npx jest --config jest.e2e.config.js
  testPathIgnorePatterns: ['/node_modules/', 'tests/e2e/']
};
