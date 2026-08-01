/**
 * Order-book rule enforcement tests for POST /api/p2p/create-order (PRD 3.3.1)
 *  - below min_order_amount_xrp → 400
 *  - above max_order_amount_xrp → 400
 *  - exceeding max_orders_per_user → 429
 *  - within limits → 201
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
    countOpenByAddress: jest.fn(),
    create: jest.fn(),
    getAll: jest.fn()
  },
  PaparaPaymentsDAL: {},
  SystemSettingsDAL: {
    getAll: jest.fn()
  }
}));

const { pool } = require('../../database/connection');
const { P2POrdersDAL, SystemSettingsDAL } = require('../../database/dal');
const app = require('../../server.production');

const USER = 'rJv1Fb8XG2V9twNJa2sJ3uKaZS6xQxeuns';

const defaultSettings = {
  max_orders_per_user: '10',
  min_order_amount_xrp: '1.0',
  max_order_amount_xrp: '10000.0'
};

function postOrder(body, settings = defaultSettings, openCount = 0) {
  SystemSettingsDAL.getAll.mockResolvedValue(settings);
  P2POrdersDAL.countOpenByAddress.mockResolvedValue(openCount);
  return request(app)
    .post('/api/p2p/create-order')
    .set('Authorization', `Bearer ${jwt.sign({ address: USER }, process.env.JWT_SECRET)}`)
    .send({
      type: 'buy',
      tryAmount: 250,
      rate: 25,
      xrplAddress: USER,
      paymentMethods: ['papara'],
      ...body
    });
}

describe('POST /api/p2p/create-order order-book rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [{ id: 1, address: USER, is_active: true }] });
    P2POrdersDAL.create.mockImplementation(async (data) => ({ ...data, id: 1 }));
    P2POrdersDAL.getAll.mockResolvedValue([]);
  });

  test('below min_order_amount_xrp → 400', async () => {
    const res = await postOrder({ xrpAmount: 0.5 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/below the minimum of 1 XRP/);
  });

  test('above max_order_amount_xrp → 400', async () => {
    const res = await postOrder({ xrpAmount: 20000 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds the maximum of 10000 XRP/);
  });

  test('exceeding max_orders_per_user → 429', async () => {
    const res = await postOrder({ xrpAmount: 10 }, defaultSettings, 10);
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/Maximum of 10 open orders/);
  });

  test('within limits → 201, order created', async () => {
    const res = await postOrder({ xrpAmount: 10 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(P2POrdersDAL.create).toHaveBeenCalled();
  });
});
