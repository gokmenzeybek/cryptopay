/**
 * Queue Workers — registers all background-job processors
 *
 * Call initializeQueues() once during server startup. The function:
 *   1. Registers a BullMQ Worker for each QUEUE_NAMES entry, lazily requiring
 *      the underlying service module so the queue layer has no hard runtime
 *      dependency on workers that may not exist yet.
 *   2. Schedules the repeating jobs that the existing setInterval sweeps are
 *      responsible for today. The setInterval calls themselves are NOT
 *      removed here — that's a follow-up task. Until then, both paths will
 *      run, which is intentional: it lets us roll out the queue while
 *      keeping the current behavior intact.
 */

const { QUEUE_NAMES, createWorker, scheduleJob } = require('./queueService');
const logger = require('../utils/logger');

/**
 * Initialize all queue workers. Call once during server startup.
 */
async function initializeQueues() {
  // Escrow sweep worker
  createWorker(QUEUE_NAMES.ESCROW_SWEEP, async (job) => {
    logger.info('Processing escrow sweep job', { jobId: job.id, data: job.data });
    const { processEscrowSweep } = require('./escrowSweepService');
    return await processEscrowSweep(job.data);
  }, { concurrency: 1 });

  // Burner sweep worker
  createWorker(QUEUE_NAMES.BURNER_SWEEP, async (job) => {
    logger.info('Processing burner sweep job', { jobId: job.id, data: job.data });
    const { processBurnerSweep } = require('./burnerSweepService');
    return await processBurnerSweep(job.data);
  }, { concurrency: 1 });

  // Papara payment worker — concurrency 3, capped at 10 jobs/sec
  createWorker(QUEUE_NAMES.PAPARA_PAYMENT, async (job) => {
    logger.info('Processing Papara payment job', { jobId: job.id, data: job.data });
    const { processPaparaPayment } = require('./paparaPaymentService');
    return await processPaparaPayment(job.data);
  }, { concurrency: 3, limiter: { max: 10, duration: 1000 } });

  // Schedule repeating jobs
  await scheduleJob(QUEUE_NAMES.ESCROW_SWEEP, 'sweep', {}, { every: 3600000 }); // hourly
  await scheduleJob(QUEUE_NAMES.BURNER_SWEEP, 'sweep', {}, { every: 60000 });    // every minute

  logger.info('Queue workers initialized');
}

module.exports = { initializeQueues };
