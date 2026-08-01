/**
 * Supplementary server.js coverage (PRD 7.1.3): the P2P lifecycle, Papara
 * helper, stats, logs and utility endpoints that server.test.js does not
 * exercise. Same harness pattern: top-level require, full mocks.
 */

const request = require('supertest');

jest.mock('../../database/connection', () => ({
  pool: { query: jest.fn(), end: jest.fn(), connect: jest.fn() },
  testConnection: jest.fn().mockResolvedValue(true),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true })
}));

jest.mock('../../database/dal', () => ({
  WalletsDAL: { getAll: jest.fn(), create: jest.fn(), updateActivity: jest.fn() },
  TransactionsDAL: { getAll: jest.fn(), create: jest.fn() },
  PaymentRequestsDAL: { getAll: jest.fn(), getByStatus: jest.fn(), create: jest.fn() },
  P2POrdersDAL: {
    getAll: jest.fn(),
    getOpenOrders: jest.fn(),
    getByTypeAndStatus: jest.fn(),
    getByAddress: jest.fn(),
    getByOrderId: jest.fn(),
    getStats: jest.fn(),
    create: jest.fn(),
    matchOrders: jest.fn(),
    cleanupExpired: jest.fn(),
    updateOrderStatus: jest.fn()
  }
}));

jest.mock('../../services/tryRateScraperService', () => ({
  getCurrentRate: jest.fn().mockResolvedValue({ rate: 12.5 }),
  getMarketStats: jest.fn().mockReturnValue({ currentRate: 12.5 })
}));

jest.mock('../../services/p2pMatchingService', () => ({
  ORDER_TYPE: { BUY: 'buy', SELL: 'sell' },
  PAYMENT_METHODS: {
    BANK_TRANSFER: 'bank_transfer',
    PAPARA: 'papara',
    ININAL: 'ininal',
    MEFETE: 'mefete',
    QR_HAVALE: 'qr_havale'
  },
  createP2POrder: jest.fn(),
  findMatchingOrders: jest.fn(),
  getOrderSummary: jest.fn((o) => o),
  confirmPayment: jest.fn(),
  confirmXrpTransfer: jest.fn(),
  cancelOrder: jest.fn(),
  raiseDispute: jest.fn(),
  getPaparaService: jest.fn(),
  processPaparaPayment: jest.fn(),
  getPaparaPaymentStatus: jest.fn(),
  getPaparaBalance: jest.fn()
}));

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimiter: jest.fn().mockReturnValue((req, res, next) => next())
}));

const { P2POrdersDAL } = require('../../database/dal');
const p2pMatchingService = require('../../services/p2pMatchingService');
const app = require('../../server');

const ORDER = {
  order_id: 9,
  id: 9,
  status: 'matched',
  counterparty_order_id: 10,
  papara_transaction_id: null
};

beforeEach(() => {
  jest.clearAllMocks();
  P2POrdersDAL.getByOrderId.mockResolvedValue({ ...ORDER });
  P2POrdersDAL.updateOrderStatus.mockResolvedValue();
  P2POrdersDAL.cleanupExpired.mockResolvedValue();
  P2POrdersDAL.getStats.mockResolvedValue({ total_orders: 5 });
});

