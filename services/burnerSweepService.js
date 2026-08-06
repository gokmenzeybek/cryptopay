const P2POrdersDAL = require('../database/dal/p2pOrders');
const burnerWalletService = require('./burnerWalletService');
const { QUEUE_NAMES, addJob } = require('./queueService');
const logger = require('../utils/logger');

const BATCH_SIZE = 10;
const MAX_CONCURRENT = 3;

/**
 * Process burner wallet sweep.
 * Finds burners whose orders are terminal and destroys them via AccountDelete.
 * @param {Object} data - Job data
 * @returns {Promise<Object>} { processed, destroyed, errors, skipped }
 */
async function processBurnerSweep(data = {}) {
  const startTime = Date.now();
  logger.info('Starting burner wallet sweep');

  try {
    // Get burners ready for destruction (funded, order completed/cancelled, not yet deleted)
    const burners = await P2POrdersDAL.getBurnersForSweep(BATCH_SIZE);

    if (burners.length === 0) {
      logger.debug('No burners to sweep');
      return { processed: 0, destroyed: 0, errors: 0, skipped: 0 };
    }

    logger.info(`Found ${burners.length} burners to sweep`);

    let destroyed = 0;
    let errors = 0;
    let skipped = 0;

    for (let i = 0; i < burners.length; i += MAX_CONCURRENT) {
      const batch = burners.slice(i, i + MAX_CONCURRENT);

      const results = await Promise.allSettled(
        batch.map(burner => destroyBurner(burner))
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          if (result.value === 'skipped') skipped++;
          else destroyed++;
        } else {
          errors++;
          logger.error('Burner destroy failed', { error: result.reason?.message });
        }
      });
    }

    const duration = Date.now() - startTime;
    logger.info('Burner sweep complete', { processed: burners.length, destroyed, errors, skipped, duration });

    return { processed: burners.length, destroyed, errors, skipped };
  } catch (err) {
    logger.error('Burner sweep failed', { error: err.message });
    throw err;
  }
}

/**
 * Destroy a single burner wallet via AccountDelete.
 * @param {Object} burner - { address, order_id, status, funded_at, created_at, deleted_at }
 * @returns {Promise<string>} 'destroyed' or 'skipped'
 */
async function destroyBurner(burner) {
  try {
    if (!burner.address || burner.deleted_at) {
      return 'skipped';
    }

    const result = await burnerWalletService.destroyBurner(burner.address);
    return result ? 'destroyed' : 'skipped';
  } catch (err) {
    logger.error('Burner destroy error', { address: burner.address, error: err.message });
    throw err;
  }
}

module.exports = { processBurnerSweep, destroyBurner };
