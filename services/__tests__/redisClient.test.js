/**
 * Unit tests for services/redisClient.js — the single Redis touchpoint.
 * Covers both code paths:
 *   - fallback (no REDIS_URL): in-memory Map store + local pub/sub bus
 *   - redis (REDIS_URL set): behavior delegated to a mocked ioredis client
 */

jest.mock('ioredis', () => {
  class MockRedis {
    constructor() {
      MockRedis.__instances.push(this);
      this.store = new Map();
       this.connect = jest.fn().mockImplementation(async () => {
         if (MockRedis.__connectError) throw new Error('connect failed');
         return 'OK';
       });
      this.disconnect = jest.fn();
      this.on = jest.fn();
      this.set = jest.fn(async (key, value) => {
        this.store.set(key, String(value));
        return 'OK';
      });
      this.get = jest.fn(async (key) => this.store.get(key) ?? null);
      this.del = jest.fn().mockResolvedValue(1);
      this.publish = jest.fn().mockResolvedValue(1);
      this.subscribe = jest.fn().mockResolvedValue('OK');
      this.unsubscribe = jest.fn().mockResolvedValue(0);
    }
    multi() {
      const self = this;
      return {
        incr(key) { self.__incrKey = key; return this; },
        pexpire(key, ms) { self.__pxKey = key; self.__pxMs = ms; return this; },
        exec: jest.fn(async () => {
          const cur = parseInt(self.store.get(self.__incrKey) || '0', 10) + 1;
          self.store.set(self.__incrKey, String(cur));
          return [[null, cur]];
        })
      };
    }
  }
  MockRedis.__instances = [];
  return MockRedis;
});

const ORIG_REDIS_URL = process.env.REDIS_URL;

afterAll(() => {
  if (ORIG_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIG_REDIS_URL;
});

describe('redisClient — fallback mode (no REDIS_URL)', () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    jest.resetModules();
  });

  test('isRedisConfigured() is false without REDIS_URL', () => {
    const { isRedisConfigured } = require('../redisClient');
    expect(isRedisConfigured()).toBe(false);
  });

  test('set/get/del round-trip and TTL expiry', async () => {
    const r = require('../redisClient');
    await r.set('k', 'v');
    expect(await r.get('k')).toBe('v');

    await r.set('expired', 'y', 5);
    expect(await r.get('expired')).toBe('y'); // within TTL
    await new Promise((res) => setTimeout(res, 20)); // let it lapse
    expect(await r.get('expired')).toBeNull();

    await r.del('k');
    expect(await r.get('k')).toBeNull();
  });

  test('incrWithTtl counts within a window and resets after expiry', async () => {
    const r = require('../redisClient');
    expect(await r.incrWithTtl('counter', 60000)).toBe(1);
    expect(await r.incrWithTtl('counter', 60000)).toBe(2);
    expect(await r.incrWithTtl('counter', 60000)).toBe(3);

    expect(await r.incrWithTtl('expiring', 5)).toBe(1);
    await new Promise((res) => setTimeout(res, 20)); // let the window lapse
    expect(await r.incrWithTtl('expiring', 5)).toBe(1);
  });

  test('publish delivers to local subscribers and unsubscribe stops delivery', async () => {
    const r = require('../redisClient');
    const seen = [];
    const unsub = await r.subscribe('chan', (m) => seen.push(m));

    await r.publish('chan', 'hello');
    await r.publish('chan', 'world');
    expect(seen).toEqual(['hello', 'world']);

    unsub();
    await r.publish('chan', 'ignored');
    expect(seen).toEqual(['hello', 'world']);
  });

  test('continues publishing when a local subscriber throws', async () => {
    const r = require('../redisClient');
    const healthy = jest.fn();
    await r.subscribe('errors', () => { throw new Error('subscriber failed'); });
    await r.subscribe('errors', healthy);

    await expect(r.publish('errors', 'payload')).resolves.toBe(1);
    expect(healthy).toHaveBeenCalledWith('payload');
  });
});

