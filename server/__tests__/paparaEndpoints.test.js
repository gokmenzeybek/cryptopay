/**
 * Route tests for the ported Papara endpoints (PRD 4.2.1)
 *  - unauthenticated → 401 on all three
 *  - non-participant → 403 (initiate: buyer-only; status: trade parties only)
 *  - initiate does NOT advance the order to payment_confirmed
 *  - validate delegates to the real paparaService shape
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
    updateStatus: jest.fn(),
    updateOrderStatus: jest.fn()
  },
  PaparaPaymentsDAL: {
    getByOrderId: jest.fn()
  }
}));

const mockPaparaService = {
  validateAccount: jest.fn(),
  getPaymentStatus: jest.fn()
};

jest.mock('../../services/p2pMatchingService', () => {
  const actual = jest.requireActual('../../services/p2pMatchingService');
  return {
    ...actual,
    getPaparaService: () => mockPaparaService,
    processPaparaPayment: jest.fn(),
    getPaparaPaymentStatus: jest.fn()
  };
});

const { pool } = require('../../database/connection');
const { P2POrdersDAL, PaparaPaymentsDAL } = require('../../database/dal');
const p2pMatchingService = require('../../services/p2pMatchingService');
const app = require('../../server.production');

const BUYER = 'rJv1Fb8XG2V9twNJa2sJ3uKaZS6xQxeuns';
const SELLER = 'rfmZ3oN853yJKEVH1Y9nwxo6DYqdDw7Mqv';
const STRANGER = 'rhGDgZj8dEDBnU2SNDEmKgXDtHJ7kG9rE8';

// Matched sell order (seller created it, buyer is the counterparty)
const matchedOrder = {
  order_id: 'sell_1',
  xrpl_address: SELLER,
  order_type: 'sell',
  amount_try: 250,
  amount_xrp: 10,
  status: 'matched',
  counterparty_order_id: 'buy_1',
  counterparty_address: BUYER
};

function tokenFor(address) {
  return jwt.sign({ address }, process.env.JWT_SECRET);
}

function auth(address) {
  return { Authorization: `Bearer ${tokenFor(address)}` };
}

describe('Papara frontend endpoints (PRD 4.2.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockImplementation(async (sql, params) => ({
      rows: [{ id: 1, address: params[0], is_active: true }]
    }));
    P2POrdersDAL.getById.mockResolvedValue({ ...matchedOrder });
  });

  test('unauthenticated → 401 on all three endpoints', async () => {
    const r1 = await request(app).post('/api/p2p/validate-papara-account').send({ accountNumber: '1234567890' });
    const r2 = await request(app).post('/api/p2p/initiate-papara-payment').send({ orderId: 'sell_1', paparaAccountNumber: '1234567890' });
    const r3 = await request(app).get('/api/p2p/papara-payment-status/sell_1');
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(401);
  });

  test('validate-papara-account delegates to paparaService.validateAccount', async () => {
    mockPaparaService.validateAccount.mockResolvedValue({
      success: true, accountExists: true, accountHolder: 'T*** Y***', accountNumber: '******7890'
    });
    const res = await request(app)
      .post('/api/p2p/validate-papara-account')
      .set(auth(BUYER))
      .send({ accountNumber: '1234567890' });
    expect(res.status).toBe(200);
    expect(res.body.accountExists).toBe(true);
    expect(mockPaparaService.validateAccount).toHaveBeenCalledWith('1234567890');
  });

  test('initiate: seller (non-buyer) → 403', async () => {
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .set(auth(SELLER))
      .send({ orderId: 'sell_1', paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Only the buyer/);
    expect(p2pMatchingService.processPaparaPayment).not.toHaveBeenCalled();
  });

  test('initiate: stranger → 403', async () => {
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .set(auth(STRANGER))
      .send({ orderId: 'sell_1', paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(403);
  });

  test('initiate: non-matched order → 409', async () => {
    P2POrdersDAL.getById.mockResolvedValue({ ...matchedOrder, status: 'open' });
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .set(auth(BUYER))
      .send({ orderId: 'sell_1', paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(409);
  });

  test('initiate: buyer success → 200 and does NOT set payment_confirmed', async () => {
    p2pMatchingService.processPaparaPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_1',
      referenceId: 'P2P_sell_1_123',
      status: 'initiated',
      paymentUrl: null,
      amount: 250,
      fee: 0
    });
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .set(auth(BUYER))
      .send({ orderId: 'sell_1', paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/awaiting webhook confirmation/);
    // No order-status writes at all — confirmation comes only from the webhook
    expect(P2POrdersDAL.updateStatus).not.toHaveBeenCalled();
    expect(P2POrdersDAL.updateOrderStatus).not.toHaveBeenCalled();
  });

  test('status: stranger → 403', async () => {
    const res = await request(app)
      .get('/api/p2p/papara-payment-status/sell_1')
      .set(auth(STRANGER));
    expect(res.status).toBe(403);
  });

  test('status: buyer gets payment status + order status', async () => {
    PaparaPaymentsDAL.getByOrderId.mockResolvedValue({
      reference_id: 'P2P_sell_1_123', order_id: 'sell_1', transaction_id: 'tx_1', status: 'initiated'
    });
    p2pMatchingService.getPaparaPaymentStatus.mockResolvedValue({
      success: true, transactionId: 'tx_1', status: 'completed'
    });
    const res = await request(app)
      .get('/api/p2p/papara-payment-status/sell_1')
      .set(auth(BUYER));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.orderStatus).toBe('matched');
    expect(res.body.referenceId).toBe('P2P_sell_1_123');
  });

  test('status: no payment yet → 404', async () => {
    PaparaPaymentsDAL.getByOrderId.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/p2p/papara-payment-status/sell_1')
      .set(auth(BUYER));
    expect(res.status).toBe(404);
  });
});
