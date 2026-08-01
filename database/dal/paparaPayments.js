/**
 * Papara Payments Data Access Layer
 * Maps Papara payment referenceIds (P2P_<orderId>_<timestamp>) to p2p_orders
 * for webhook resolution and replay protection.
 */

const { pool } = require('../connection');

class PaparaPaymentsDAL {
  /**
   * Persist a referenceId → order mapping when a Papara payment is initiated
   */
  static async create({ referenceId, orderId, transactionId = null, amountTry = null }) {
    const query = `
      INSERT INTO papara_payments (reference_id, order_id, transaction_id, amount_try)
      VALUES ($1, $2, $3, $4)
      RETURNING id, reference_id, order_id, transaction_id, amount_try, status, created_at, processed_at
    `;
    const result = await pool.query(query, [referenceId, orderId, transactionId, amountTry]);
    return result.rows[0];
  }

  /**
   * Resolve a payment mapping by Papara referenceId
   */
  static async getByReferenceId(referenceId) {
    const query = `
      SELECT id, reference_id, order_id, transaction_id, amount_try, status, created_at, processed_at
      FROM papara_payments
      WHERE reference_id = $1
    `;
    const result = await pool.query(query, [referenceId]);
    return result.rows[0] || null;
  }

  /**
   * Get the most recent payment mapping for an order
   */
  static async getByOrderId(orderId) {
    const query = `
      SELECT id, reference_id, order_id, transaction_id, amount_try, status, created_at, processed_at
      FROM papara_payments
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const result = await pool.query(query, [orderId]);
    return result.rows[0] || null;
  }

  /**
   * Mark a payment mapping as processed (idempotent: only the first call
   * transitions processed_at from NULL and returns a row)
   */
  static async markProcessed(referenceId, status = 'completed') {
    const query = `
      UPDATE papara_payments
      SET status = $2, processed_at = NOW()
      WHERE reference_id = $1 AND processed_at IS NULL
      RETURNING id, reference_id, order_id, status, processed_at
    `;
    const result = await pool.query(query, [referenceId, status]);
    return result.rows[0] || null;
  }
}

module.exports = PaparaPaymentsDAL;
