/**
 * Unit tests for database/connection.js
 *
 * Verifies the pool honors environment configuration and that idle-client
 * errors are logged (not fatal).
 */

// Capture process.exit calls and suppress them during the test.
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

const mockLoggerError = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock('../../utils/logger', () => ({
  error: (...args) => mockLoggerError(...args),
  info: (...args) => mockLoggerInfo(...args)
}));

const mockPoolInstances = [];

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(function MockPool(config) {
    const { EventEmitter } = require('events');
    const pool = new EventEmitter();
    pool.config = config;
    pool.connect = jest.fn();
    pool.end = jest.fn();
    mockPoolInstances.push(pool);
    return pool;
  })
}));

const setEnv = (vars) => {
  Object.keys(vars).forEach((key) => {
    process.env[key] = vars[key];
  });
};

const clearEnv = (keys) => {
  keys.forEach((key) => {
    delete process.env[key];
  });
};

describe('database/connection', () => {
  beforeEach(() => {
    jest.resetModules();
    mockPoolInstances.length = 0;
    mockExit.mockClear();
    mockLoggerError.mockClear();
    mockLoggerInfo.mockClear();
  });

  afterAll(() => {
    mockExit.mockRestore();
  });

  describe('pool configuration', () => {
    it('uses environment variables when provided', () => {
      setEnv({
        DB_POOL_MAX: '50',
        DB_POOL_MIN: '5',
        DB_IDLE_TIMEOUT_MS: '60000',
        DB_CONNECTION_TIMEOUT_MS: '5000'
      });

      require('../connection');

      const pool = mockPoolInstances[0];
      expect(pool.config).toMatchObject({
        max: 50,
        min: 5,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 5000
      });

      clearEnv(['DB_POOL_MAX', 'DB_POOL_MIN', 'DB_IDLE_TIMEOUT_MS', 'DB_CONNECTION_TIMEOUT_MS']);
    });

    it('falls back to sensible defaults when env vars are absent', () => {
      clearEnv(['DB_POOL_MAX', 'DB_POOL_MIN', 'DB_IDLE_TIMEOUT_MS', 'DB_CONNECTION_TIMEOUT_MS']);

      require('../connection');

      const pool = mockPoolInstances[0];
      expect(pool.config).toMatchObject({
        max: 20,
        min: 0,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
      });
    });
  });

  describe('pool error handling', () => {
    it('logs idle client errors through Winston and does not exit', () => {
      require('../connection');

      const pool = mockPoolInstances[0];
      const err = new Error('Connection terminated unexpectedly');

      pool.emit('error', err);

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unexpected error on idle database client',
        expect.objectContaining({
          error: err.message,
          stack: err.stack
        })
      );
      expect(mockExit).not.toHaveBeenCalled();
    });
  });
});
