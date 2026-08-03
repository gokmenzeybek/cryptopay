/**
 * Redis Client Service
 *
 * Opt-in Redis integration driven by REDIS_URL (e.g. the Render Key Value
 * free tier). When REDIS_URL is set the app uses a real Redis for the three
 * cross-node concerns that previously pinned it to a single instance:
 *   - shared rate-limit counters,
 *   - WebSocket pub/sub broadcasts (order status + chat),
 *   - a mirrored burner-seed store (so a future multi-node sweeper can still
 *     sign AccountDelete for burners created on another node).
 *
 * When REDIS_URL is unset (or the connection fails) every helper transparently
 * falls back to an in-process Map / local bus, so local dev, tests, and
 * single-node deploys behave exactly as before — nothing else needs to know
 * whether Redis is present. The module is the single Redis touchpoint; other
 * services never import ioredis directly.
 */

const logger = require('../utils/logger');

// ─── In-memory fallback state ────────────────────────────────────────────────
// key -> { value, expiresAt }
const fallbackData = new Map();
// channel -> Set<handler>
const fallbackSubscribers = new Map();
// channel -> Set<handler> (used only while a real Redis subscriber is attached)
const redisListeners = new Map();

let client = null;
let subscriber = null;
let connecting = null;

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function redisUrl() {
  return process.env.REDIS_URL;
}

/**
 * Synchronous check used by callers that must pick a code path without
 * awaiting (rate limiter, WS broadcast). True only when a URL is configured;
 * actual connectivity is resolved lazily by getClient().
 */
function isRedisConfigured() {
  return Boolean(redisUrl());
}

/**
 * Lazily create and connect the ioredis client. Returns null when Redis is
 * not configured or cannot be reached (the store then falls back to memory).
 */
async function getClient() {
  if (client) return client;
  if (!redisUrl()) return null;
  if (!connecting) {
    const Redis = require('ioredis');
    connecting = (async () => {
      const c = new Redis(redisUrl(), {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        retryStrategy: (times) => Math.min(times * 200, 2000)
      });
      c.on('error', (err) => {
        logger.warn('Redis connection error', { error: err.message });
      });
      await c.connect();
      client = c;
      return c;
    })().catch((err) => {
      logger.warn('Redis unavailable — falling back to in-memory store', { error: err.message });
      connecting = null;
      client = null;
      return null;
    });
  }
  return connecting;
}

/**
 * Set a key with an optional TTL (ms). Resolves the Redis SET result ('OK')
 * or the fallback 'OK'.
 */
async function set(key, value, ttlMs = 0) {
  const c = await getClient();
  if (c) {
    return ttlMs > 0 ? c.set(key, value, 'PX', ttlMs) : c.set(key, value);
  }
  fallbackData.set(key, {
    value: String(value),
    expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0
  });
  return 'OK';
}

/**
 * Get a key, honoring expiry. Returns null for missing/expired keys.
 */
async function get(key) {
  const c = await getClient();
  if (c) {
    const value = await c.get(key);
    return value == null ? null : value;
  }
  const entry = fallbackData.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    fallbackData.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Delete a key. Returns the number of keys removed.
 */
async function del(key) {
  const c = await getClient();
  if (c) return c.del(key);
  fallbackData.delete(key);
  return 1;
}

/**
 * Atomic increment with an anchored fixed-window TTL: the TTL is only applied
 * on the first increment in a window (PEXPIRE ... NX), matching the in-memory
 * fixed-window semantics. Returns the new count.
 */
async function incrWithTtl(key, ttlMs = DEFAULT_TTL_MS) {
  const c = await getClient();
  if (c) {
    const results = await c.multi().incr(key).pexpire(key, ttlMs, 'NX').exec();
    const count = results && results[0] && results[0][1];
    return typeof count === 'number' ? count : parseInt(count, 10) || 0;
  }
  const now = Date.now();
  const entry = fallbackData.get(key);
  if (!entry || (entry.expiresAt && now > entry.expiresAt)) {
    fallbackData.set(key, { value: '1', expiresAt: now + ttlMs });
    return 1;
  }
  const next = parseInt(entry.value, 10) + 1;
  fallbackData.set(key, { value: String(next), expiresAt: entry.expiresAt });
  return next;
}

/**
 * Publish a message to a channel. Messages are strings (callers JSON-encode
 * structured payloads). In fallback mode subscribers are invoked locally and
 * synchronously.
 */
async function publish(channel, message) {
  const c = await getClient();
  if (c) {
    return c.publish(channel, message);
  }
  const handlers = fallbackSubscribers.get(channel);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(message);
      } catch (err) {
        logger.warn('Fallback pub/sub handler failed', { error: err.message });
      }
    }
  }
  return 1;
}

/**
 * Subscribe a handler to a channel. Returns an unsubscribe function.
 * Uses a dedicated ioredis connection for real Redis (a subscribed connection
 * cannot issue other commands). Duplicate subscriptions for the same channel
 * are deduped at the ioredis level; per-handler sets keep this idempotent.
 */
async function subscribe(channel, handler) {
  const c = await getClient();
  if (c) {
    if (!subscriber) {
      const Redis = require('ioredis');
      subscriber = new Redis(redisUrl(), {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        retryStrategy: (times) => Math.min(times * 200, 2000)
      });
      subscriber.on('error', (err) => {
        logger.warn('Redis subscriber error', { error: err.message });
      });
      subscriber.on('message', (chan, message) => {
        const handlers = redisListeners.get(chan);
        if (!handlers) return;
        for (const h of handlers) {
          try {
            h(message);
          } catch (err) {
            logger.warn('Redis pub/sub handler failed', { error: err.message });
          }
        }
      });
      await subscriber.connect();
    }
    if (!redisListeners.has(channel)) {
      await subscriber.subscribe(channel);
      redisListeners.set(channel, new Set());
    }
    const handlers = redisListeners.get(channel);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        redisListeners.delete(channel);
        if (subscriber) subscriber.unsubscribe(channel).catch(() => {});
      }
    };
  }

  if (!fallbackSubscribers.has(channel)) {
    fallbackSubscribers.set(channel, new Set());
  }
  const handlers = fallbackSubscribers.get(channel);
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      fallbackSubscribers.delete(channel);
    }
  };
}

/**
 * Disconnect and reset all connections (used by tests and graceful shutdown).
 */
async function quit() {
  if (subscriber) {
    try {
      subscriber.disconnect();
    } catch (_) { /* already closed */ }
    subscriber = null;
  }
  if (client) {
    try {
      client.disconnect();
    } catch (_) { /* already closed */ }
    client = null;
  }
  connecting = null;
}

module.exports = {
  isRedisConfigured,
  getClient,
  set,
  get,
  del,
  incrWithTtl,
  publish,
  subscribe,
  quit
};
