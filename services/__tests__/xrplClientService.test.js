/**
 * Unit tests for xrplClientService (connection pool)
 */

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  logP2P: jest.fn()
}));

const mockInstances = [];
let failNextConnect = false;

function mockMakeClient() {
  const instance = {
    isConnected: jest.fn(() => true),
    connect: jest.fn().mockImplementation(() =>
      failNextConnect ? Promise.reject(new Error('net down')) : Promise.resolve()
    ),
    disconnect: jest.fn().mockResolvedValue(),
    on: jest.fn()
  };
  mockInstances.push(instance);
  return instance;
}

jest.mock('xrpl', () => ({
  Client: jest.fn(() => mockMakeClient())
}));

const xrplClientService = require('../xrplClientService');

describe('xrplClientService (pool)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstances.length = 0;
    failNextConnect = false;
    xrplClientService.resetClient();
  });

  describe('getClient', () => {
    test('returns a connected client', async () => {
      const client = await xrplClientService.getClient();
      expect(client).toBeDefined();
      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(client.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
      expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('returns a client from the pool', async () => {
      const client = await xrplClientService.getClient();
      expect(mockInstances.length).toBeGreaterThanOrEqual(1);
      expect(client.isConnected()).toBe(true);
    });

    test('creates new client when pool is empty', async () => {
      const first = await xrplClientService.getClient();
      const second = await xrplClientService.getClient();
      expect(first).toBeDefined();
      expect(second).toBeDefined();
    });

    test('propagates connect failures', async () => {
      failNextConnect = true;
      await expect(xrplClientService.getClient()).rejects.toThrow('net down');
    });

    test('recovers after connect failure', async () => {
      failNextConnect = true;
      await expect(xrplClientService.getClient()).rejects.toThrow('net down');

      failNextConnect = false;
      const ok = await xrplClientService.getClient();
      expect(ok).toBeDefined();
    });
  });

  describe('initPool', () => {
    test('initializes pool with multiple clients', async () => {
      await xrplClientService.initPool();
      expect(mockInstances.length).toBeGreaterThanOrEqual(1);
    });

    test('does not reinitialize if pool exists', async () => {
      await xrplClientService.initPool();
      const count = mockInstances.length;
      await xrplClientService.initPool();
      expect(mockInstances.length).toBe(count);
    });
  });

  describe('getPoolMetrics', () => {
    test('returns pool metrics', () => {
      const metrics = xrplClientService.getPoolMetrics();
      expect(metrics).toHaveProperty('poolSize');
      expect(metrics).toHaveProperty('available');
      expect(metrics).toHaveProperty('targetSize');
      expect(metrics).toHaveProperty('maxSize');
    });
  });

  describe('disconnectPool (disconnectClient)', () => {
    test('disconnects all pool clients', async () => {
      await xrplClientService.initPool();
      const count = mockInstances.length;
      expect(count).toBeGreaterThan(0);

      await xrplClientService.disconnectPool();

      mockInstances.forEach(instance => {
        expect(instance.disconnect).toHaveBeenCalled();
      });
    });

    test('is a no-op when no pool exists', async () => {
      await expect(xrplClientService.disconnectPool()).resolves.toBeUndefined();
    });
  });

  describe('warmUp', () => {
    test('swallows connection errors', async () => {
      failNextConnect = true;
      await expect(xrplClientService.warmUp()).resolves.toBeUndefined();
    });

    test('initializes the pool eagerly', async () => {
      await xrplClientService.warmUp();
      expect(mockInstances.length).toBeGreaterThanOrEqual(1);
    });
  });
});
