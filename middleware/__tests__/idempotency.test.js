const { idempotencyMiddleware } = require('../idempotency');

jest.mock('../../services/redisClient', () => ({
  get: jest.fn(),
  set: jest.fn()
}));

const { get: redisGet, set: redisSet } = require('../../services/redisClient');

describe('idempotencyMiddleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      statusCode: 200
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  test('missing key with required:false calls next', async () => {
    const mw = idempotencyMiddleware({ required: false });
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('missing key with required:true returns 400', async () => {
    const mw = idempotencyMiddleware({ required: true });
    await mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('invalid UUID returns 400', async () => {
    req.headers['idempotency-key'] = 'not-a-uuid';
    const mw = idempotencyMiddleware({ required: false });
    await mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('valid key, cache miss calls next and caches response', async () => {
    req.headers['idempotency-key'] = '550e8400-e29b-41d4-a716-446655440000';
    redisGet.mockResolvedValue(null);
    const mw = idempotencyMiddleware({ ttlSeconds: 3600, required: false });
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    // Simulate handler sending response
    res.statusCode = 200;
    await res.json({ success: true });
    expect(redisSet).toHaveBeenCalled();
  });

  test('valid key, cache hit returns cached response', async () => {
    req.headers['idempotency-key'] = '550e8400-e29b-41d4-a716-446655440000';
    redisGet.mockResolvedValue(JSON.stringify({ statusCode: 200, body: { success: true } }));
    const mw = idempotencyMiddleware({ ttlSeconds: 3600, required: false });
    await mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(next).not.toHaveBeenCalled();
  });

  test('Redis failure falls through to handler', async () => {
    req.headers['idempotency-key'] = '550e8400-e29b-41d4-a716-446655440000';
    redisGet.mockRejectedValue(new Error('Redis down'));
    const mw = idempotencyMiddleware({ ttlSeconds: 3600, required: false });
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
