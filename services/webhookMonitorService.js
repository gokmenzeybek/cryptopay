const WebhookEventsDAL = require('../database/dal/webhookEvents');
const { QUEUE_NAMES, addJob, getQueueMetrics } = require('./queueService');
const logger = require('../utils/logger');

async function getWebhookStats(webhookType = 'papara') {
  const [received, accepted, rejected, processing, completed, failed] = await Promise.all([
    WebhookEventsDAL.countByStatus(webhookType, 'received'),
    WebhookEventsDAL.countByStatus(webhookType, 'accepted'),
    WebhookEventsDAL.countByStatus(webhookType, 'rejected'),
    WebhookEventsDAL.countByStatus(webhookType, 'processing'),
    WebhookEventsDAL.countByStatus(webhookType, 'completed'),
    WebhookEventsDAL.countByStatus(webhookType, 'failed')
  ]);

  let queueMetrics = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  try {
    queueMetrics = await getQueueMetrics(QUEUE_NAMES.PAPARA_PAYMENT);
  } catch (err) { /* ignore */ }

  return {
    webhookType,
    events: { received, accepted, rejected, processing, completed, failed },
    queue: queueMetrics,
    successRate: received > 0 ? ((completed / received) * 100).toFixed(1) + '%' : 'N/A'
  };
}

async function replayWebhook(eventId) {
  const events = await WebhookEventsDAL.getRecent('papara', 'failed', 100);
  const event = events.find(e => e.id === eventId);

  if (!event) {
    throw new Error(`Webhook event not found: ${eventId}`);
  }

  const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;

  const job = await addJob(QUEUE_NAMES.PAPARA_PAYMENT, 'confirm-payment', {
    orderId: event.reference_id,
    paparaPaymentId: payload?.transaction_id,
    amount: payload?.amount,
    referenceId: event.reference_id
  });

  await WebhookEventsDAL.updateStatus(eventId, 'processing');

  return { success: true, jobId: job?.id };
}

async function getFailedEvents(webhookType = 'papara', limit = 20) {
  return await WebhookEventsDAL.getRecent(webhookType, 'failed', limit);
}

module.exports = {
  getWebhookStats,
  replayWebhook,
  getFailedEvents
};