describe('redisClient — redis mode (REDIS_URL set)', () => {
  beforeEach(() => {
    process.env.REDIS_URL = 'rediss://default:secret@host.render.com:6379';
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  test('isRedisConfigured() is true with REDIS_URL', () => {
    const { isRedisConfigured } = require('../redisClient');
    expect(isRedisConfigured()).toBe(true);
  });

  test('set with TTL delegates to the ioredis client', async () => {
    const r = require('../redisClient');
    const Redis = require('ioredis');
    await r.set('k', 'v', 5000);

    const client = Redis.__instances[0];
    expect(client.connect).toHaveBeenCalled();
    expect(client.set).toHaveBeenCalledWith('k', 'v', 'PX', 5000);
  });

  test('get/set round-trips through the ioredis store', async () => {
    const r = require('../redisClient');
    await r.set('k', 'v');
    expect(await r.get('k')).toBe('v');
  });

  test('del delegates to the ioredis client', async () => {
    const r = require('../redisClient');
    const Redis = require('ioredis');
    await r.del('k');
    expect(Redis.__instances[0].del).toHaveBeenCalledWith('k');
  });

  test('incrWithTtl uses an atomic multi and returns sequential counts', async () => {
    const r = require('../redisClient');
    expect(await r.incrWithTtl('rl:x', 60000)).toBe(1);
    expect(await r.incrWithTtl('rl:x', 60000)).toBe(2);
  });

  test('publish delegates to the ioredis client', async () => {
    const r = require('../redisClient');
    const Redis = require('ioredis');
    await r.publish('chan', 'payload');
    expect(Redis.__instances[0].publish).toHaveBeenCalledWith('chan', 'payload');
  });

  test('subscribe opens a subscriber connection and subscribes the channel', async () => {
    const r = require('../redisClient');
    const Redis = require('ioredis');

    const unsub = await r.subscribe('chan', () => {});

    // client + subscriber connections exist
    expect(Redis.__instances.length).toBe(2);
    const subscriber = Redis.__instances[1];
    expect(subscriber.subscribe).toHaveBeenCalledWith('chan');
    expect(typeof unsub).toBe('function');
  });

  test('handles missing Redis values and supports duplicate/quit lifecycle', async () => {
    const r = require('../redisClient');
    const Redis = require('ioredis');

    expect(await r.get('missing')).toBeNull();
    const first = await r.subscribe('same', () => {});
    const second = await r.subscribe('same', () => {});
    expect(typeof first).toBe('function');
    expect(typeof second).toBe('function');

    expect(() => r.duplicate()).not.toThrow();
    await r.quit();
    expect(Redis.__instances[0].disconnect).toHaveBeenCalled();
  });

  test('falls back when Redis connection fails and logs client errors', async () => {
    const r = require('../redisClient');
    const Redis = require('ioredis');
    Redis.__connectError = true;

    await expect(r.set('fallback', 'value')).resolves.toBe('OK');
    const client = Redis.__instances[0];
    const errorHandler = client.on.mock.calls.find(([event]) => event === 'error')[1];
    errorHandler(new Error('socket error'));
    expect(await r.get('fallback')).toBe('value');
    Redis.__connectError = false;
  });

  test('delivers subscriber messages and contains subscriber handler failures', async () => {
    const r = require('../redisClient');
    const Redis = require('ioredis');
    const handler = jest.fn(() => { throw new Error('handler failed'); });
    await r.subscribe('messages', handler);

    const subscriber = Redis.__instances[1];
    const messageHandler = subscriber.on.mock.calls.find(([event]) => event === 'message')[1];
    messageHandler('messages', 'payload');

    expect(handler).toHaveBeenCalledWith('payload');
  });

  test('duplicate rejects when Redis is not configured', () => {
    delete process.env.REDIS_URL;
    jest.resetModules();
    const r = require('../redisClient');

    expect(() => r.duplicate()).toThrow('REDIS_URL not configured');
  });
});
