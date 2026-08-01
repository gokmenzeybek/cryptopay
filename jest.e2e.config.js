module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns - only run e2e tests
  testMatch: [
    '<rootDir>/tests/e2e/**/*.test.js'
  ],
  
  // Custom setup files specifically for E2E tests
  setupFilesAfterEnv: [
    '<rootDir>/tests/e2e/setup.js'
  ],
  
  // Test timeout (generous for network/database transactions)
  testTimeout: 30000,

  // Transform ESM-only dependencies in node_modules
  transformIgnorePatterns: [
    '/node_modules/(?!.*(?:@noble/|@scure/))'
  ],

  // Pin core crypto to the real Node implementation (jest may resolve a shim)
  moduleNameMapper: {
    '^crypto$': '<rootDir>/tests/shims/nodeCrypto.js'
  },
  
  // Verbose output
  verbose: true,
  
  // Clear and reset mocks between tests
  clearMocks: true,
  resetModules: true,

  // Run tests sequentially to avoid database race conditions
  maxWorkers: 1
};
