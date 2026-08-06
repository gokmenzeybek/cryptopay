/**
 * Queue Service — BullMQ-backed background job runner
 *
 * Centralized job queue manager. When REDIS_URL is configured we get the full
 * BullMQ feature set (retries, exponential backoff, dead-letter via failed
 * jobs, cron-like repeats, distributed workers, rate limiting, metrics).
 * When REDIS_URL is unset (local dev, tests, single-node deploys) every API
 * call transparently falls back to an in-memory queue so callers do not have
 * to know whether Redis is present.
 *
 * This file is the single BullMQ touchpoint; the rest of the codebase only
 * ever imports QUEUE_NAMES and the helpers below.
 */

const { Queue, Worker } = require('bullmq');
const logger = require('../utils/logger');

// ─── Redis connection config (mirrors services/redisClient.js) ──────────────
// BullMQ accepts the same ioredis-compatible options as our existing client.
const REDIS_URL = process.env.REDIS_URL;
const IS_REDIS_AVAILABLE = !!REDIS_URL;

const connection = REDIS_URL
  ? { url: REDIS_URL }
  : { host: 'localhost', port: 6379 }; // fallback for local dev

// ─── Queue registry ──────────────────────────────────────────────────────────
const QUEUE_NAMES = {
  ESCROW_SWEEP: 'escrow-sweep',
  BURNER_SWEEP: 'burner-sweep',
  PAPARA_PAYMENT: 'papara-payment',
  NOTIFICATION: 'notification',
  OUTBOX_PUBLISH: 'outbox-publish'
};

// ─── In-memory fallback state ────────────────────────────────────────────────
// queue name -> local queue object
const localQueues = new Map();
// queue name -> registered processor (used by the local fallback "worker")
const localProcessors = new Map();
// BullMQ Queue instance cache — prevents connection leaks from repeated new Queue() calls
const queueCache = new Map();

/**
 * Create or get a BullMQ queue.
 * @param {string} name - Queue name from QUEUE_NAMES
 * @param {Object} options - BullMQ Queue options
 * @returns {Queue|Object} BullMQ Queue or in-memory fallback
 */
function getQueue(name, options = {}) {
  if (!IS_REDIS_AVAILABLE) {
    if (!localQueues.has(name)) {
      localQueues.set(name, createLocalQueue(name));
    }
    return localQueues.get(name);
  }

  // Cache BullMQ Queue instances to prevent connection leaks
  if (!queueCache.has(name)) {
    queueCache.set(name, new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 50,
        ...options.defaultJobOptions
      }
    }));
  }
  return queueCache.get(name);
}

/**
 * Create a local in-memory queue fallback (no Redis).
 * Provides the same add() surface as BullMQ for graceful degradation. Local
 * jobs are dispatched to the registered processor (see createWorker) using
 * setImmediate so they run on the next tick rather than blocking the caller.
 */
function createLocalQueue(name) {
  const jobs = [];

  async function add(jobName, data, opts = {}) {
    const job = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: jobName,
      data,
      opts,
      timestamp: Date.now(),
      attemptsMade: 0
    };
    jobs.push(job);
    setImmediate(() => runLocalJob(name, job));
    return job;
  }

  return { add, name, jobs };
}

/**
 * Run a single job against the registered local processor. Honors attempts +
 * exponential backoff so the local fallback behaves like BullMQ's failure
 * handling (best-effort, no persistence — jobs are lost on process exit).
 */
async function runLocalJob(queueName, job) {
  const processor = localProcessors.get(queueName);
  if (!processor) {
    logger.warn(`Local queue ${queueName} has no processor registered; dropping job`, { jobId: job.id });
    return;
  }
  const maxAttempts = (job.opts && job.opts.attempts) || 1;
  let attempt = 0;
  // Exponential backoff delay in ms, starting at 1000
  const baseDelay = 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    job.attemptsMade = attempt;
    try {
      await processor(job);
      logger.debug(`Local queue ${queueName} job completed`, { jobId: job.id, name: job.name });
      return;
    } catch (err) {
      logger.error(`Local queue ${queueName} job failed`, {
        jobId: job.id,
        name: job.name,
        attempt,
        maxAttempts,
        error: err.message
      });
      if (attempt >= maxAttempts) return;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Create a worker for a queue.
 * @param {string} name - Queue name
 * @param {Function} processor - async (job) => result
 * @param {Object} options - BullMQ Worker options
 * @returns {Worker|null} BullMQ Worker or null (local fallback)
 */
function createWorker(name, processor, options = {}) {
  if (!IS_REDIS_AVAILABLE) {
    logger.warn(`BullMQ not available, worker for ${name} will use local fallback`);
    localProcessors.set(name, processor);
    return null;
  }

  const worker = new Worker(name, processor, {
    connection,
    concurrency: options.concurrency || 5,
    limiter: options.limiter, // { max, duration } for rate limiting
    ...options
  });

  worker.on('failed', (job, err) => {
    logger.error(`Queue ${name} job failed`, { jobId: job && job.id, error: err.message });
  });

  worker.on('completed', (job) => {
    logger.debug(`Queue ${name} job completed`, { jobId: job.id });
  });

  return worker;
}

/**
 * Add a job to a queue.
 * @param {string} queueName - Queue name from QUEUE_NAMES
 * @param {string} jobName - Job name/type
 * @param {Object} data - Job payload
 * @param {Object} opts - Job options (delay, priority, attempts, etc.)
 * @returns {Promise<Object|null>} Created job (BullMQ Job or local-fallback object) or null on failure
 */
async function addJob(queueName, jobName, data, opts = {}) {
  const queue = getQueue(queueName);
  if (!queue) return null;

  try {
    return await queue.add(jobName, data, opts);
  } catch (err) {
    logger.error(`Failed to add job to ${queueName}`, { error: err.message });
    return null;
  }
}

/**
 * Schedule a repeating job (cron-like).
 * @param {string} queueName - Queue name
 * @param {string} jobName - Job name
 * @param {Object} data - Job payload
 * @param {Object} opts - Repeat options ({ every: ms } or { pattern: cron })
 */
async function scheduleJob(queueName, jobName, data, opts = {}) {
  const queue = getQueue(queueName);
  if (!queue) return null;

  try {
    const { every, pattern, ...restOpts } = opts;
    return await queue.add(jobName, data, {
      repeat: every ? { every } : pattern ? { cron: pattern } : undefined,
      ...restOpts
    });
  } catch (err) {
    logger.error(`Failed to schedule job on ${queueName}`, { error: err.message });
    return null;
  }
}

/**
 * Get queue metrics.
 * @param {string} queueName - Queue name
 * @returns {Promise<Object>} { waiting, active, completed, failed, delayed }
 */
async function getQueueMetrics(queueName) {
  const queue = getQueue(queueName);
  if (!queue) return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);
    return { waiting, active, completed, failed, delayed };
  } catch (err) {
    logger.error(`Failed to get metrics for ${queueName}`, { error: err.message });
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }
}

module.exports = {
  QUEUE_NAMES,
  getQueue,
  createWorker,
  addJob,
  scheduleJob,
  getQueueMetrics,
  IS_REDIS_AVAILABLE
};
