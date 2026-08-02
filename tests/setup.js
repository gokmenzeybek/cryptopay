/**
 * Jest Test Setup
 * Global test configuration and mocks
 */

require('@testing-library/jest-dom');

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.CRYPTOPAY_SKIP_LISTEN = 'true'; // supertest drives the app directly
process.env.RATE_CACHE_TTL_SECONDS = '300';
process.env.RATE_LIMIT_EXCHANGE_RATES = '60';
process.env.RATE_LIMIT_PAYMENT_INTENT = '10';
process.env.RATE_LIMIT_CONVERSION = '20';
// Explicit test-only secrets: production code no longer carries fallbacks
// (PRD Phase 1), so the harness provides deterministic values. Test files
// read `process.env.JWT_SECRET || ...`, so both signer and verifier agree.
process.env.JWT_SECRET = 'test_only_jwt_secret_not_for_production';
process.env.PAPARA_WEBHOOK_SECRET = 'test_only_webhook_secret_not_for_production';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// NOTE: axios is intentionally NOT mocked globally — service-level suites
// mock it themselves; integration tests need the real HTTP client.

// Mock XRPL library for frontend tests
global.window = {
  xrpl: {
    Client: jest.fn(),
    Wallet: {
      generate: jest.fn(),
      fromSeed: jest.fn()
    },
    xrpToDrops: jest.fn(),
    dropsToXrp: jest.fn(),
    convertStringToHex: jest.fn()
  },
  location: {
    hostname: 'localhost'
  }
};

// NOTE: React is intentionally NOT mocked — component and hook tests
// render real React via @testing-library/react.

// Mock the inline-notice store: the action object is mocked (components assert
// on it), while the instance helpers stay real so <InlineNotice/> renders.
jest.mock('../src/services/notice', () => ({
  ...jest.requireActual('../src/services/notice'),
  notice: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    clear: jest.fn()
  }
}));

// Mock fetch for API tests
global.fetch = jest.fn();

// Use the real crypto module (jsonwebtoken and auth flows need createHmac/createHash)

// Mock os module
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  networkInterfaces: jest.fn(() => ({
    eth0: [{ family: 'IPv4', address: '192.168.1.100', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }]
  }))
}));

// Global test utilities
global.testUtils = {
  createMockRequest: (overrides = {}) => ({
    body: {},
    params: {},
    query: {},
    ip: '127.0.0.1',
    get: jest.fn(),
    ...overrides
  }),
  
  createMockResponse: () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn().mockReturnValue(res);
    res.getHeader = jest.fn();
    return res;
  },
  
  createMockNext: () => jest.fn(),
  
  waitFor: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});