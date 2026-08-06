/**
 * Integration tests for the Papara webhook contract (PRD 2.6):
 *  - HMAC verified over the exact raw request bytes (2.6.1)
 *  - Order resolved via the papara_payments referenceId mapping (2.6.2)
 *  - Replay protection: stale timestamps rejected, duplicate webhooks
 *    acknowledged without re-advancing state (2.6.3)
 */

process.env.CRYPTOPAY_SKIP_LISTEN = 'true';
process.env.PAPARA_WEBHOOK_SECRET = 'test_webhook_secret';

const crypto = require('crypto');
const request = require('supertest');

// Mock the database layer (explicit test doubles)
jest.mock('../../database/connection', () => ({
  pool: { query: jest.fn(), end: jest.fn() },
  testConnection: jest.fn().mockResolvedValue(true),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true })
}));

jest.mock('../../database/dal', () => ({
  WalletsDAL: {},
  TransactionsDAL: {},
  PaymentRequestsDAL: {},
  P2POrdersDAL: {
    getById: jest.fn(),
    updateStatus: jest.fn()
  },
  PaparaPaymentsDAL: {
    getByReferenceId: jest.fn(),
    markProcessed: jest.fn()
  },
  WebhookEventsDAL: {
    create: jest.fn().mockResolvedValue({ id: 1 }),
    updateStatus: jest.fn().mockResolvedValue({ id: 1 })
  }
}));

const { P2POrdersDAL, PaparaPaymentsDAL } = require('../../database/dal');

jest.mock('../../services/paparaPaymentService', () => ({
  queuePaparaPayment: jest.fn().mockResolvedValue({ id: 'job-1' }),
  processPaparaPayment: jest.fn()
}));

jest.mock('../../services/queueWorkers', () => ({
  initializeQueues: jest.fn().mockResolvedValue(undefined)
}));

const app = require('../../server.production');

const SECRET = 'test_webhook_secret';

function sign(rawBody) {
  return crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

function postWebhook(rawBody, signature) {
  return request(app)
    .post('/api/webhooks/papara')
    .set('Content-Type', 'application/json')
    .set('x-papara-signature', signature)
    .send(rawBody);
}

const matchedOrder = {
  order_id: 'order_123',
  status: 'matched',
  order_type: 'sell',
  amount_try: 250,
  amount_xrp: 10,
  xrpl_address: 'rSeller1234567890123456789012345678901234',
  counterparty_address: 'rBuyer1234567890123456789012345678901234',
  counterparty_order_id: 'order_456'
};

const initiatedPayment = {
  id: 1,
  reference_id: 'P2P_order_123_1700000000000',
  order_id: 'order_123',
  transaction_id: 'tx_1',
  amount_try: 250,
  status: 'initiated',
  processed_at: null
};

describe('Papara webhook contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    P2POrdersDAL.getById.mockResolvedValue(matchedOrder);
    P2POrdersDAL.updateStatus.mockResolvedValue({ ...matchedOrder, status: 'payment_confirmed' });
    PaparaPaymentsDAL.getByReferenceId.mockResolvedValue(initiatedPayment);
    PaparaPaymentsDAL.markProcessed.mockResolvedValue({ ...initiatedPayment, status: 'completed', processed_at: new Date() });
  });

  describe('raw-body HMAC verification (2.6.1)', () => {
    it('verifies a webhook signed over its exact raw bytes', async () => {
      const raw = '{"referenceId":"P2P_order_123_1700000000000","amount":250,"status":"completed"}';
      const res = await postWebhook(raw, sign(raw));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Payment queued for processing via Papara webhook');
    });

    it('verifies the same JSON with a different key order (proves raw-body verification)', async () => {
      // Same logical payload, different byte layout — only raw-body HMAC passes
      const raw = '{"status":"completed","amount":250,"referenceId":"P2P_order_123_1700000000000"}';
      const res = await postWebhook(raw, sign(raw));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects a tampered body with 401', async () => {
      const raw = '{"referenceId":"P2P_order_123_1700000000000","amount":250,"status":"completed"}';
      const signature = sign(raw);
      const tampered = '{"referenceId":"P2P_order_123_1700000000000","amount":250,"status":"completed"} ';

      const res = await postWebhook(tampered, signature);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(P2POrdersDAL.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('referenceId mapping (2.6.2)', () => {
    it('resolves the order from the persisted mapping, not from referenceId as order id', async () => {
      const raw = '{"referenceId":"P2P_order_123_1700000000000","amount":250,"status":"completed"}';
      const res = await postWebhook(raw, sign(raw));

      expect(res.status).toBe(200);
      expect(PaparaPaymentsDAL.getByReferenceId).toHaveBeenCalledWith('P2P_order_123_1700000000000');
      expect(P2POrdersDAL.getById).toHaveBeenCalledWith('order_123');
      // Payment is queued for async processing
      const { queuePaparaPayment } = require('../../services/paparaPaymentService');
      expect(queuePaparaPayment).toHaveBeenCalledWith({
        orderId: 'order_123',
        paparaPaymentId: 'tx_1',
        amount: 250,
        referenceId: 'P2P_order_123_1700000000000'
      });
    });

    it('returns 404 for an unknown referenceId without any state change', async () => {
      PaparaPaymentsDAL.getByReferenceId.mockResolvedValue(null);

      const raw = '{"referenceId":"P2P_unknown_1700000000000","amount":250,"status":"completed"}';
      const res = await postWebhook(raw, sign(raw));

      expect(res.status).toBe(404);
      const { queuePaparaPayment } = require('../../services/paparaPaymentService');
      expect(queuePaparaPayment).not.toHaveBeenCalled();
    });
  });

  describe('replay protection (2.6.3)', () => {
    it('acknowledges a duplicate webhook with 200 but no state change', async () => {
      PaparaPaymentsDAL.getByReferenceId.mockResolvedValue({
        ...initiatedPayment,
        processed_at: new Date()
      });

      const raw = '{"referenceId":"P2P_order_123_1700000000000","amount":250,"status":"completed"}';
      const res = await postWebhook(raw, sign(raw));

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Webhook already processed');
      expect(P2POrdersDAL.updateStatus).not.toHaveBeenCalled();
      expect(PaparaPaymentsDAL.markProcessed).not.toHaveBeenCalled();
    });

    it('rejects a webhook with a timestamp older than 5 minutes', async () => {
      const stale = Date.now() - 10 * 60 * 1000;
      const raw = `{"referenceId":"P2P_order_123_1700000000000","amount":250,"status":"completed","timestamp":${stale}}`;
      const res = await postWebhook(raw, sign(raw));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Webhook timestamp is too old');
      expect(P2POrdersDAL.updateStatus).not.toHaveBeenCalled();
    });

    it('accepts a webhook with a fresh timestamp', async () => {
      const fresh = Date.now();
      const raw = `{"referenceId":"P2P_order_123_1700000000000","amount":250,"status":"completed","timestamp":${fresh}}`;
      const res = await postWebhook(raw, sign(raw));

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Payment queued for processing via Papara webhook');
    });
  });
});
