/**
 * Unit Tests for Server API Endpoints (server.js — dev server)
 *
 * Rewritten in Phase 7 (PRD 7.1.1) against server.js's current response
 * contract. Mocks follow the same harness pattern as the production-server
 * suites: full connection mock, DAL mock, service mocks, top-level require
 * (jest.config resetModules:true makes late requires see different mock
 * instances).
 */

const request = require('supertest');

jest.mock('../../database/connection', () => ({
  pool: { query: jest.fn(), end: jest.fn(), connect: jest.fn() },
  testConnection: jest.fn().mockResolvedValue(true),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true })
}));

jest.mock('../../database/dal', () => ({
  WalletsDAL: {
    getAll: jest.fn(),
    create: jest.fn(),
    updateActivity: jest.fn()
  },
  TransactionsDAL: {
    getAll: jest.fn(),
    create: jest.fn()
  },
  PaymentRequestsDAL: {
    getAll: jest.fn(),
    getByStatus: jest.fn(),
    create: jest.fn()
  },
  P2POrdersDAL: {
    getAll: jest.fn(),
    getOpenOrders: jest.fn(),
    getByTypeAndStatus: jest.fn(),
    getByAddress: jest.fn(),
    getByOrderId: jest.fn(),
    create: jest.fn(),
    matchOrders: jest.fn(),
    cleanupExpired: jest.fn(),
    updateOrderStatus: jest.fn()
  }
}));

jest.mock('../../services/tryRateScraperService', () => ({
  getCurrentRate: jest.fn(),
  getMarketStats: jest.fn()
}));

jest.mock('../../services/p2pMatchingService', () => ({
  ORDER_TYPE: { BUY: 'buy', SELL: 'sell' },
  PAYMENT_METHODS: { BANK_TRANSFER: 'bank_transfer', PAPARA: 'papara' },
  createP2POrder: jest.fn(),
  findMatchingOrders: jest.fn(),
  getOrderSummary: jest.fn((o) => o),
  confirmPayment: jest.fn()
}));

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimiter: jest.fn().mockReturnValue((req, res, next) => next())
}));

const { pool, healthCheck } = require('../../database/connection');
const {
  WalletsDAL,
  TransactionsDAL,
  PaymentRequestsDAL,
  P2POrdersDAL
} = require('../../database/dal');
const tryRateScraperService = require('../../services/tryRateScraperService');
const p2pMatchingService = require('../../services/p2pMatchingService');
const app = require('../../server');

const VALID_ADDRESS = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

beforeEach(() => {
  jest.clearAllMocks();

  // Sensible defaults; individual tests override as needed.
  healthCheck.mockResolvedValue({ healthy: true });
  WalletsDAL.getAll.mockResolvedValue([]);
  WalletsDAL.create.mockResolvedValue({
    address: VALID_ADDRESS,
    public_key: 'ED123',
    is_active: true
  });
  WalletsDAL.updateActivity.mockResolvedValue();
  TransactionsDAL.getAll.mockResolvedValue([]);
  TransactionsDAL.create.mockResolvedValue({ hash: 'H'.repeat(64), amount_xrp: 10 });
  PaymentRequestsDAL.getAll.mockResolvedValue([]);
  PaymentRequestsDAL.getByStatus.mockResolvedValue([]);
  PaymentRequestsDAL.create.mockResolvedValue({ request_id: 'req-1', amount_xrp: 5 });
  P2POrdersDAL.getAll.mockResolvedValue([]);
  P2POrdersDAL.getOpenOrders.mockResolvedValue([]);
  P2POrdersDAL.getByTypeAndStatus.mockResolvedValue([]);
  P2POrdersDAL.getByAddress.mockResolvedValue([]);
  P2POrdersDAL.cleanupExpired.mockResolvedValue();
  P2POrdersDAL.updateOrderStatus.mockResolvedValue();
  tryRateScraperService.getCurrentRate.mockResolvedValue({
    rate: 12.5,
    sources: [{ source: 'CoinGecko', rate: 12.5 }],
    averageChange24h: 1.5
  });
  tryRateScraperService.getMarketStats.mockReturnValue({
    currentRate: 12.5,
    change24h: 1.5,
    sourcesCount: 1
  });
  p2pMatchingService.createP2POrder.mockReturnValue({
    id: 'order-1',
    type: 'buy',
    status: 'open',
    tryAmount: 100,
    xrpAmount: 10,
    rate: 10,
    xrplAddress: VALID_ADDRESS,
    paymentMethods: ['papara'],
    expiresAt: Date.now() + 3600000
  });
  p2pMatchingService.findMatchingOrders.mockReturnValue([]);
});

