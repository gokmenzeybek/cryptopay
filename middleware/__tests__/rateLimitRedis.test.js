/**
 * Unit tests for the Redis-backed rate limiter path in middleware/rateLimit.js.
 * Exercises the branch taken when REDIS_URL is set (isRedisConfigured => true),
 * with the Redis store mocked so no network is touched.
 */

const ORIG_REDIS_URL = process.env.REDIS_URL;

jest.mock('../../services/redisClient');

const { isRedisConfigured, incrWithTtl } = require('../../services/redisClient');
const { createRateLimiter, getRateLimitStats, resetClientRateLimit } = require('../rateLimit');

describe('rateLimit — Redis-backed path', () => {
  let mockReq, mockRes;

  beforeEach(() => {
    jest.clearAllMocks();
    if (ORIG_REDIS_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = ORIG_REDIS_URL;
    process.env.REDIS_URL = 'rediss://default:secret@host.render.com:6379';
    isRedisConfigured.mockReturnValue(true);
    resetClientRateLimit('');

    mockReq = {
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('Mozilla/5.0 Test Browser'),
      connection: { remoteAddress: '127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    mockRes = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  test('allows requests while under the limit', async () => {
    incrWithTtl.mockResolvedValue(2); // 2 of 60 used
    const rateLimiter = createRateLimiter('exchange-rates');
    const next = jest.fn();

    await rateLimiter(mockReq, mockRes, next);

    expect(incrWithTtl).toHaveBeenCalled();
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 58);
    expect(next).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  test('blocks requests that exceed the limit with 429', async () => {
    incrWithTtl.mockResolvedValue(11); // > max 10 for 'payment-intent'
    const rateLimiter = createRateLimiter('payment-intent');
    const next = jest.fn();

    await rateLimiter(mockReq, mockRes, next);

    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Rate limit exceeded',
      limit: 10
    }));
    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    expect(next).not.toHaveBeenCalled();
  });

  test('fails open when the Redis store errors', async () => {
    incrWithTtl.mockRejectedValue(new Error('connection refused'));
    const rateLimiter = createRateLimiter('exchange-rates');
    const next = jest.fn();

    await rateLimiter(mockReq, mockRes, next);

    expect(next).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});