/**
 * Unit tests for the Redis-mirrored burner seed store in burnerWalletService.js.
 * Covers the branch taken when REDIS_URL is set: seeds are mirrored on create
 * and recoverable from Redis by another node when the in-memory copy is gone.
 */

jest.mock('../redisClient');

const { isRedisConfigured, set, get } = require('../redisClient');
const service = require('../burnerWalletService');

const ORIG_REDIS_URL = process.env.REDIS_URL;

// Enable Redis mode and stub the store helpers so no network is touched.
beforeEach(() => {
  jest.clearAllMocks();
  if (ORIG_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIG_REDIS_URL;
  process.env.REDIS_URL = 'rediss://default:secret@host.render.com:6379';
  isRedisConfigured.mockReturnValue(true);
  set.mockResolvedValue('OK');
  // Reset the singleton's in-memory seed map between tests.
  service.seeds.clear();
});

afterAll(() => {
  if (ORIG_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIG_REDIS_URL;
});

test('mirrors a burner seed to Redis with the TTL when configured', () => {
  service._rememberSeed('rNewAddr', 'secret-seed');
  const key = set.mock.calls[0][0];
  expect(key).toBe('burner:seed:rNewAddr');
  expect(typeof set.mock.calls[0][1]).toBe('string');
  expect(set.mock.calls[0][2]).toBeGreaterThan(0);
});

test('decrypts and restores a seed mirrored to Redis when memory is empty', async () => {
  service._rememberSeed('rRemoteAddr', 'secret-seed');
  const mirrored = set.mock.calls[0][1];
  service.seeds.delete('rRemoteAddr'); // simulate being on a node that didn't create it

  get.mockResolvedValue(mirrored);
  const recovered = await service._seedFromRedis('rRemoteAddr');

  expect(recovered).toBe('secret-seed');
  // Restored back into memory for the current node too.
  expect(service._seedFor('rRemoteAddr')).toBe('secret-seed');
});

test('_seedFromRedis returns null when Redis has no record', async () => {
  service.seeds.clear();
  get.mockResolvedValue(null);
  expect(await service._seedFromRedis('rUnknown')).toBeNull();
});

test('_seedFromRedis returns null when the stored record is corrupt', async () => {
  service.seeds.clear();
  get.mockResolvedValue('not-json-{}');
  expect(await service._seedFromRedis('rBroken')).toBeNull();
});