describe('Server API Endpoints (server.js)', () => {
  describe('GET /api', () => {
    it('returns API documentation', async () => {
      const res = await request(app).get('/api').expect(200);
      expect(res.body).toMatchObject({
        message: 'CryptoPay P2P TRY-XRP Exchange API',
        version: '3.0.0',
        endpoints: expect.objectContaining({
          wallets: '/api/wallets',
          transactions: '/api/transactions',
          p2p_rate: '/api/p2p/rate'
        })
      });
    });
  });

  describe('GET /api/health', () => {
    it('returns healthy status when the DB is up', async () => {
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body).toMatchObject({
        success: true,
        status: 'healthy',
        database: 'postgresql',
        database_healthy: true
      });
    });

    it('returns 500 when the health check throws', async () => {
      healthCheck.mockRejectedValueOnce(new Error('db down'));
      const res = await request(app).get('/api/health').expect(500);
      expect(res.body.success).toBe(false);
      expect(res.body.status).toBe('unhealthy');
    });
  });

  describe('GET /api/wallets', () => {
    it('returns the wallets list', async () => {
      WalletsDAL.getAll.mockResolvedValueOnce([
        { address: VALID_ADDRESS, public_key: 'ED123', is_active: true }
      ]);
      const res = await request(app).get('/api/wallets').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.wallets[0].address).toBe(VALID_ADDRESS);
    });

    it('returns 500 on database errors', async () => {
      WalletsDAL.getAll.mockRejectedValueOnce(new Error('db error'));
      const res = await request(app).get('/api/wallets').expect(500);
      expect(res.body).toMatchObject({ success: false, error: 'Failed to fetch wallets' });
    });
  });

  describe('POST /api/wallets', () => {
    it('creates a wallet successfully', async () => {
      const res = await request(app)
        .post('/api/wallets')
        .send({ address: VALID_ADDRESS, public_key: 'ED123' })
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.wallet.address).toBe(VALID_ADDRESS);
      expect(WalletsDAL.create).toHaveBeenCalledWith({
        address: VALID_ADDRESS,
        public_key: 'ED123',
        is_active: true
      });
    });

    it('rejects missing address/public_key with 400', async () => {
      const res = await request(app).post('/api/wallets').send({}).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 on database errors', async () => {
      WalletsDAL.create.mockRejectedValueOnce(new Error('db error'));
      const res = await request(app)
        .post('/api/wallets')
        .send({ address: VALID_ADDRESS, public_key: 'ED123' })
        .expect(500);
      expect(res.body).toMatchObject({ success: false, error: 'Failed to sync wallet' });
    });
  });

  describe('GET /api/transactions', () => {
    it('returns the transactions list', async () => {
      TransactionsDAL.getAll.mockResolvedValueOnce([
        { hash: 'H'.repeat(64), amount_xrp: 10, status: 'validated' }
      ]);
      const res = await request(app).get('/api/transactions').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
    });

    it('passes limit and offset through to the DAL', async () => {
      await request(app).get('/api/transactions?limit=10&offset=20').expect(200);
      expect(TransactionsDAL.getAll).toHaveBeenCalledWith(10, 20);
    });

    it('returns 500 on database errors', async () => {
      TransactionsDAL.getAll.mockRejectedValueOnce(new Error('db error'));
      await request(app).get('/api/transactions').expect(500);
    });
  });

  describe('POST /api/transactions', () => {
    const txBody = {
      hash: 'H'.repeat(64),
      from_address: VALID_ADDRESS,
      to_address: VALID_ADDRESS,
      amount: 10,
      fee: 0.00001
    };

    it('creates a transaction successfully', async () => {
      const res = await request(app).post('/api/transactions').send(txBody).expect(200);
      expect(res.body.success).toBe(true);
      expect(TransactionsDAL.create).toHaveBeenCalledWith(
        expect.objectContaining({ hash: txBody.hash, amount_xrp: 10 })
      );
    });

    it('rejects missing required fields with 400', async () => {
      const res = await request(app).post('/api/transactions').send({ hash: 'x' }).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 on database errors', async () => {
      TransactionsDAL.create.mockRejectedValueOnce(new Error('db error'));
      const res = await request(app).post('/api/transactions').send(txBody).expect(500);
      expect(res.body).toMatchObject({ success: false, error: 'Failed to sync transaction' });
    });
  });

  describe('GET /api/payment_requests', () => {
    it('returns the payment requests list', async () => {
      PaymentRequestsDAL.getAll.mockResolvedValueOnce([
        { request_id: 'req-1', amount_xrp: 5, status: 'pending' }
      ]);
      const res = await request(app).get('/api/payment_requests').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
    });

    it('filters by status via the DAL', async () => {
      await request(app).get('/api/payment_requests?status=paid').expect(200);
      expect(PaymentRequestsDAL.getByStatus).toHaveBeenCalledWith('paid', 50);
    });

    it('returns 500 on database errors', async () => {
      PaymentRequestsDAL.getAll.mockRejectedValueOnce(new Error('db error'));
      await request(app).get('/api/payment_requests').expect(500);
    });
  });

  describe('POST /api/payment_requests', () => {
    const prBody = {
      request_id: 'req-1',
      amount: 5,
      from_address: VALID_ADDRESS,
      to_address: VALID_ADDRESS
    };

    it('creates a payment request successfully', async () => {
      const res = await request(app).post('/api/payment_requests').send(prBody).expect(200);
      expect(res.body.success).toBe(true);
      expect(PaymentRequestsDAL.create).toHaveBeenCalledWith(
        expect.objectContaining({ request_id: 'req-1', amount_xrp: 5 })
      );
    });

    it('rejects missing required fields with 400', async () => {
      const res = await request(app).post('/api/payment_requests').send({}).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 on database errors', async () => {
      PaymentRequestsDAL.create.mockRejectedValueOnce(new Error('db error'));
      const res = await request(app).post('/api/payment_requests').send(prBody).expect(500);
      expect(res.body).toMatchObject({ success: false, error: 'Failed to sync payment request' });
    });
  });

  describe('GET /api/stats', () => {
    it('returns application statistics', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          stats: {
            active_wallets: 3,
            total_transactions: 10,
            total_requests: 4,
            pending_requests: 1,
            total_volume_xrp: '25.5',
            recent_transactions_24h: 2,
            last_updated: '2026-07-31'
          }
        }]
      });
      const res = await request(app).get('/api/stats').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toMatchObject({
        active_wallets: 3,
        total_transactions: 10,
        total_volume_xrp: 25.5
      });
    });

    it('returns 500 on database errors', async () => {
      pool.query.mockRejectedValueOnce(new Error('db error'));
      await request(app).get('/api/stats').expect(500);
    });
  });

  describe('GET /api/export', () => {
    it('exports all data', async () => {
      const res = await request(app).get('/api/export').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        wallets: [],
        transactions: [],
        payment_requests: []
      });
      expect(res.body.data.export_timestamp).toBeDefined();
    });

    it('returns 500 on database errors', async () => {
      WalletsDAL.getAll.mockRejectedValueOnce(new Error('db error'));
      await request(app).get('/api/export').expect(500);
    });
  });

  describe('GET /api/p2p/rate', () => {
    it('returns the current TRY rate', async () => {
      const res = await request(app).get('/api/p2p/rate').expect(200);
      expect(res.body).toMatchObject({ success: true, currency: 'TRY', rate: 12.5 });
      expect(res.body.marketStats).toBeDefined();
    });

    it('returns 500 when rate fetching fails', async () => {
      tryRateScraperService.getCurrentRate.mockRejectedValueOnce(new Error('scrape failed'));
      const res = await request(app).get('/api/p2p/rate').expect(500);
      expect(res.body).toMatchObject({ success: false, error: 'Failed to fetch XRP/TRY rate' });
    });
  });

  describe('POST /api/p2p/create-order', () => {
    const orderBody = {
      type: 'buy',
      tryAmount: 100,
      xrpAmount: 10,
      rate: 10,
      xrplAddress: VALID_ADDRESS,
      paymentMethods: ['papara']
    };

    it('creates a buy order successfully', async () => {
      P2POrdersDAL.create.mockResolvedValueOnce({ order_id: 'order-1' });
      const res = await request(app).post('/api/p2p/create-order').send(orderBody).expect(200);
      expect(res.body.success).toBe(true);
      expect(p2pMatchingService.createP2POrder).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'buy', tryAmount: 100, xrpAmount: 10 })
      );
    });

    it('rejects an invalid order type with 400', async () => {
      const res = await request(app)
        .post('/api/p2p/create-order')
        .send({ ...orderBody, type: 'hold' })
        .expect(400);
      expect(res.body.error).toBe('Invalid order type');
    });

    it('rejects a malformed XRPL address with 400', async () => {
      const res = await request(app)
        .post('/api/p2p/create-order')
        .send({ ...orderBody, xrplAddress: 'xshort' })
        .expect(400);
      expect(res.body.error).toBe('Invalid XRPL address');
    });

    it('rejects missing fields with 400', async () => {
      const res = await request(app).post('/api/p2p/create-order').send({ type: 'buy' }).expect(400);
      expect(res.body.error).toBe('Missing required fields');
    });
  });

  describe('GET /api/p2p/orders', () => {
    it('returns open buy and sell orders by default', async () => {
      const res = await request(app).get('/api/p2p/orders').expect(200);
      expect(res.body.success).toBe(true);
      expect(P2POrdersDAL.getOpenOrders).toHaveBeenCalledWith('buy', 50);
      expect(P2POrdersDAL.getOpenOrders).toHaveBeenCalledWith('sell', 50);
    });

    it('filters by type and status via the DAL', async () => {
      await request(app).get('/api/p2p/orders?type=buy&status=open').expect(200);
      expect(P2POrdersDAL.getByTypeAndStatus).toHaveBeenCalledWith('buy', 'open', 50);
    });

    it('returns 500 on database errors', async () => {
      P2POrdersDAL.cleanupExpired.mockRejectedValueOnce(new Error('db error'));
      await request(app).get('/api/p2p/orders').expect(500);
    });
  });

  describe('GET /api/p2p/my-orders/:address', () => {
    it('returns orders for the given address', async () => {
      const res = await request(app).get(`/api/p2p/my-orders/${VALID_ADDRESS}`).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.address).toBe(VALID_ADDRESS);
      expect(P2POrdersDAL.getByAddress).toHaveBeenCalledWith(VALID_ADDRESS, 50);
    });
  });

  describe('POST /api/p2p/match', () => {
    it('matches orders successfully', async () => {
      P2POrdersDAL.getByOrderId
        .mockResolvedValueOnce({ order_id: 'o1', order_type: 'buy', status: 'open' })
        .mockResolvedValueOnce({ order_id: 'o2', order_type: 'sell', status: 'open' });
      P2POrdersDAL.matchOrders.mockResolvedValueOnce({
        buy_order: { order_id: 'o1' },
        sell_order: { order_id: 'o2' },
        match: { id: 'm1' }
      });

      const res = await request(app)
        .post('/api/p2p/match')
        .send({ orderId: 'o1', counterpartyOrderId: 'o2' })
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(P2POrdersDAL.matchOrders).toHaveBeenCalledWith('o1', 'o2');
    });

    it('returns 404 when the order does not exist', async () => {
      P2POrdersDAL.getByOrderId.mockResolvedValueOnce(null);
      const res = await request(app)
        .post('/api/p2p/match')
        .send({ orderId: 'missing', counterpartyOrderId: 'o2' })
        .expect(404);
      expect(res.body.error).toBe('Order not found');
    });

    it('rejects missing fields with 400', async () => {
      const res = await request(app).post('/api/p2p/match').send({}).expect(400);
      expect(res.body.error).toBe('Missing required fields');
    });
  });

  describe('GET /api/p2p/payment-methods', () => {
    it('lists supported payment methods', async () => {
      const res = await request(app).get('/api/p2p/payment-methods').expect(200);
      expect(res.body.success).toBe(true);
    });
  });
});
