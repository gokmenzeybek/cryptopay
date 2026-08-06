jest.mock('../../database/connection', () => ({
  pool: { query: jest.fn() }
}));

jest.mock('../../services/redisClient', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
}));

jest.mock('../../database/dal/p2pOrders', () => ({
  getById: jest.fn(),
  updateOrderStatus: jest.fn()
}));

jest.mock('../../database/dal/paparaPayments', () => ({
  markProcessed: jest.fn()
}));

jest.mock('../../services/eventBus', () => ({
  EVENTS: { PAPARA_PAYMENT_RECEIVED: 'papara:payment_received', PAYMENT_CONFIRMED: 'payment:confirmed' },
  emit: jest.fn()
}));

jest.mock('../../services/websocketService', () => ({
  broadcastOrderUpdate: jest.fn()
}));

const P2POrdersDAL = require('../../database/dal/p2pOrders');
const PaparaPaymentsDAL = require('../../database/dal/paparaPayments');
const { processPaparaPayment, queuePaparaPayment } = require('../paparaPaymentService');
const queueService = require('../queueService');

jest.mock('../../services/queueService', () => ({
  QUEUE_NAMES: { PAPARA_PAYMENT: 'papara-payment' },
  addJob: jest.fn().mockResolvedValue({ id: 'job-1' })
}));

describe('paparaPaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processPaparaPayment', () => {
    test('processes valid payment successfully', async () => {
      const order = { id: 1, status: 'matched', amount_try: 100 };
      P2POrdersDAL.getById.mockResolvedValue(order);

      const result = await processPaparaPayment({
        orderId: 1,
        paparaPaymentId: 'pay-123',
        amount: 100,
        referenceId: 'ref-123'
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe(1);
      expect(result.status).toBe('payment_confirmed');
      expect(PaparaPaymentsDAL.markProcessed).toHaveBeenCalledWith('ref-123', 'completed');
      expect(P2POrdersDAL.updateOrderStatus).toHaveBeenCalledTimes(1);
      const [orderId, status, extras] = P2POrdersDAL.updateOrderStatus.mock.calls[0];
      expect(orderId).toBe(1);
      expect(status).toBe('payment_confirmed');
      expect(extras.papara_payment_id).toBe('pay-123');
      expect(extras.payment_confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('returns failure for non-existent order', async () => {
      P2POrdersDAL.getById.mockResolvedValue(null);

      await expect(processPaparaPayment({
        orderId: 999, paparaPaymentId: 'pay-1', amount: 100, referenceId: 'ref-1'
      })).rejects.toThrow('Order not found: 999');
    });

    test('returns failure for invalid order state', async () => {
      const order = { id: 1, status: 'completed', amount_try: 100 };
      P2POrdersDAL.getById.mockResolvedValue(order);

      const result = await processPaparaPayment({
        orderId: 1, paparaPaymentId: 'pay-1', amount: 100, referenceId: 'ref-1'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_state');
    });

    test('returns failure for amount mismatch', async () => {
      const order = { id: 1, status: 'matched', amount_try: 100 };
      P2POrdersDAL.getById.mockResolvedValue(order);

      const result = await processPaparaPayment({
        orderId: 1, paparaPaymentId: 'pay-1', amount: 200, referenceId: 'ref-1'
      });

      expect(result.success).toBe(false);
      expect(result.orderId).toBe(1);
      expect(result.status).toBe('matched');
      expect(result.reason).toBe('amount_mismatch');
      expect(PaparaPaymentsDAL.markProcessed).not.toHaveBeenCalled();
      expect(P2POrdersDAL.updateOrderStatus).not.toHaveBeenCalled();
    });

    test('allows amount within tolerance (0.01)', async () => {
      const order = { id: 1, status: 'matched', amount_try: 100 };
      P2POrdersDAL.getById.mockResolvedValue(order);

      const result = await processPaparaPayment({
        orderId: 1, paparaPaymentId: 'pay-1', amount: 100.005, referenceId: 'ref-1'
      });

      expect(result.success).toBe(true);
      expect(P2POrdersDAL.updateOrderStatus).toHaveBeenCalled();
    });

    test('returns correct shape on success', async () => {
      const order = { id: 1, status: 'matched', amount_try: 100 };
      P2POrdersDAL.getById.mockResolvedValue(order);

      const result = await processPaparaPayment({
        orderId: 1, paparaPaymentId: 'pay-123', amount: 100, referenceId: 'ref-123'
      });

      expect(result).toEqual({
        success: true,
        orderId: 1,
        status: 'payment_confirmed'
      });
    });
  });

  describe('queuePaparaPayment', () => {
    test('queues payment with retry config', async () => {
      const result = await queuePaparaPayment({
        orderId: 1, paparaPaymentId: 'pay-1', amount: 100, referenceId: 'ref-1'
      });

      expect(queueService.addJob).toHaveBeenCalledWith(
        'papara-payment',
        'confirm-payment',
        { orderId: 1, paparaPaymentId: 'pay-1', amount: 100, referenceId: 'ref-1' },
        { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true }
      );
    });
  });
});
