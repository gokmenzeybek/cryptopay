/**
 * Unit tests for xrplClientService (shared, lazily-connected XRPL client)
 */

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  logP2P: jest.fn()
}));

// Instances created by the mocked xrpl.Client, so tests can assert on
// connect/disconnect/event-handler behavior.
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

describe('xrplClientService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstances.length = 0;
    failNextConnect = false;
    xrplClientService.resetClient();
  });

  afterEach(async () => {
    await xrplClientService.disconnectClient();
  });

  describe('getClient', () => {
    test('returns a connected client', async () => {
      const client = await xrplClientService.getClient();
      expect(client).toBeDefined();
      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(client.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
      expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('reuses the same client across calls', async () => {
      const first = await xrplClientService.getClient();
      const second = await xrplClientService.getClient();
      expect(second).toBe(first);
      expect(mockInstances).toHaveLength(1);
      expect(mockInstances[0].connect).toHaveBeenCalledTimes(1);
    });

    test('concurrent callers share a single connect handshake', async () => {
      const [a, b] = await Promise.all([
        xrplClientService.getClient(),
        xrplClientService.getClient()
      ]);
      expect(a).toBe(b);
      expect(mockInstances).toHaveLength(1);
    });

    test('reconnects with a fresh client after a disconnect event', async () => {
      const first = await xrplClientService.getClient();
      const disconnectedHandler = first.on.mock.calls.find(([event]) => event === 'disconnected')[1];
      disconnectedHandler();

      const second = await xrplClientService.getClient();
      expect(second).not.toBe(first);
      expect(mockInstances).toHaveLength(2);
    });

    test('reconnects with a fresh client after an error event', async () => {
      const first = await xrplClientService.getClient();
      const errorHandler = first.on.mock.calls.find(([event]) => event === 'error')[1];
      errorHandler(new Error('boom'));

      const second = await xrplClientService.getClient();
      expect(second).not.toBe(first);
      expect(mockInstances).toHaveLength(2);
    });

    test('propagates connect failures and recovers on the next call', async () => {
      failNextConnect = true;
      await expect(xrplClientService.getClient()).rejects.toThrow('net down');

      failNextConnect = false;
      const ok = await xrplClientService.getClient();
      expect(ok).toBeDefined();
      expect(mockInstances).toHaveLength(2);
    });
  });

  describe('disconnectClient', () => {
    test('disconnects and resets the shared client', async () => {
      const client = await xrplClientService.getClient();
      await xrplClientService.disconnectClient();
      expect(client.disconnect).toHaveBeenCalledTimes(1);

      const next = await xrplClientService.getClient();
      expect(next).not.toBe(client);
    });

    test('is a no-op when no client exists', async () => {
      await expect(xrplClientService.disconnectClient()).resolves.toBeUndefined();
    });
  });

  describe('warmUp', () => {
    test('swallows connection errors', async () => {
      failNextConnect = true;
      await expect(xrplClientService.warmUp()).resolves.toBeUndefined();
      failNextConnect = false;
    });

    test('establishes a connection eagerly', async () => {
      await xrplClientService.warmUp();
      expect(mockInstances).toHaveLength(1);
      expect(mockInstances[0].connect).toHaveBeenCalledTimes(1);
    });
  });
});