describe('POST /api/p2p/confirm-payment', () => {
  test('400 without orderId', async () => {
    const res = await request(app).post('/api/p2p/confirm-payment').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing orderId');
  });

  test('404 when order not found', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue(null);
    const res = await request(app).post('/api/p2p/confirm-payment').send({ orderId: 1 });
    expect(res.status).toBe(404);
  });

  test('200 confirms and updates both orders', async () => {
    const res = await request(app)
      .post('/api/p2p/confirm-payment')
      .send({ orderId: 9, proofOfPayment: 'receipt' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(p2pMatchingService.confirmPayment).toHaveBeenCalled();
    expect(P2POrdersDAL.updateOrderStatus).toHaveBeenCalledTimes(2);
  });

  test('400 on service failure', async () => {
    p2pMatchingService.confirmPayment.mockImplementation(() => { throw new Error('bad state'); });
    const res = await request(app).post('/api/p2p/confirm-payment').send({ orderId: 9 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('bad state');
  });
});

describe('POST /api/p2p/confirm-xrp', () => {
  const HASH = 'A'.repeat(64);

  test('400 without required fields', async () => {
    const res = await request(app).post('/api/p2p/confirm-xrp').send({ orderId: 9 });
    expect(res.status).toBe(400);
  });

  test('404 when order not found', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue(null);
    const res = await request(app).post('/api/p2p/confirm-xrp').send({ orderId: 1, xrpTransactionHash: HASH });
    expect(res.status).toBe(404);
  });

  test('200 completes the trade', async () => {
    const res = await request(app)
      .post('/api/p2p/confirm-xrp')
      .send({ orderId: 9, xrpTransactionHash: HASH });
    expect(res.status).toBe(200);
    expect(res.body.xrpTransactionHash).toBe(HASH);
    expect(P2POrdersDAL.updateOrderStatus).toHaveBeenCalledTimes(2);
  });

  test('400 on service failure', async () => {
    p2pMatchingService.confirmXrpTransfer.mockImplementation(() => { throw new Error('hash reused'); });
    const res = await request(app)
      .post('/api/p2p/confirm-xrp')
      .send({ orderId: 9, xrpTransactionHash: HASH });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('hash reused');
  });
});

describe('POST /api/p2p/cancel', () => {
  test('400 without orderId', async () => {
    const res = await request(app).post('/api/p2p/cancel').send({});
    expect(res.status).toBe(400);
  });

  test('404 when order not found', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue(null);
    const res = await request(app).post('/api/p2p/cancel').send({ orderId: 1 });
    expect(res.status).toBe(404);
  });

  test('200 cancels the order', async () => {
    const res = await request(app).post('/api/p2p/cancel').send({ orderId: 9, reason: 'nvm' });
    expect(res.status).toBe(200);
    expect(p2pMatchingService.cancelOrder).toHaveBeenCalledWith(expect.objectContaining({ order_id: 9 }), 'nvm');
  });

  test('400 on service failure', async () => {
    p2pMatchingService.cancelOrder.mockImplementation(() => { throw new Error('too late'); });
    const res = await request(app).post('/api/p2p/cancel').send({ orderId: 9 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('too late');
  });
});

describe('POST /api/p2p/dispute', () => {
  test('400 without reason', async () => {
    const res = await request(app).post('/api/p2p/dispute').send({ orderId: 9 });
    expect(res.status).toBe(400);
  });

  test('404 when order not found', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue(null);
    const res = await request(app).post('/api/p2p/dispute').send({ orderId: 1, reason: 'x' });
    expect(res.status).toBe(404);
  });

  test('200 raises the dispute', async () => {
    const res = await request(app)
      .post('/api/p2p/dispute')
      .send({ orderId: 9, reason: 'no payment', evidence: 'chat' });
    expect(res.status).toBe(200);
    expect(p2pMatchingService.raiseDispute).toHaveBeenCalled();
  });

  test('400 on service failure', async () => {
    p2pMatchingService.raiseDispute.mockImplementation(() => { throw new Error('already disputed'); });
    const res = await request(app).post('/api/p2p/dispute').send({ orderId: 9, reason: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('already disputed');
  });
});

describe('GET /api/p2p/stats', () => {
  test('200 returns stats after cleanup', async () => {
    const res = await request(app).get('/api/p2p/stats');
    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual({ total_orders: 5 });
    expect(P2POrdersDAL.cleanupExpired).toHaveBeenCalled();
  });

  test('500 on failure', async () => {
    P2POrdersDAL.getStats.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/p2p/stats');
    expect(res.status).toBe(500);
  });
});

describe('utility endpoints', () => {
  test('GET /api/p2p/payment-methods lists all methods', async () => {
    const res = await request(app).get('/api/p2p/payment-methods');
    expect(res.status).toBe(200);
    expect(res.body.paymentMethods).toEqual(
      expect.arrayContaining(['bank_transfer', 'papara', 'ininal', 'mefete', 'qr_havale'])
    );
    expect(res.body.descriptions.papara).toMatch(/Papara/);
  });

  test('GET /api/logs returns docker log instructions', async () => {
    const res = await request(app).get('/api/logs');
    expect(res.status).toBe(200);
    expect(res.body.instructions.docker_logs).toContain('docker logs');
  });

  test('GET /logs serves the HTML viewer', async () => {
    const res = await request(app).get('/logs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('CryptoPay Logs');
  });
});

describe('POST /api/p2p/validate-papara-account', () => {
  test('400 without accountNumber', async () => {
    const res = await request(app).post('/api/p2p/validate-papara-account').send({});
    expect(res.status).toBe(400);
  });

  test('200 returns the validation result', async () => {
    p2pMatchingService.getPaparaService.mockReturnValue({
      validateAccount: jest.fn().mockResolvedValue({
        success: true, accountExists: true, accountHolder: 'Ada', accountNumber: '1234567890'
      })
    });
    const res = await request(app)
      .post('/api/p2p/validate-papara-account')
      .send({ accountNumber: '1234567890' });
    expect(res.status).toBe(200);
    expect(res.body.accountHolder).toBe('Ada');
    expect(res.body.message).toBe('Account validated successfully');
  });

  test('400 when the service throws', async () => {
    p2pMatchingService.getPaparaService.mockReturnValue({
      validateAccount: jest.fn().mockRejectedValue(new Error('papara offline'))
    });
    const res = await request(app)
      .post('/api/p2p/validate-papara-account')
      .send({ accountNumber: '1234567890' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('papara offline');
  });
});

describe('POST /api/p2p/initiate-papara-payment', () => {
  test('400 without required fields', async () => {
    const res = await request(app).post('/api/p2p/initiate-papara-payment').send({ orderId: 9 });
    expect(res.status).toBe(400);
  });

  test('404 when order not found', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .send({ orderId: 1, paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(404);
  });

  test('400 when order is not matched', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue({ ...ORDER, status: 'open' });
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .send({ orderId: 9, paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(400);
    expect(res.body.currentStatus).toBe('open');
  });

  test('400 when Papara initiation fails', async () => {
    p2pMatchingService.processPaparaPayment.mockResolvedValue({ success: false, message: 'limit exceeded' });
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .send({ orderId: 9, paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('limit exceeded');
  });

  test('200 initiates and updates both orders', async () => {
    p2pMatchingService.processPaparaPayment.mockResolvedValue({
      success: true,
      transactionId: 'TX1',
      referenceId: 'REF1',
      status: 'pending',
      paymentUrl: 'https://papara/pay',
      amount: 100,
      fee: 1
    });
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .send({ orderId: 9, paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(200);
    expect(res.body.transactionId).toBe('TX1');
    expect(P2POrdersDAL.updateOrderStatus).toHaveBeenCalledTimes(2);
  });

  test('400 on unexpected error', async () => {
    p2pMatchingService.processPaparaPayment.mockRejectedValue(new Error('kaboom'));
    const res = await request(app)
      .post('/api/p2p/initiate-papara-payment')
      .send({ orderId: 9, paparaAccountNumber: '1234567890' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('kaboom');
  });
});

describe('GET /api/p2p/papara-payment-status/:orderId', () => {
  test('404 when order not found', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue(null);
    const res = await request(app).get('/api/p2p/papara-payment-status/1');
    expect(res.status).toBe(404);
  });

  test('400 when the order has no Papara transaction', async () => {
    const res = await request(app).get('/api/p2p/papara-payment-status/9');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No Papara transaction/);
  });

  test('400 when status lookup fails', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue({ ...ORDER, papara_transaction_id: 'TX1' });
    p2pMatchingService.getPaparaPaymentStatus.mockResolvedValue({ success: false, message: 'unknown tx' });
    const res = await request(app).get('/api/p2p/papara-payment-status/9');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('unknown tx');
  });

  test('200 completed status completes both orders', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue({ ...ORDER, papara_transaction_id: 'TX1' });
    p2pMatchingService.getPaparaPaymentStatus.mockResolvedValue({
      success: true,
      transactionId: 'TX1',
      status: 'completed',
      statusDescription: 'Done',
      amount: 100,
      fee: 1,
      createdAt: '2026-01-01',
      paymentMethod: 1,
      paymentMethodDescription: 'Account'
    });
    const res = await request(app).get('/api/p2p/papara-payment-status/9');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(P2POrdersDAL.updateOrderStatus).toHaveBeenCalledTimes(2);
  });

  test('200 pending status does not complete the order', async () => {
    P2POrdersDAL.getByOrderId.mockResolvedValue({ ...ORDER, papara_transaction_id: 'TX1' });
    p2pMatchingService.getPaparaPaymentStatus.mockResolvedValue({
      success: true, transactionId: 'TX1', status: 'pending'
    });
    const res = await request(app).get('/api/p2p/papara-payment-status/9');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(P2POrdersDAL.updateOrderStatus).not.toHaveBeenCalled();
  });

  test('400 on unexpected error', async () => {
    P2POrdersDAL.getByOrderId.mockRejectedValue(new Error('db gone'));
    const res = await request(app).get('/api/p2p/papara-payment-status/9');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/p2p/papara-balance', () => {
  test('200 returns the balance', async () => {
    p2pMatchingService.getPaparaBalance.mockResolvedValue({
      success: true, balance: 500, currency: 'TRY', accountNumber: '1234567890', merchantId: 'M1'
    });
    const res = await request(app).get('/api/p2p/papara-balance');
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(500);
  });

  test('400 when balance lookup fails', async () => {
    p2pMatchingService.getPaparaBalance.mockResolvedValue({ success: false, message: 'no merchant' });
    const res = await request(app).get('/api/p2p/papara-balance');
    expect(res.status).toBe(400);
  });

  test('400 on unexpected error', async () => {
    p2pMatchingService.getPaparaBalance.mockRejectedValue(new Error('timeout'));
    const res = await request(app).get('/api/p2p/papara-balance');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('timeout');
  });
});
