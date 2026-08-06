const P2POrdersDAL = require('../database/dal/p2pOrders');
const PaparaPaymentsDAL = require('../database/dal/paparaPayments');
const { EVENTS, emit } = require('./eventBus');
const { QUEUE_NAMES, addJob } = require('./queueService');
const { broadcastOrderUpdate } = require('./websocketService');
const logger = require('../utils/logger');

async function processPaparaPayment(data) {
  const { orderId, paparaPaymentId, amount, referenceId } = data;

  logger.info('Processing Papara payment', { orderId, paparaPaymentId, referenceId });

  try {
    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status !== 'matched') {
      logger.warn('Order not in matched state', { orderId, status: order.status });
      return { success: false, orderId, status: order.status, reason: 'invalid_state' };
    }

    const orderAmount = parseFloat(order.amount_try || 0);
    const receivedAmount = parseFloat(amount);
    if (orderAmount > 0 && Math.abs(orderAmount - receivedAmount) > 0.01) {
      logger.warn('Amount mismatch', { orderId, orderAmount, receivedAmount });
      return { success: false, orderId, status: order.status, reason: 'amount_mismatch' };
    }

    await PaparaPaymentsDAL.markProcessed(referenceId, 'completed');

    await P2POrdersDAL.updateOrderStatus(orderId, 'payment_confirmed', {
      papara_payment_id: paparaPaymentId,
      payment_confirmed_at: new Date().toISOString()
    });

    emit(EVENTS.PAPARA_PAYMENT_RECEIVED, {
      orderId,
      paparaPaymentId,
      amount: receivedAmount,
      referenceId
    });

    emit(EVENTS.PAYMENT_CONFIRMED, {
      orderId,
      confirmedBy: 'papara_webhook',
      amountTry: receivedAmount
    });

    broadcastOrderUpdate(orderId, 'payment_confirmed');

    logger.info('Papara payment processed', { orderId });

    return { success: true, orderId, status: 'payment_confirmed' };
  } catch (err) {
    logger.error('Papara payment failed', { orderId, error: err.message });
    throw err;
  }
}

async function queuePaparaPayment(paymentData) {
  return await addJob(QUEUE_NAMES.PAPARA_PAYMENT, 'confirm-payment', paymentData, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true
  });
}

module.exports = { processPaparaPayment, queuePaparaPayment };
