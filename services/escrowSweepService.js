/**
 * Escrow Sweep Service
 *
 * Processes expired locked escrows by checking the XRPL ledger and updating
 * order status accordingly. Designed to be invoked via the queueService
 * (QUEUE_NAMES.ESCROW_SWEEP) rather than a raw setInterval.
 */

const P2POrdersDAL = require('../database/dal/p2pOrders');
const xrplVerificationService = require('./xrplVerificationService');
const xrplClientService = require('./xrplClientService');
const { EVENTS, emit } = require('./eventBus');
const logger = require('../utils/logger');

const MAX_CONCURRENT_XRPL = 5;

/**
 * Process escrow expiry sweep.
 * @param {Object} data - Job data
 * @returns {Promise<Object>} { processed, expired, errors }
 */
async function processEscrowSweep(data = {}) {
  const startTime = Date.now();
  logger.info('Starting escrow sweep');

  try {
    const expiredOrders = await P2POrdersDAL.getExpiredLockedEscrows();

    if (expiredOrders.length === 0) {
      logger.debug('No expired escrows to process');
      return { processed: 0, expired: 0, errors: 0 };
    }

    logger.info(`Found ${expiredOrders.length} expired escrows`);

    let expired = 0;
    let errors = 0;

    for (let i = 0; i < expiredOrders.length; i += MAX_CONCURRENT_XRPL) {
      const batch = expiredOrders.slice(i, i + MAX_CONCURRENT_XRPL);

      const results = await Promise.allSettled(
        batch.map(order => processExpiredEscrow(order))
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          expired++;
        } else if (result.status === 'rejected') {
          errors++;
          logger.error('Escrow expiry failed', { error: result.reason?.message });
        }
      });
    }

    const duration = Date.now() - startTime;
    logger.info('Escrow sweep complete', { processed: expiredOrders.length, expired, errors, duration });

    return { processed: expiredOrders.length, expired, errors };
  } catch (err) {
    logger.error('Escrow sweep failed', { error: err.message });
    throw err;
  }
}

/**
 * Process a single expired escrow.
 * @param {Object} order - The expired order
 * @returns {Promise<boolean>}
 */
async function processExpiredEscrow(order) {
  try {
    const client = await xrplClientService.getClient();
    const exists = await xrplVerificationService.escrowExistsOnLedger(client, {
      owner: order.escrow_owner || order.escrow_address,
      transactionHash: order.escrow_transaction_hash || order.escrow_tx_hash
    });

    if (!exists) {
      await P2POrdersDAL.updateEscrow(order.id, { escrow_status: 'completed_on_chain' });
      return true;
    }

    await P2POrdersDAL.updateOrderStatus(order.id, 'expired', {
      expired_at: new Date().toISOString()
    });

    emit(EVENTS.ORDER_CANCELLED, {
      orderId: order.id,
      reason: 'escrow_expired',
      cancelledBy: 'system'
    });

    return true;
  } catch (err) {
    logger.error('Failed to process expired escrow', { orderId: order.id, error: err.message });
    throw err;
  }
}

module.exports = { processEscrowSweep, processExpiredEscrow };
