/**
 * Tests for services/queueWorkers.js
 *
 * Covers:
 *  - initializeQueues registers escrow/burner/papara workers with expected options
 *  - initializeQueues schedules escrow/burner repeating jobs with correct intervals
 *  - Worker processors log and delegate to underlying services
 *
 * Mocks: queueService, logger, escrowSweepService, burnerSweepService,
 *        paparaPaymentService
 */

// Capture calls at the jest.mock level so that queueWorkers.js destructures
// our mock functions (not the real queueService exports).
const mockCreateWorker = jest.fn();
const mockScheduleJob = jest.fn().mockResolvedValue({ id: 'sched-1' });
let mockEscrowSweep;
let mockBurnerSweep;
let mockPaparaPayment;

jest.mock('../queueService', () => ({
  QUEUE_NAMES: {
    ESCROW_SWEEP: 'escrow-sweep',
    BURNER_SWEEP: 'burner-sweep',
    PAPARA_PAYMENT: 'papara-payment',
    NOTIFICATION: 'notification',
    OUTBOX_PUBLISH: 'outbox-publish',
  },
  createWorker: (...args) => mockCreateWorker(...args),
  scheduleJob: (...args) => mockScheduleJob(...args),
}));

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../escrowSweepService', () => {
  mockEscrowSweep = { processEscrowSweep: jest.fn().mockResolvedValue({ swept: 1 }) };
  return mockEscrowSweep;
});

jest.mock('../burnerSweepService', () => {
  mockBurnerSweep = { processBurnerSweep: jest.fn().mockResolvedValue({ burned: 1 }) };
  return mockBurnerSweep;
});

jest.mock('../paparaPaymentService', () => {
  mockPaparaPayment = { processPaparaPayment: jest.fn().mockResolvedValue({ paid: true }) };
  return mockPaparaPayment;
});

const logger = require('../../utils/logger');
const { initializeQueues } = require('../queueWorkers');

// ─── initializeQueues ──────────────────────────────────────────────────────

describe('initializeQueues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduleJob.mockResolvedValue({ id: 'sched-1' });
  });

  test('registers three workers (escrow, burner, papara)', async () => {
    await initializeQueues();

    expect(mockCreateWorker).toHaveBeenCalledTimes(3);

    // Escrow sweep worker — concurrency 1
    expect(mockCreateWorker).toHaveBeenNthCalledWith(
      1,
      'escrow-sweep',
      expect.any(Function),
      { concurrency: 1 },
    );

    // Burner sweep worker — concurrency 1
    expect(mockCreateWorker).toHaveBeenNthCalledWith(
      2,
      'burner-sweep',
      expect.any(Function),
      { concurrency: 1 },
    );

    // Papara payment worker — concurrency 3, rate limiter
    expect(mockCreateWorker).toHaveBeenNthCalledWith(
      3,
      'papara-payment',
      expect.any(Function),
      { concurrency: 3, limiter: { max: 10, duration: 1000 } },
    );
  });

  test('schedules escrow sweep hourly and burner sweep every minute', async () => {
    await initializeQueues();

    expect(mockScheduleJob).toHaveBeenCalledTimes(2);

    // Escrow: hourly (3600000 ms)
    expect(mockScheduleJob).toHaveBeenNthCalledWith(
      1,
      'escrow-sweep',
      'sweep',
      {},
      { every: 3600000 },
    );

    // Burner: every minute (60000 ms)
    expect(mockScheduleJob).toHaveBeenNthCalledWith(
      2,
      'burner-sweep',
      'sweep',
      {},
      { every: 60000 },
    );
  });

  test('logs "Queue workers initialized" on success', async () => {
    await initializeQueues();

    expect(logger.info).toHaveBeenCalledWith('Queue workers initialized');
  });

  test('escrow worker processor logs and delegates to processEscrowSweep', async () => {
    await initializeQueues();

    // Extract the processor passed to the first createWorker call
    const escrowProcessor = mockCreateWorker.mock.calls[0][1];
    expect(typeof escrowProcessor).toBe('function');

    const fakeJob = { id: 'job-1', data: { ledgerIndex: 123 } };
    const result = await escrowProcessor(fakeJob);

    expect(mockEscrowSweep.processEscrowSweep).toHaveBeenCalledWith({ ledgerIndex: 123 });
    expect(result).toEqual({ swept: 1 });
    expect(logger.info).toHaveBeenCalledWith(
      'Processing escrow sweep job',
      { jobId: 'job-1', data: { ledgerIndex: 123 } },
    );
  });

  test('burner worker processor logs and delegates to processBurnerSweep', async () => {
    await initializeQueues();

    // Extract the processor passed to the second createWorker call
    const burnerProcessor = mockCreateWorker.mock.calls[1][1];
    expect(typeof burnerProcessor).toBe('function');

    const fakeJob = { id: 'job-2', data: { address: 'rAddr' } };
    const result = await burnerProcessor(fakeJob);

    expect(mockBurnerSweep.processBurnerSweep).toHaveBeenCalledWith({ address: 'rAddr' });
    expect(result).toEqual({ burned: 1 });
    expect(logger.info).toHaveBeenCalledWith(
      'Processing burner sweep job',
      { jobId: 'job-2', data: { address: 'rAddr' } },
    );
  });

  test('papara worker processor logs and delegates to processPaparaPayment', async () => {
    await initializeQueues();

    // Extract the processor passed to the third createWorker call
    const paparaProcessor = mockCreateWorker.mock.calls[2][1];
    expect(typeof paparaProcessor).toBe('function');

    const fakeJob = { id: 'job-3', data: { amount: 100, orderId: 5 } };
    const result = await paparaProcessor(fakeJob);

    expect(mockPaparaPayment.processPaparaPayment).toHaveBeenCalledWith({ amount: 100, orderId: 5 });
    expect(result).toEqual({ paid: true });
    expect(logger.info).toHaveBeenCalledWith(
      'Processing Papara payment job',
      { jobId: 'job-3', data: { amount: 100, orderId: 5 } },
    );
  });

  test('papara worker has rate limiter option { max: 10, duration: 1000 }', async () => {
    await initializeQueues();

    const paparaOpts = mockCreateWorker.mock.calls[2][2];
    expect(paparaOpts).toEqual({
      concurrency: 3,
      limiter: { max: 10, duration: 1000 },
    });
  });
});
