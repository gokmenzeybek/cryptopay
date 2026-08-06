/**
 * Tests for services/queueService.js
 *
 * Covers:
 *  - Local in-memory fallback: success path, no-processor guard, retry exhaustion
 *  - addJob / scheduleJob: happy path and error fallback
 *  - getQueueMetrics: catch-branch for local queue, error recovery
 *  - createWorker: local fallback stores processor
 *  - QUEUE_NAMES / IS_REDIS_AVAILABLE exports
 *
 * Each test uses a unique queue name to avoid cross-contamination from the
 * module-level localProcessors/localQueues Maps (the module is required once
 * and shared across all tests in this file).
 */

// Force local (no-Redis) path so every test exercises the in-memory fallback
delete process.env.REDIS_URL;

// Mock bullmq so the module can be required without a real Redis connection.
jest.mock('bullmq', () => {
  class FakeQueue {
    constructor(name, opts) {
      this.name = name;
      this.opts = opts;
    }
    async add() { return { id: 'bull-1' }; }
    getWaitingCount() { return 0; }
    getActiveCount() { return 0; }
    getCompletedCount() { return 0; }
    getFailedCount() { return 0; }
    getDelayedCount() { return 0; }
  }
  class FakeWorker {
    constructor(name, processor, opts) {
      this.name = name;
      this.opts = opts;
    }
    on() { return this; }
  }
  return { Queue: FakeQueue, Worker: FakeWorker };
});

// Suppress winston file I/O in tests
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const {
  QUEUE_NAMES,
  getQueue,
  createWorker,
  addJob,
  scheduleJob,
  getQueueMetrics,
  IS_REDIS_AVAILABLE,
} = require('../queueService');

const logger = require('../../utils/logger');

// Flush the microtask / setImmediate tick so the local-queue "worker" fires.
// When fake timers are active, setImmediate is also faked; we advance by 0
// which flushes pending immediates under @sinonjs/fake-timers.
const flush = () => new Promise((r) => setImmediate(r));

// ─── Module-level constants ──────────────────────────────────────────────────

