/**
 * Payment Requests Data Access Layer
 * Handles all database operations for payment requests
 */

const { pool } = require('../connection');

class PaymentRequestsDAL {
  /**
   * Get all payment requests with pagination
   */
  static async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT id, request_id, from_address, to_address, amount_xrp, memo, 
             status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
      FROM payment_requests
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get payment request by request_id
   */
  static async getByRequestId(request_id) {
    const query = `
      SELECT id, request_id, from_address, to_address, amount_xrp, memo, 
             status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
      FROM payment_requests
      WHERE request_id = $1
    `;
    const result = await pool.query(query, [request_id]);
    return result.rows[0] || null;
  }

  /**
   * Get payment requests by address
   */
  static async getByAddress(address, limit = 50, offset = 0) {
    const query = `
      SELECT id, request_id, from_address, to_address, amount_xrp, memo, 
             status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
      FROM payment_requests
      WHERE from_address = $1 OR to_address = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [address, limit, offset]);
    return result.rows;
  }

  /**
   * Get payment requests by status
   */
  static async getByStatus(status, limit = 50, offset = 0) {
    const query = `
      SELECT id, request_id, from_address, to_address, amount_xrp, memo, 
             status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
      FROM payment_requests
      WHERE status = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [status, limit, offset]);
    return result.rows;
  }

  /**
   * Create a new payment request
   */
  static async create(requestData) {
    const {
      request_id,
      from_address,
      to_address,
      amount_xrp,
      memo,
      qr_code_data,
      expires_at
    } = requestData;

    const query = `
      INSERT INTO payment_requests (request_id, from_address, to_address, amount_xrp, 
                                  memo, qr_code_data, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (request_id) DO UPDATE SET
        from_address = EXCLUDED.from_address,
        to_address = EXCLUDED.to_address,
        amount_xrp = EXCLUDED.amount_xrp,
        memo = EXCLUDED.memo,
        qr_code_data = EXCLUDED.qr_code_data,
        expires_at = EXCLUDED.expires_at
      RETURNING id, request_id, from_address, to_address, amount_xrp, memo, 
                status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
    `;

    const result = await pool.query(query, [
      request_id, from_address, to_address, amount_xrp, 
      memo, qr_code_data, expires_at
    ]);
    return result.rows[0];
  }

  /**
   * Update payment request status
   */
  static async updateStatus(request_id, status, transaction_hash = null) {
    const query = `
      UPDATE payment_requests 
      SET status = $2,
          paid_at = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
          transaction_hash = COALESCE($3, transaction_hash),
          updated_at = NOW()
      WHERE request_id = $1
      RETURNING id, request_id, from_address, to_address, amount_xrp, memo, 
                status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
    `;

    const result = await pool.query(query, [request_id, status, transaction_hash]);
    return result.rows[0] || null;
  }

  /**
   * Mark payment request as paid
   */
  static async markAsPaid(request_id, transaction_hash) {
    const query = `
      UPDATE payment_requests 
      SET status = 'paid',
          paid_at = NOW(),
          transaction_hash = $2,
          updated_at = NOW()
      WHERE request_id = $1 AND status = 'pending'
      RETURNING id, request_id, from_address, to_address, amount_xrp, memo, 
                status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
    `;

    const result = await pool.query(query, [request_id, transaction_hash]);
    return result.rows[0] || null;
  }

  /**
   * Get expired payment requests
   */
  static async getExpired() {
    const query = `
      SELECT id, request_id, from_address, to_address, amount_xrp, memo, 
             status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
      FROM payment_requests
      WHERE status = 'pending' AND expires_at < NOW()
      ORDER BY expires_at ASC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Clean up expired payment requests
   */
  static async cleanupExpired() {
    const query = `
      UPDATE payment_requests 
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'pending' AND expires_at < NOW()
      RETURNING id, request_id, from_address, to_address, amount_xrp, memo, 
                status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
    `;

    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Get payment request statistics
   */
  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total_requests,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_requests,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_requests,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_requests,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_requests_24h,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_xrp END), 0) as total_paid_xrp,
        COALESCE(AVG(CASE WHEN status = 'paid' THEN amount_xrp END), 0) as avg_request_amount,
        MIN(created_at) as first_request,
        MAX(created_at) as last_request
      FROM payment_requests
    `;

    const result = await pool.query(query);
    return result.rows[0];
  }

  /**
   * Delete payment request
   */
  static async delete(request_id) {
    const query = `
      DELETE FROM payment_requests 
      WHERE request_id = $1
      RETURNING id, request_id, from_address, to_address, amount_xrp, memo, 
                status, qr_code_data, expires_at, created_at, paid_at, transaction_hash
    `;

    const result = await pool.query(query, [request_id]);
    return result.rows[0] || null;
  }

  /**
   * Get payment requests filtered by status with pagination
   */
  static async getFiltered({ status = null, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const query = `
      SELECT id, request_id, from_address, to_address, amount_xrp, memo, status,
             qr_code_data, expires_at, created_at, paid_at, transaction_hash
      FROM payment_requests
      ${where}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get total payment request count
   */
  static async getCount() {
    const result = await pool.query('SELECT COUNT(*) as count FROM payment_requests');
    return parseInt(result.rows[0].count, 10);
  }
}

module.exports = PaymentRequestsDAL;