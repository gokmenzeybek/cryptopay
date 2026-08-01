/**
 * Validation matrix tests for POST /api/p2p/match (PRD 3.1.2)
 *  - same-order, same-type, wrong status, expired, no common payment method,
 *    incompatible rates → 400/409 with reasons
 *  - happy path persists atomically via P2POrdersDAL.matchOrders
 *  - persistence-layer race (order no longer open) → 409
 */

process.env.CRYPTOPAY_SKIP_LISTEN = 'true';

const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../../database/connection', () => ({
  pool: { query: jest.fn(), end: jest.fn(), connect: jest.fn() },
  testConnection: jest.fn().mockResolvedValue(true),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true })
}));

jest.mock('../../database/dal', () => ({
  WalletsDAL: {},
  TransactionsDAL: {},
  PaymentRequestsDAL: {},
  P2POrdersDAL: {
    getById: jest.fn(),
    matchOrders: jest.fn(),
    update: jest.fn()
  },
  PaparaPaymentsDAL: {}
}));

const { pool } = require('../../database/connection');
const { P2POrdersDAL } = require('../../database/dal');
const app = require('../../server.production');

const BUYER = 'rBuyer1234567890123456789012345678901234';
const SELLER = 'rSeller1234567890123456789012345678901234';

const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString();

const openBuyOrder = {
  order_id: 'buy_1',
  xrpl_address: BUYER,
  order_type: 'buy',
  amount_xrp: 10,
  amount_try: 250,
  rate: 25,
  payment_methods: ['papara', 'bank_transfer'],
  status: 'open',
  expires_at: futureExpiry
};

const openSellOrder = {
  order_id: 'sell_1',
  xrpl_address: SELLER,
  order_type: 'sell',
  amount_xrp: 20,
  amount_try: 500,
  rate: 24,
  payment_methods: ['papara'],
  status: 'open',
  expires_at: futureExpiry
};

function buyerToken() {
  return jwt.sign({ address: BUYER }, process.env.JWT_SECRET);
}

function postMatch(body) {
  return request(app)
    .post('/api/p2p/match')
    .set('Authorization', `Bearer ${buyerToken()}`)
    .send(body);
}

describe('POST /api/p2p/match validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // authMiddleware wallet lookup
    pool.query.mockResolvedValue({ rows: [{ id: 1, address: BUYER, is_active: true }] });
    P2POrdersDAL.getById.mockImplementation(async (id) =>
      ({ buy_1: { ...openBuyOrder }, sell_1: { ...openSellOrder } }[id] || null));
    P2POrdersDAL.matchOrders.mockResolvedValue({ buy_order: {}, sell_order: {}, match: {} });
    P2POrdersDAL.update.mockResolvedValue({});
  });

  test('matching an order with itself → 400', async () => {
    const res = await postMatch({ orderId: 'buy_1', counterpartyOrderId: 'buy_1' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/itself/);
    expect(P2POrdersDAL.matchOrders).not.toHaveBeenCalled();
  });

  test('two buy orders → 400', async () => {
    P2POrdersDAL.getById.mockImplementation(async (id) =>
      id === 'buy_1' ? { ...openBuyOrder } : { ...openBuyOrder, order_id: 'buy_2', xrpl_address: SELLER });
    const res = await postMatch({ orderId: 'buy_1', counterpartyOrderId: 'buy_2' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/one buy and one sell/);
    expect(P2POrdersDAL.matchOrders).not.toHaveBeenCalled();
  });

  test('counterparty order not open → 409', async () => {
    P2POrdersDAL.getById.mockImplementation(async (id) =>
      id === 'buy_1' ? { ...openBuyOrder } : { ...openSellOrder, status: 'matched' });
    const res = await postMatch({ orderId: 'buy_1', counterpartyOrderId: 'sell_1' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/must be open/);
    expect(P2POrdersDAL.matchOrders).not.toHaveBeenCalled();
  });

  test('expired order → 409', async () => {
    P2POrdersDAL.getById.mockImplementation(async (id) =>
      id === 'buy_1' ? { ...openBuyOrder } : { ...openSellOrder, expires_at: new Date(Date.now() - 1000).toISOString() });
    const res = await postMatch({ orderId: 'buy_1', counterpartyOrderId: 'sell_1' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/expired/);
  });

  test('no common payment method → 400', async () => {
    P2POrdersDAL.getById.mockImplementation(async (id) =>
      id === 'buy_1' ? { ...openBuyOrder } : { ...openSellOrder, payment_methods: ['ininal'] });
    const res = await postMatch({ orderId: 'buy_1', counterpartyOrderId: 'sell_1' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/payment method/);
  });

  test('incompatible rates (buy < sell) → 400', async () => {
    P2POrdersDAL.getById.mockImplementation(async (id) =>
      id === 'buy_1' ? { ...openBuyOrder, rate: 20 } : { ...openSellOrder, rate: 24 });
    const res = await postMatch({ orderId: 'buy_1', counterpartyOrderId: 'sell_1' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Rates are not compatible/);
  });

  test('missing order → 404', async () => {
    P2POrdersDAL.getById.mockResolvedValue(null);
    const res = await postMatch({ orderId: 'nope', counterpartyOrderId: 'alsono' });
    expect(res.status).toBe(404);
  });

  test('happy path → 200, atomic DAL.matchOrders called with (buy, sell)', async () => {
    const res = await postMatch({ orderId: 'buy_1', counterpartyOrderId: 'sell_1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(P2POrdersDAL.matchOrders).toHaveBeenCalledWith('buy_1', 'sell_1');
  });

  test('persistence race (order no longer open) → 409', async () => {
    P2POrdersDAL.matchOrders.mockRejectedValue(new Error('Cannot match: sell order sell_1 is not open (already matched, cancelled, or not found)'));
    const res = await postMatch({ orderId: 'buy_1', counterpartyOrderId: 'sell_1' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });
});
