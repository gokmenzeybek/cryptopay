/**
 * Rate Limiting Middleware
 * Prevents abuse of API endpoints
 */

const logger = require('../utils/logger');
const { isRedisConfigured, incrWithTtl } = require('../services/redisClient');

// In-memory store for rate limiting (fast path + fallback). When Redis is
// configured the counters live in Redis so they are shared across instances.
const requestCounts = new Map();

// Configuration
const WINDOW_MS = 60 * 1000; // 1 minute window
const DEFAULT_MAX_REQUESTS = 100;

/**
 * Rate limit configurations for different endpoint types
 */
const RATE_LIMITS = {
  'exchange-rates': { maxRequests: 60, windowMs: 60 * 1000 }, // 60 requests per minute
  'payment-intent': { maxRequests: 10, windowMs: 60 * 1000 }, // 10 requests per minute
  'conversion': { maxRequests: 20, windowMs: 60 * 1000 },     // 20 requests per minute
  'webhook': { maxRequests: 100, windowMs: 60 * 1000 },        // 100 requests per minute
  'default': { maxRequests: DEFAULT_MAX_REQUESTS, windowMs: WINDOW_MS }
};

/**
 * Get client identifier (IP address + user agent hash)
 */
function getClientId(req) {
  const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const userAgent = req.get('user-agent') || 'unknown';

  // Combine IP and user agent for more specific identification
  return `${ip}_${userAgent.substring(0, 50)}`;
}

/**
 * Clean up old entries
 */
function cleanupOldEntries() {
  const now = Date.now();

  for (const [key, data] of requestCounts.entries()) {
    if (now - data.windowStart > data.windowMs * 2) {
      requestCounts.delete(key);
    }
  }
}

// Run cleanup every 5 minutes. unref() so the interval never keeps the
// process (or a test runner) alive on its own.
setInterval(cleanupOldEntries, 5 * 60 * 1000).unref();

/**
 * Create rate limiter middleware. Dispatches to the Redis-backed path when
 * REDIS_URL is set (shared counters across instances); otherwise uses the
 * synchronous in-memory store so single-node behavior is unchanged.
 */
function createRateLimiter(type = 'default') {
  if (isRedisConfigured()) {
    return createRedisRateLimiter(type);
  }
  return createInMemoryRateLimiter(type);
}

/**
 * In-memory rate limiter (synchronous; the historical behavior). Keyed per
 * (type, client) with fixed-window semantics.
 */
function createInMemoryRateLimiter(type = 'default') {
  const config = RATE_LIMITS[type] || RATE_LIMITS.default;

  return function rateLimiter(req, res, next) {
    const clientId = getClientId(req);
    const key = `${type}_${clientId}`;
    const now = Date.now();

    // Get or create client record
    let clientData = requestCounts.get(key);

    if (!clientData) {
      // First request from this client
      clientData = {
        count: 1,
        windowStart: now,
        windowMs: config.windowMs
      };
      requestCounts.set(key, clientData);

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', config.maxRequests - 1);
      res.setHeader('X-RateLimit-Reset', new Date(now + config.windowMs).toISOString());

      return next();
    }

    // Check if window has expired
    const windowExpired = now - clientData.windowStart > config.windowMs;

    if (windowExpired) {
      // Reset window
      clientData.count = 1;
      clientData.windowStart = now;
      requestCounts.set(key, clientData);

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', config.maxRequests - 1);
      res.setHeader('X-RateLimit-Reset', new Date(now + config.windowMs).toISOString());

      return next();
    }

    // Window is still active, increment count
    clientData.count++;

    // Add rate limit headers
    const remaining = Math.max(0, config.maxRequests - clientData.count);
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', new Date(clientData.windowStart + config.windowMs).toISOString());

    // Check if limit exceeded
    if (clientData.count > config.maxRequests) {
      const retryAfter = Math.ceil((clientData.windowStart + config.windowMs - now) / 1000);

      res.setHeader('Retry-After', retryAfter);

      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfter: retryAfter,
        limit: config.maxRequests,
        windowMs: config.windowMs
      });
    }

    next();
  };
}

/**
 * Redis-backed rate limiter (asynchronous). Counters are shared across all
 * app instances via atomic INCR + anchored-window TTL, so traffic split across
 * nodes shares one budget. Stats/reset helpers below remain in-memory
 * (best-effort) — the authoritative state lives in Redis.
 */
function createRedisRateLimiter(type = 'default') {
  const config = RATE_LIMITS[type] || RATE_LIMITS.default;

  return async function rateLimiter(req, res, next) {
    const clientId = getClientId(req);
    const key = `rl:${type}_${clientId}`;
    const now = Date.now();

    try {
      const count = await incrWithTtl(key, config.windowMs);
      const remaining = Math.max(0, config.maxRequests - count);

      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', new Date(now + config.windowMs).toISOString());

      if (count > config.maxRequests) {
        const retryAfter = Math.ceil(config.windowMs / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: `Too many requests. Please try again in ${retryAfter} seconds.`,
          retryAfter: retryAfter,
          limit: config.maxRequests,
          windowMs: config.windowMs
        });
      }

      return next();
    } catch (err) {
      // Fail open: a rate-limit store hiccup must not block legitimate traffic.
      logger.warn('Rate limit store unavailable — allowing request', { error: err.message });
      return next();
    }
  };
}

/**
 * Get rate limit stats for monitoring
 */
function getRateLimitStats() {
  const stats = {
    totalClients: requestCounts.size,
    byType: {},
    topClients: []
  };

  // Group by type
  for (const [key, data] of requestCounts.entries()) {
    const type = key.split('_')[0];

    if (!stats.byType[type]) {
      stats.byType[type] = {
        clients: 0,
        totalRequests: 0
      };
    }

    stats.byType[type].clients++;
    stats.byType[type].totalRequests += data.count;
  }

  // Get top clients by request count
  const clientArray = Array.from(requestCounts.entries())
    .map(([key, data]) => ({
      key: key.substring(0, 50), // Truncate for privacy
      count: data.count,
      windowStart: new Date(data.windowStart).toISOString()
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  stats.topClients = clientArray;

  return stats;
}

/**
 * Reset rate limit for a client (admin function)
 */
function resetClientRateLimit(clientId) {
  let resetCount = 0;

  for (const [key, data] of requestCounts.entries()) {
    if (key.includes(clientId)) {
      requestCounts.delete(key);
      resetCount++;
    }
  }

  return resetCount;
}

/**
 * Export rate limiter types
 */
module.exports = {
  createRateLimiter,
  getRateLimitStats,
  resetClientRateLimit,
  RATE_LIMITS
};
