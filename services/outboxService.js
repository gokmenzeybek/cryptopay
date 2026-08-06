/**
 * Outbox Service
 *
 * Transactional outbox for reliable event publication. Domain handlers call
 * `writeToOutbox()` inside their existing transaction; a background sweeper
 * (`processOutboxEvents`) drains pending rows and re-emits them via the
 * in-process eventBus. This guarantees at-least-once delivery even if the
 * process crashes between the database write and the in-process publish.
 */

const { pool } = require('../database/connection');
const { EVENTS, emit } = require('./eventBus');
const logger = require('../utils/logger');

const MAX_PUBLISH_ATTEMPTS = 5;
const BATCH_SIZE = 50;

/**
 * Write event to outbox within an existing transaction.
 * @param {Object} dbClient - pg PoolClient from transaction
 * @param {string} eventType - One of EVENTS constants
 * @param {Object} payload - Event data
 * @param {Object} [metadata] - Additional metadata
 * @returns {Promise<number>} The outbox event ID
 */
async function writeToOutbox(dbClient, eventType, payload, metadata = {}) {
  const query = `INSERT INTO outbox_events (event_type, payload, metadata) VALUES ($1, $2, $3) RETURNING id`;
  const result = await dbClient.query(query, [eventType, JSON.stringify(payload), JSON.stringify(metadata)]);
  return result.rows[0].id;
}

/**
 * Process unpublished outbox events (called by sweeper).
 * @returns {Promise<Object>} { processed, published, failed }
 */
async function processOutboxEvents() {
  const query = `
    UPDATE outbox_events
    SET status = 'publishing', publish_attempts = publish_attempts + 1
    WHERE id IN (
      SELECT id FROM outbox_events
      WHERE status = 'pending' AND publish_attempts < $1
      ORDER BY created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, event_type, payload, metadata, created_at
  `;

  const client = await pool.connect();
  try {
    const { rows } = await client.query(query, [MAX_PUBLISH_ATTEMPTS, BATCH_SIZE]);
    if (rows.length === 0) return { processed: 0, published: 0, failed: 0 };

    let published = 0, failed = 0;

    for (const event of rows) {
      try {
        emit(event.event_type, {
          type: event.event_type,
          payload: event.payload,
          metadata: event.metadata,
          timestamp: event.created_at
        });

        await client.query(
          'UPDATE outbox_events SET status = $1, published_at = NOW() WHERE id = $2',
          ['published', event.id]
        );
        published++;
      } catch (err) {
        logger.error('Outbox event publish failed', { eventId: event.id, error: err.message });
        await client.query(
          'UPDATE outbox_events SET status = $1, last_error = $2 WHERE id = $3',
          ['failed', err.message.substring(0, 500), event.id]
        );
        failed++;
      }
    }

    return { processed: rows.length, published, failed };
  } finally {
    client.release();
  }
}

/**
 * Count unpublished events.
 * @returns {Promise<number>}
 */
async function getUnpublishedCount() {
  const result = await pool.query("SELECT COUNT(*) FROM outbox_events WHERE status = 'pending'");
  return parseInt(result.rows[0].count);
}

module.exports = { writeToOutbox, processOutboxEvents, getUnpublishedCount };
