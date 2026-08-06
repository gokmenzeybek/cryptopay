jest.mock('../../database/connection', () => ({
  pool: { query: jest.fn() }
}));

jest.mock('../../services/redisClient', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
}));

const { get: redisGet, set: redisSet, del: redisDel } = require('../../services/redisClient');
const P2POrdersDAL = require('../../database/dal/p2pOrders');
const { getOrderBook, invalidateOrderBookCache } = require('../orderBookCache');

jest.mock('../../database/dal/p2pOrders', () => ({
  getByStatus: jest.fn()
}));

describe('orderBookCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrderBook', () => {
    test('returns cached orders when Redis has data', async () => {
      const cachedOrders = [
        { id: 1, order_type: 'buy', amount_xrp: 100, rate: 0.5 },
        { id: 2, order_type: 'sell', amount_xrp: 200, rate: 0.6 }
      ];
      redisGet.mockResolvedValue(JSON.stringify(cachedOrders));

      const result = await getOrderBook(100);

      expect(result).toEqual(cachedOrders);
      expect(result).toHaveLength(2);
      expect(redisGet).toHaveBeenCalledWith('cryptopay:order_book:open');
      expect(P2POrdersDAL.getByStatus).not.toHaveBeenCalled();
      expect(redisSet).not.toHaveBeenCalled();
    });

    test('fetches from DB on cache miss and caches result', async () => {
      redisGet.mockResolvedValue(null);
      const dbOrders = [
        { id: 1, order_type: 'buy', amount_xrp: 100 },
        { id: 2, order_type: 'sell', amount_xrp: 200 },
        { id: 3, order_type: 'buy', amount_xrp: 300 }
      ];
      P2POrdersDAL.getByStatus.mockResolvedValue(dbOrders);

      const result = await getOrderBook(2);

      expect(result).toHaveLength(2);
      expect(P2POrdersDAL.getByStatus).toHaveBeenCalledWith('open', 100);
      expect(redisSet).toHaveBeenCalledWith(
        'cryptopay:order_book:open',
        JSON.stringify(dbOrders),
        10000
      );
    });

    test('respects limit parameter with cached data', async () => {
      const cachedOrders = Array.from({ length: 10 }, (_, i) => ({ id: i, amount_xrp: i * 10 }));
      redisGet.mockResolvedValue(JSON.stringify(cachedOrders));

      const result = await getOrderBook(5);

      expect(result).toHaveLength(5);
    });

    test('falls back to DB when Redis errors', async () => {
      redisGet.mockRejectedValue(new Error('Redis down'));
      const dbOrders = [{ id: 1, amount_xrp: 100 }];
      P2POrdersDAL.getByStatus.mockResolvedValue(dbOrders);

      const result = await getOrderBook(100);

      expect(result).toHaveLength(1);
      expect(P2POrdersDAL.getByStatus).toHaveBeenCalled();
    });

    test('still returns DB orders when caching the result fails', async () => {
      redisGet.mockResolvedValue(null);
      redisSet.mockRejectedValue(new Error('Redis write failed'));
      const dbOrders = [{ id: 9, amount_xrp: 90 }];
      P2POrdersDAL.getByStatus.mockResolvedValue(dbOrders);

      await expect(getOrderBook()).resolves.toEqual(dbOrders);
    });

    test('treats malformed cached JSON as a cache miss', async () => {
      redisGet.mockResolvedValue('{not-json');
      const dbOrders = [{ id: 10, amount_xrp: 100 }];
      P2POrdersDAL.getByStatus.mockResolvedValue(dbOrders);

      await expect(getOrderBook()).resolves.toEqual(dbOrders);
      expect(P2POrdersDAL.getByStatus).toHaveBeenCalledWith('open', 100);
    });
  });

  describe('invalidateOrderBookCache', () => {
    test('deletes cache key', async () => {
      redisDel.mockResolvedValue(1);

      await invalidateOrderBookCache();

      expect(redisDel).toHaveBeenCalledWith('cryptopay:order_book:open');
    });

    test('does not throw when Redis errors', async () => {
      redisDel.mockRejectedValue(new Error('Redis down'));

      await expect(invalidateOrderBookCache()).resolves.not.toThrow();
    });
  });
});
