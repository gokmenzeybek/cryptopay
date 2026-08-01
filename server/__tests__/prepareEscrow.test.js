/**
 * Validation tests for POST /api/p2p/prepare-escrow (PRD 3.2.3)
 *  - third party / buyer → 403; only the seller may prepare
 *  - order must exist (404) and be matched (409)
 *  - xrpAmount must equal the trade amount; destinationAddress must be the buyer (400)
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
    updateEscrow: jest.fn()
  },
  PaparaPaymentsDAL: {}
}));

const { pool } = require('../../database/connection');
const { P2POrdersDAL } = require('../../database/dal');
const app = require('../../server.production');

const SELLER = 'rJv1Fb8XG2V9twNJa2sJ3uKaZS6xQxeuns';
const BUYER = 'rfmZ3oN853yJKEVH1Y9nwxo6DYqdDw7Mqv';
const STRANGER = 'rhGDgZj8dEDBnU2SNDEmKgXDtHJ7kG9rE8';

// Matched sell order: seller created it; trade = min(500, 250) TRY / buyer rate 25 = 10 XRP
const sellOrder = {
  order_id: 'sell_1',
  xrpl_address: SELLER,
  order_type: 'sell',
  amount_xrp: 20,
  amount_try: 500,
  rate: 24,
  status: 'matched',
  counterparty_order_id: 'buy_1',
  counterparty_address: BUYER,
  escrow_status: 'none'
};

const buyOrder = {
  order_id: 'buy_1',
  xrpl_address: BUYER,
  order_type: 'buy',
  amount_xrp: 10,
  amount_try: 250,
  rate: 25,
  status: 'matched',
  counterparty_order_id: 'sell_1',
  counterparty_address: SELLER,
  escrow_status: 'none'
};

function tokenFor(address) {
  return jwt.sign({ address }, process.env.JWT_SECRET);
}

function postPrepare(address, body) {
  return request(app)
    .post('/api/p2p/prepare-escrow')
    .set('Authorization', `Bearer ${tokenFor(address)}`)
    .send(body);
}

const goodBody = { orderId: 'sell_1', xrpAmount: 10, destinationAddress: BUYER };

describe('POST /api/p2p/prepare-escrow validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockImplementation(async (sql, params) => ({
      rows: [{ id: 1, address: params[0], is_active: true }]
    }));
    P2POrdersDAL.getById.mockImplementation(async (id) =>
      ({ sell_1: { ...sellOrder }, buy_1: { ...buyOrder } }[id] || null));
    P2POrdersDAL.updateEscrow.mockResolvedValue({});
  });

  test('order not found → 404', async () => {
    const res = await postPrepare(SELLER, { ...goodBody, orderId: 'nope' });
    expect(res.status).toBe(404);
  });

  test('order not matched → 409', async () => {
    P2POrdersDAL.getById.mockResolvedValue({ ...sellOrder, status: 'open' });
    const res = await postPrepare(SELLER, goodBody);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/status: open/);
  });

  test('third party → 403', async () => {
    const res = await postPrepare(STRANGER, goodBody);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Only the seller/);
  });

  test('buyer → 403 (only the seller prepares the escrow)', async () => {
    const res = await postPrepare(BUYER, goodBody);
    expect(res.status).toBe(403);
  });

  test('wrong destination → 400', async () => {
    const res = await postPrepare(SELLER, { ...goodBody, destinationAddress: STRANGER });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/buyer address/);
  });

  test('wrong amount → 400', async () => {
    const res = await postPrepare(SELLER, { ...goodBody, xrpAmount: 9 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/trade amount \(10 XRP\)/);
  });

  test('happy path: seller prepares 10 XRP escrow to buyer → 200, preimage persisted', async () => {
    const res = await postPrepare(SELLER, goodBody);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transaction.TransactionType).toBe('EscrowCreate');
    // On-chain PREIMAGE-SHA-256 crypto-condition (78 chars) and encoded
    // fulfillment blob (72 chars: A0228020 + 64-hex preimage)
    expect(res.body.condition).toMatch(/^A0258020[A-F0-9]{64}810120$/);
    expect(P2POrdersDAL.updateEscrow).toHaveBeenCalledWith('sell_1', expect.objectContaining({
      escrow_status: 'prepared',
      escrow_owner: SELLER,
      escrow_condition: res.body.condition,
      escrow_preimage: expect.stringMatching(/^A0228020[A-F0-9]{64}$/)
    }));
  });
});
