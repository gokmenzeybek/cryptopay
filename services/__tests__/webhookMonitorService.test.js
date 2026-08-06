/**
 * Tests for services/webhookMonitorService.js
 *
 * Covers:
 *  - getWebhookStats: success path, success-rate calculation, queue-metrics fallback
 *  - replayWebhook: missing event throws, string payload parsing, object payload,
 *                   queue failure (addJob returns null)
 *  - getFailedEvents: delegates to DAL
 */

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../database/dal/webhookEvents', () => ({
  countByStatus: jest.fn(),
  getRecent: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../queueService', () => ({
  QUEUE_NAMES: { PAPARA_PAYMENT: 'papara-payment' },
  addJob: jest.fn(),
  getQueueMetrics: jest.fn(),
}));

const WebhookEventsDAL = require('../../database/dal/webhookEvents');
const queueService = require('../queueService');
const { getWebhookStats, replayWebhook, getFailedEvents } = require('../webhookMonitorService');

describe('webhookMonitorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── getWebhookStats ──────────────────────────────────────────────────────

  describe('getWebhookStats', () => {
    test('returns webhook stats with computed success rate', async () => {
      // countByStatus is called 6 times: received, accepted, rejected,
      // processing, completed, failed — in that order.
      WebhookEventsDAL.countByStatus
        .mockResolvedValueOnce(100)   // received
        .mockResolvedValueOnce(5)     // accepted
        .mockResolvedValueOnce(2)     // rejected
        .mockResolvedValueOnce(3)     // processing
        .mockResolvedValueOnce(80)    // completed
        .mockResolvedValueOnce(10);   // failed

      queueService.getQueueMetrics.mockResolvedValue({
        waiting: 1, active: 2, completed: 80, failed: 10, delayed: 0,
      });

      const result = await getWebhookStats('papara');

      expect(result.webhookType).toBe('papara');
      expect(result.events).toEqual({
        received: 100, accepted: 5, rejected: 2,
        processing: 3, completed: 80, failed: 10,
      });
      expect(result.queue).toEqual({
        waiting: 1, active: 2, completed: 80, failed: 10, delayed: 0,
      });
      expect(result.successRate).toBe('80.0%');

      // Verify all 6 DAL calls targeted 'papara'
      expect(WebhookEventsDAL.countByStatus).toHaveBeenCalledTimes(6);
      expect(WebhookEventsDAL.countByStatus).toHaveBeenCalledWith('papara', 'received');
      expect(WebhookEventsDAL.countByStatus).toHaveBeenCalledWith('papara', 'completed');
    });

    test('returns "N/A" success rate when received count is 0', async () => {
      WebhookEventsDAL.countByStatus
        .mockResolvedValueOnce(0)   // received
        .mockResolvedValueOnce(0)   // accepted
        .mockResolvedValueOnce(0)   // rejected
        .mockResolvedValueOnce(0)   // processing
        .mockResolvedValueOnce(0)   // completed
        .mockResolvedValueOnce(0);  // failed

      queueService.getQueueMetrics.mockResolvedValue({
        waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
      });

      const result = await getWebhookStats('papara');
      expect(result.successRate).toBe('N/A');
    });

    test('uses default "papara" webhook type when none provided', async () => {
      WebhookEventsDAL.countByStatus.mockResolvedValue(0);
      queueService.getQueueMetrics.mockResolvedValue({
        waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
      });

      await getWebhookStats();

      expect(WebhookEventsDAL.countByStatus).toHaveBeenCalledWith('papara', 'received');
    });

    test('falls back to zeroed queue metrics when getQueueMetrics throws', async () => {
      WebhookEventsDAL.countByStatus.mockResolvedValue(5);
      queueService.getQueueMetrics.mockRejectedValue(new Error('queue down'));

      const result = await getWebhookStats('papara');

      expect(result.queue).toEqual({
        waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
      });
    });

    test('passes custom webhook type through to DAL calls', async () => {
      WebhookEventsDAL.countByStatus.mockResolvedValue(0);
      queueService.getQueueMetrics.mockResolvedValue({
        waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
      });

      await getWebhookStats('stripe');

      expect(WebhookEventsDAL.countByStatus).toHaveBeenCalledWith('stripe', 'received');
      expect(WebhookEventsDAL.countByStatus).toHaveBeenCalledWith('stripe', 'failed');
    });
  });

  // ─── replayWebhook ────────────────────────────────────────────────────────

  describe('replayWebhook', () => {
    test('throws when event is not found in failed events', async () => {
      WebhookEventsDAL.getRecent.mockResolvedValue([
        { id: 'ev-1', payload: '{}', reference_id: 'ref-1' },
        { id: 'ev-2', payload: '{}', reference_id: 'ref-2' },
      ]);

      await expect(replayWebhook('ev-missing')).rejects.toThrow(
        'Webhook event not found: ev-missing',
      );

      expect(WebhookEventsDAL.getRecent).toHaveBeenCalledWith('papara', 'failed', 100);
    });

    test('parses string payload and submits job for matching event', async () => {
      const event = {
        id: 'ev-10',
        reference_id: 'order-42',
        payload: JSON.stringify({ transaction_id: 'tx-99', amount: 250 }),
      };
      WebhookEventsDAL.getRecent.mockResolvedValue([event]);
      queueService.addJob.mockResolvedValue({ id: 'job-abc' });
      WebhookEventsDAL.updateStatus.mockResolvedValue({ id: 'ev-10', processing_status: 'processing' });

      const result = await replayWebhook('ev-10');

      expect(queueService.addJob).toHaveBeenCalledWith(
        'papara-payment',
        'confirm-payment',
        {
          orderId: 'order-42',
          paparaPaymentId: 'tx-99',
          amount: 250,
          referenceId: 'order-42',
        },
      );
      expect(WebhookEventsDAL.updateStatus).toHaveBeenCalledWith('ev-10', 'processing');
      expect(result).toEqual({ success: true, jobId: 'job-abc' });
    });

    test('handles object payload (already parsed) without JSON.parse', async () => {
      const event = {
        id: 'ev-20',
        reference_id: 'order-50',
        payload: { transaction_id: 'tx-50', amount: 100 },
      };
      WebhookEventsDAL.getRecent.mockResolvedValue([event]);
      queueService.addJob.mockResolvedValue({ id: 'job-obj' });
      WebhookEventsDAL.updateStatus.mockResolvedValue({});

      const result = await replayWebhook('ev-20');

      expect(queueService.addJob).toHaveBeenCalledWith(
        'papara-payment',
        'confirm-payment',
        expect.objectContaining({ paparaPaymentId: 'tx-50', amount: 100 }),
      );
      expect(result.success).toBe(true);
    });

    test('returns null jobId when addJob returns null (queue failure)', async () => {
      const event = {
        id: 'ev-30',
        reference_id: 'order-60',
        payload: JSON.stringify({ transaction_id: 'tx-60', amount: 50 }),
      };
      WebhookEventsDAL.getRecent.mockResolvedValue([event]);
      queueService.addJob.mockResolvedValue(null);
      WebhookEventsDAL.updateStatus.mockResolvedValue({});

      const result = await replayWebhook('ev-30');

      expect(result).toEqual({ success: true, jobId: undefined });
      // Status is still updated to 'processing' even when queue fails
      expect(WebhookEventsDAL.updateStatus).toHaveBeenCalledWith('ev-30', 'processing');
    });

    test('handles event with null payload fields gracefully', async () => {
      const event = {
        id: 'ev-40',
        reference_id: 'order-70',
        payload: JSON.stringify({}),  // no transaction_id or amount
      };
      WebhookEventsDAL.getRecent.mockResolvedValue([event]);
      queueService.addJob.mockResolvedValue({ id: 'job-null' });
      WebhookEventsDAL.updateStatus.mockResolvedValue({});

      const result = await replayWebhook('ev-40');

      expect(queueService.addJob).toHaveBeenCalledWith(
        'papara-payment',
        'confirm-payment',
        {
          orderId: 'order-70',
          paparaPaymentId: undefined,
          amount: undefined,
          referenceId: 'order-70',
        },
      );
      expect(result.success).toBe(true);
    });
  });

  // ─── getFailedEvents ──────────────────────────────────────────────────────

  describe('getFailedEvents', () => {
    test('delegates to WebhookEventsDAL.getRecent with defaults', async () => {
      const fakeEvents = [{ id: 'ev-1' }, { id: 'ev-2' }];
      WebhookEventsDAL.getRecent.mockResolvedValue(fakeEvents);

      const result = await getFailedEvents();

      expect(WebhookEventsDAL.getRecent).toHaveBeenCalledWith('papara', 'failed', 20);
      expect(result).toEqual(fakeEvents);
    });

    test('passes custom webhook type and limit', async () => {
      WebhookEventsDAL.getRecent.mockResolvedValue([]);

      await getFailedEvents('stripe', 50);

      expect(WebhookEventsDAL.getRecent).toHaveBeenCalledWith('stripe', 'failed', 50);
    });
  });
});