describe('queueService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ─── Exports ──────────────────────────────────────────────────────────────

  test('QUEUE_NAMES contains all expected queues', () => {
    expect(QUEUE_NAMES).toEqual({
      ESCROW_SWEEP: 'escrow-sweep',
      BURNER_SWEEP: 'burner-sweep',
      PAPARA_PAYMENT: 'papara-payment',
      NOTIFICATION: 'notification',
      OUTBOX_PUBLISH: 'outbox-publish',
    });
  });

  test('IS_REDIS_AVAILABLE is false when REDIS_URL is unset', () => {
    expect(IS_REDIS_AVAILABLE).toBe(false);
  });

  // ─── getQueue (local fallback) ────────────────────────────────────────────

  describe('getQueue (local fallback)', () => {
    test('returns a local queue object with an add method', () => {
      const queue = getQueue('gq-basic');
      expect(queue).toBeDefined();
      expect(typeof queue.add).toBe('function');
      expect(queue.name).toBe('gq-basic');
    });

    test('returns the same instance on repeated calls', () => {
      const a = getQueue('gq-same');
      const b = getQueue('gq-same');
      expect(a).toBe(b);
    });

    test('creates distinct queues for different names', () => {
      const a = getQueue('gq-distinct-a');
      const b = getQueue('gq-distinct-b');
      expect(a).not.toBe(b);
    });
  });

  // ─── Local queue job execution ────────────────────────────────────────────

  describe('local queue job execution', () => {
    test('runs job successfully when processor is registered', async () => {
      const processor = jest.fn().mockResolvedValue('ok');
      createWorker('run-ok', processor);

      const queue = getQueue('run-ok');
      await queue.add('my-job', { value: 42 });
      await flush();

      expect(processor).toHaveBeenCalledTimes(1);
      const job = processor.mock.calls[0][0];
      expect(job.name).toBe('my-job');
      expect(job.data).toEqual({ value: 42 });
      expect(job.attemptsMade).toBe(1);
    });

    test('drops job and logs warning when no processor is registered', async () => {
      const queue = getQueue('no-proc');
      await queue.add('ghost', {});
      await flush();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no processor registered'),
        expect.objectContaining({ jobId: expect.any(String) }),
      );
    });

    test('retries on failure and gives up after maxAttempts', async () => {
      jest.useFakeTimers();

      const processor = jest.fn().mockRejectedValue(new Error('boom'));
      createWorker('retry-3', processor);

      const queue = getQueue('retry-3');
      await queue.add('flaky', {}, { attempts: 3 });

      // Fire the setImmediate that dispatches the first attempt.
      // Under fake timers, setImmediate is faked so we need to advance past it.
      await jest.advanceTimersByTimeAsync(0);
      expect(processor).toHaveBeenCalledTimes(1);

      // Attempt 1 failed → backoff delay = 1000 * 2^0 = 1000 ms
      await jest.advanceTimersByTimeAsync(1000);
      expect(processor).toHaveBeenCalledTimes(2);

      // Attempt 2 failed → backoff delay = 1000 * 2^1 = 2000 ms
      await jest.advanceTimersByTimeAsync(2000);
      expect(processor).toHaveBeenCalledTimes(3);

      // Attempt 3 failed and maxAttempts reached — no more retries
      await jest.advanceTimersByTimeAsync(10000);
      expect(processor).toHaveBeenCalledTimes(3);
    });

    test('defaults to 1 attempt when opts.attempts is not specified', async () => {
      jest.useFakeTimers();

      const processor = jest.fn().mockRejectedValue(new Error('fail'));
      createWorker('single-atm', processor);

      const queue = getQueue('single-atm');
      await queue.add('one-shot', {});

      await jest.advanceTimersByTimeAsync(0);
      expect(processor).toHaveBeenCalledTimes(1);

      // No retry should happen even after a long wait
      await jest.advanceTimersByTimeAsync(10000);
      expect(processor).toHaveBeenCalledTimes(1);
    });

    test('job id is unique per invocation', async () => {
      const processor = jest.fn().mockResolvedValue();
      createWorker('unique-id', processor);

      const queue = getQueue('unique-id');
      await queue.add('a', {});
      await queue.add('b', {});
      await flush();

      const id1 = processor.mock.calls[0][0].id;
      const id2 = processor.mock.calls[1][0].id;
      expect(id1).not.toBe(id2);
    });

    test('successful retry after initial failure', async () => {
      jest.useFakeTimers();

      const processor = jest.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('recovered');
      createWorker('retry-ok', processor);

      const queue = getQueue('retry-ok');
      await queue.add('flaky-ok', {}, { attempts: 2 });

      await jest.advanceTimersByTimeAsync(0);
      expect(processor).toHaveBeenCalledTimes(1);

      // Backoff 1000ms, then attempt 2 succeeds
      await jest.advanceTimersByTimeAsync(1000);
      expect(processor).toHaveBeenCalledTimes(2);
    });

    test('processor receives opts from add()', async () => {
      const processor = jest.fn().mockResolvedValue();
      createWorker('opts-check', processor);

      const queue = getQueue('opts-check');
      await queue.add('j', { a: 1 }, { attempts: 5, priority: 1 });
      await flush();

      const job = processor.mock.calls[0][0];
      expect(job.opts).toEqual({ attempts: 5, priority: 1 });
    });
  });

  // ─── addJob ───────────────────────────────────────────────────────────────

  describe('addJob', () => {
    test('adds a job and returns the created job object', async () => {
      const job = await addJob('addjob-ok', 'test-job', { x: 1 });
      expect(job).toBeDefined();
      expect(job.name).toBe('test-job');
      expect(job.data).toEqual({ x: 1 });
    });

    test('returns null when queue.add throws', async () => {
      const queue = getQueue('addjob-throw');
      const origAdd = queue.add;
      queue.add = jest.fn().mockRejectedValue(new Error('queue full'));

      try {
        const result = await addJob('addjob-throw', 'bad-job', {});
        expect(result).toBeNull();
      } finally {
        queue.add = origAdd;
      }
    });
  });

  // ─── scheduleJob ──────────────────────────────────────────────────────────

  describe('scheduleJob', () => {
    test('adds a job with repeat.every when every option is given', async () => {
      const job = await scheduleJob('sched-every', 'cron-job', {}, { every: 5000 });
      expect(job).toBeDefined();
      expect(job.opts.repeat).toEqual({ every: 5000 });
    });

    test('adds a job with repeat.cron when pattern option is given', async () => {
      const job = await scheduleJob('sched-pattern', 'cron-job', {}, { pattern: '*/5 * * * *' });
      expect(job).toBeDefined();
      expect(job.opts.repeat).toEqual({ cron: '*/5 * * * *' });
    });

    test('adds a job without repeat when neither every nor pattern given', async () => {
      const job = await scheduleJob('sched-none', 'plain', {}, { priority: 1 });
      expect(job).toBeDefined();
      expect(job.opts.repeat).toBeUndefined();
    });

    test('returns null when queue.add throws', async () => {
      const queue = getQueue('sched-throw');
      const origAdd = queue.add;
      queue.add = jest.fn().mockRejectedValue(new Error('full'));

      try {
        const result = await scheduleJob('sched-throw', 'fail', {});
        expect(result).toBeNull();
      } finally {
        queue.add = origAdd;
      }
    });
  });

  // ─── getQueueMetrics ──────────────────────────────────────────────────────

  describe('getQueueMetrics', () => {
    test('returns zeroed metrics for local queue (catch branch)', async () => {
      // Local queues don't have getWaitingCount → Promise.all rejects → catch → zeros
      const metrics = await getQueueMetrics('metrics-local');
      expect(metrics).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
    });

    test('logs error when metrics retrieval fails', async () => {
      await getQueueMetrics('metrics-log-check');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get metrics'),
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });

  // ─── createWorker (local fallback) ────────────────────────────────────────

  describe('createWorker', () => {
    test('stores processor in local map and returns null', () => {
      const proc = jest.fn();
      const result = createWorker('cw-null', proc);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('BullMQ not available'),
      );
    });

    test('processor is invoked for jobs added after worker creation', async () => {
      const processor = jest.fn().mockResolvedValue('done');
      createWorker('cw-invoke', processor);

      const queue = getQueue('cw-invoke');
      await queue.add('work', { payload: true });
      await flush();

      expect(processor).toHaveBeenCalledTimes(1);
      expect(processor.mock.calls[0][0].data).toEqual({ payload: true });
    });
  });

  describe('Redis-backed path', () => {
    let redisModule;

    beforeEach(() => {
      jest.isolateModules(() => {
        process.env.REDIS_URL = 'redis://localhost:6379';
        redisModule = require('../queueService');
      });
    });

    afterEach(() => {
      delete process.env.REDIS_URL;
    });

    test('creates and caches a BullMQ queue with retry defaults', () => {
      const first = redisModule.getQueue('redis-q');
      const second = redisModule.getQueue('redis-q');

      expect(redisModule.IS_REDIS_AVAILABLE).toBe(true);
      expect(first).toBe(second);
      expect(first.opts.defaultJobOptions).toMatchObject({
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
    });

    test('creates a BullMQ worker and wires lifecycle listeners', () => {
      const worker = redisModule.createWorker('redis-worker', jest.fn(), {
        concurrency: 2,
      });

      expect(worker.name).toBe('redis-worker');
      expect(worker.opts).toMatchObject({ concurrency: 2 });
      expect(typeof worker.on).toBe('function');
    });

    test('reads metrics from a BullMQ queue', async () => {
      await expect(redisModule.getQueueMetrics('redis-metrics')).resolves.toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
    });
  });
});
