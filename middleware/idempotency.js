const { get: redisGet, set: redisSet } = require('../services/redisClient');
const logger = require('../utils/logger');

/**
 * Idempotency middleware for state-transition endpoints.
 * Clients send `Idempotency-Key` header with a UUID v4.
 * If key was seen before, returns cached response instead of reprocessing.
 * @param {Object} options
 * @param {number} [options.ttlSeconds=3600]
 * @param {boolean} [options.required=false]
 */
function idempotencyMiddleware(options = {}) {
  const { ttlSeconds = 3600, required = false } = options;

  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];

    if (!key) {
      if (required) {
        return res.status(400).json({ success: false, error: 'Idempotency-Key header required' });
      }
      return next();
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(key)) {
      return res.status(400).json({ success: false, error: 'Invalid Idempotency-Key format — must be UUID v4' });
    }

    const cacheKey = `cryptopay:idempotency:${key}`;

    try {
      const cached = await redisGet(cacheKey);
      if (cached) {
        const response = JSON.parse(cached);
        return res.status(response.statusCode).json(response.body);
      }
    } catch (err) {
      logger.warn('Idempotency cache read failed', { error: err.message });
    }

    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          await redisSet(cacheKey, JSON.stringify({ statusCode: res.statusCode, body }), ttlSeconds * 1000);
        } catch (err) {
          logger.warn('Idempotency cache write failed', { error: err.message });
        }
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = { idempotencyMiddleware };
