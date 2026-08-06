const { set: redisSet, get: redisG, del: redisDel } = require('./redisClient');
const P2POrdersDAL = require('../database/dal/p2pOrders');

const CACHE_KEY = 'cryptopay:order_book:open';
const CACHE_TTL_MS = 10 * 1000; // 10 seconds — redis.set() takes MILLISECONDS

/**
 * Get open orders for the order book with Redis caching.
 * Falls back to DB when Redis unavailable.
 * @param {number} [limit=100]
 * @returns {Promise<Array>}
 */
async function getOrderBook(limit = 100) {
  try {
    const cached = await redisG(CACHE_KEY);
    if (cached) return JSON.parse(cached).slice(0, limit);
  } catch (err) { /* cache miss — fall through */ }

  const orders = await P2POrdersDAL.getByStatus('open', 100);

  try { await redisSet(CACHE_KEY, JSON.stringify(orders), CACHE_TTL_MS); } catch (err) { /* ignore */ }

  return orders.slice(0, limit);
}

/**
 * Invalidate order book cache. Call after any order mutation.
 */
async function invalidateOrderBookCache() {
  try { await redisDel(CACHE_KEY); } catch (err) { /* ignore */ }
}

module.exports = { getOrderBook, invalidateOrderBookCache };
