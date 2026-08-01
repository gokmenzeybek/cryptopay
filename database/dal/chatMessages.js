/**
 * Chat Messages Data Access Layer
 * Stores per-order chat history outside p2p_orders.metadata.
 */

const { pool } = require('../connection');

class ChatMessagesDAL {
  /**
   * Persist a chat message for an order
   */
  static async create({ orderId, sender, text }) {
    const query = `
      INSERT INTO chat_messages (order_id, sender, text)
      VALUES ($1, $2, $3)
      RETURNING id, order_id, sender, text, created_at
    `;
    const result = await pool.query(query, [orderId, sender, text]);
    return result.rows[0];
  }

  /**
   * Fetch recent chat history for an order, bounded to the last N messages
   */
  static async getByOrderId(orderId, { limit = 200, offset = 0 } = {}) {
    const query = `
      SELECT id, order_id, sender, text, created_at
      FROM chat_messages
      WHERE order_id = $1
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [orderId, limit, offset]);
    return result.rows;
  }

  /**
   * Delete the oldest messages for an order, keeping only the most recent N.
   * Returns the number of pruned rows.
   */
  static async prune(orderId, keep = 200) {
    const query = `
      DELETE FROM chat_messages
      WHERE id IN (
        SELECT id FROM chat_messages
        WHERE order_id = $1
        ORDER BY created_at DESC
        OFFSET $2
      )
      RETURNING id
    `;
    const result = await pool.query(query, [orderId, keep]);
    return result.rowCount;
  }
}

module.exports = ChatMessagesDAL;
