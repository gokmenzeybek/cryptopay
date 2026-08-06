/**
 * Tests for services/outboxService.js
 *
 * Covers:
 *  - writeToOutbox: correct query construction, JSON serialization, returns id
 *  - processOutboxEvents: empty batch, successful publish, publish failure marking
 *  - getUnpublishedCount: parsing result from COUNT query
 *
 * Mocks: database/connection (pool), eventBus (emit), logger
 */

// Mock dependencies before requiring the module under test
jest.mock('../../database/connection', () => ({
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
  },
}));

jest.mock('../eventBus', () => ({
  EVENTS: { ORDER_CREATED: 'order:created' },
  emit: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { pool } = require('../../database/connection');
const { emit } = require('../eventBus');
const logger = require('../../utils/logger');
const { writeToOutbox, processOutboxEvents, getUnpublishedCount } = require('../outboxService');

// ─── writeToOutbox ──────────────────────────────────────────────────────────

describe('writeToOutbox', () => {
  test('inserts event with correct query and JSON-serialized payload/metadata', async () => {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [{ id: 42 }] }) };
    const payload = { orderId: 10, amount: 500 };
    const metadata = { source: 'p2p' };

    const id = await writeToOutbox(fakeClient, 'order:created', payload, metadata);

    expect(id).toBe(42);
    expect(fakeClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = fakeClient.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO outbox_events');
    expect(sql).toContain('RETURNING id');
    expect(params[0]).toBe('order:created');
    expect(params[1]).toBe(JSON.stringify(payload));
    expect(params[2]).toBe(JSON.stringify(metadata));
  });

  test('defaults metadata to empty object when omitted', async () => {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };

    const id = await writeToOutbox(fakeClient, 'order:created', { x: 1 });

    expect(id).toBe(1);
    const [, params] = fakeClient.query.mock.calls[0];
    expect(params[2]).toBe('{}');
  });

  test('handles payload with nested objects and arrays', async () => {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [{ id: 99 }] }) };
    const complexPayload = { items: [1, 2, 3], nested: { a: { b: 'deep' } } };

    const id = await writeToOutbox(fakeClient, 'order:created', complexPayload);

    expect(id).toBe(99);
    const [, params] = fakeClient.query.mock.calls[0];
    expect(JSON.parse(params[1])).toEqual(complexPayload);
  });
});

// ─── processOutboxEvents ────────────────────────────────────────────────────

describe('processOutboxEvents', () => {
  let fakeClient;

  beforeEach(() => {
    fakeClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(fakeClient);
  });

  test('returns zeros when no pending events exist', async () => {
    // First query (SELECT FOR UPDATE) returns empty rows
    fakeClient.query.mockResolvedValueOnce({ rows: [] });

    const result = await processOutboxEvents();

    expect(result).toEqual({ processed: 0, published: 0, failed: 0 });
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    // Should NOT have issued an update query for individual events
    expect(fakeClient.query).toHaveBeenCalledTimes(1);
  });

  test('publishes each event via emit and marks as published', async () => {
    const events = [
      { id: 1, event_type: 'order:created', payload: { orderId: 1 }, metadata: {}, created_at: '2025-01-01T00:00:00Z' },
      { id: 2, event_type: 'order:created', payload: { orderId: 2 }, metadata: { src: 'test' }, created_at: '2025-01-01T00:01:00Z' },
    ];

    fakeClient.query
      .mockResolvedValueOnce({ rows: events })           // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] })                // UPDATE published id=1
      .mockResolvedValueOnce({ rows: [] });               // UPDATE published id=2

    const result = await processOutboxEvents();

    expect(result).toEqual({ processed: 2, published: 2, failed: 0 });
    expect(emit).toHaveBeenCalledTimes(2);

    // First emit call
    expect(emit).toHaveBeenNthCalledWith(1, 'order:created', {
      type: 'order:created',
      payload: events[0].payload,
      metadata: events[0].metadata,
      timestamp: events[0].created_at,
    });

    // Verify published-at update queries
    const updateCalls = fakeClient.query.mock.calls.slice(1);
    expect(updateCalls[0][0]).toContain("SET status = $1, published_at = NOW()");
    expect(updateCalls[0][1]).toEqual(['published', 1]);
    expect(updateCalls[1][1]).toEqual(['published', 2]);

    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('marks event as failed when emit throws and continues processing', async () => {
    const events = [
      { id: 10, event_type: 'order:created', payload: {}, metadata: {}, created_at: '2025-01-01' },
      { id: 11, event_type: 'order:created', payload: {}, metadata: {}, created_at: '2025-01-01' },
    ];

    // emit throws for the first event, succeeds for the second
    emit
      .mockImplementationOnce(() => { throw new Error('emit exploded'); })
      .mockImplementationOnce(() => ({}));

    fakeClient.query
      .mockResolvedValueOnce({ rows: events })    // SELECT
      .mockResolvedValueOnce({ rows: [] })         // UPDATE failed id=10
      .mockResolvedValueOnce({ rows: [] });        // UPDATE published id=11

    const result = await processOutboxEvents();

    expect(result).toEqual({ processed: 2, published: 1, failed: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      'Outbox event publish failed',
      expect.objectContaining({ eventId: 10, error: 'emit exploded' }),
    );

    // Failed event gets status='failed' with truncated error
    const failedUpdate = fakeClient.query.mock.calls[1];
    expect(failedUpdate[0]).toContain("SET status = $1, last_error = $2");
    expect(failedUpdate[1][0]).toBe('failed');
    expect(failedUpdate[1][1]).toBe('emit exploded');
    expect(failedUpdate[1][2]).toBe(10);

    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  test('truncates last_error to 500 characters', async () => {
    const longError = 'x'.repeat(600);
    const events = [
      { id: 20, event_type: 'order:created', payload: {}, metadata: {}, created_at: '2025-01-01' },
    ];

    emit.mockImplementationOnce(() => { throw new Error(longError); });
    fakeClient.query
      .mockResolvedValueOnce({ rows: events })
      .mockResolvedValueOnce({ rows: [] });

    await processOutboxEvents();

    const failedUpdate = fakeClient.query.mock.calls[1];
    expect(failedUpdate[1][1].length).toBe(500);
  });

  test('releases client even when the initial query throws', async () => {
    fakeClient.query.mockRejectedValueOnce(new Error('db down'));

    await expect(processOutboxEvents()).rejects.toThrow('db down');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });
});

// ─── getUnpublishedCount ────────────────────────────────────────────────────

describe('getUnpublishedCount', () => {
  test('returns parsed integer count from pool.query', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: '7' }] });

    const count = await getUnpublishedCount();

    expect(count).toBe(7);
    expect(typeof count).toBe('number');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("COUNT(*) FROM outbox_events WHERE status = 'pending'"),
    );
  });

  test('returns zero when count is "0"', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const count = await getUnpublishedCount();

    expect(count).toBe(0);
  });

  test('handles large count values', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: '150000' }] });

    const count = await getUnpublishedCount();

    expect(count).toBe(150000);
  });
});
