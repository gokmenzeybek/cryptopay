/**
 * Transactions Data Access Layer
 * Handles all database operations for transactions
 */

const { pool } = require('../connection');

class TransactionsDAL {
  /**
   * Get all transactions with pagination
   */
  static async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, 
             status, created_at, confirmed_at, block_number, raw_transaction
      FROM transactions
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get transaction by hash
   */
  static async getByHash(hash) {
    const query = `
      SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, 
             status, created_at, confirmed_at, block_number, raw_transaction
      FROM transactions
      WHERE hash = $1
    `;
    const result = await pool.query(query, [hash]);
    return result.rows[0] || null;
  }

  /**
   * Get transactions by address
   */
  static async getByAddress(address, limit = 50, offset = 0) {
    const query = `
      SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, 
             status, created_at, confirmed_at, block_number, raw_transaction
      FROM transactions
      WHERE from_address = $1 OR to_address = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [address, limit, offset]);
    return result.rows;
  }

  /**
   * Create a new transaction
   */
  static async create(transactionData) {
    const {
      hash,
      from_address,
      to_address,
      amount_xrp,
      fee_xrp,
      memo,
      status = 'pending',
      block_number = null,
      raw_transaction = null
    } = transactionData;

    const query = `
      INSERT INTO transactions (hash, from_address, to_address, amount_xrp, fee_xrp, 
                              memo, status, block_number, raw_transaction)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (hash) DO UPDATE SET
        status = EXCLUDED.status,
        confirmed_at = CASE WHEN EXCLUDED.status = 'completed' AND transactions.status != 'completed' 
                           THEN NOW() ELSE transactions.confirmed_at END,
        block_number = COALESCE(EXCLUDED.block_number, transactions.block_number),
        raw_transaction = COALESCE(EXCLUDED.raw_transaction, transactions.raw_transaction)
      RETURNING id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, 
                status, created_at, confirmed_at, block_number, raw_transaction
    `;

    const result = await pool.query(query, [
      hash, from_address, to_address, amount_xrp, fee_xrp, 
      memo, status, block_number, raw_transaction
    ]);
    return result.rows[0];
  }

  /**
   * Update transaction status
   */
  static async updateStatus(hash, status, block_number = null) {
    const query = `
      UPDATE transactions 
      SET status = $2, 
          confirmed_at = CASE WHEN $2 = 'completed' AND confirmed_at IS NULL THEN NOW() ELSE confirmed_at END,
          block_number = COALESCE($3, block_number),
          updated_at = NOW()
      WHERE hash = $1
      RETURNING id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, 
                status, created_at, confirmed_at, block_number, raw_transaction
    `;

    const result = await pool.query(query, [hash, status, block_number]);
    return result.rows[0] || null;
  }

  /**
   * Get transaction statistics
   */
  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total_transactions,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_transactions,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_transactions,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_transactions_24h,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount_xrp END), 0) as total_volume_xrp,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN amount_xrp END), 0) as avg_transaction_amount,
        MIN(created_at) as first_transaction,
        MAX(created_at) as last_transaction
      FROM transactions
    `;

    const result = await pool.query(query);
    return result.rows[0];
  }

  /**
   * Get recent transactions (last 24 hours)
   */
  static async getRecent(limit = 10) {
    const query = `
      SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, 
             status, created_at, confirmed_at, block_number
      FROM transactions
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Get transactions by status
   */
  static async getByStatus(status, limit = 50, offset = 0) {
    const query = `
      SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, 
             status, created_at, confirmed_at, block_number, raw_transaction
      FROM transactions
      WHERE status = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [status, limit, offset]);
    return result.rows;
  }

  /**
   * Search transactions
   */
  static async search(searchTerm, limit = 50, offset = 0) {
    const query = `
      SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, 
             status, created_at, confirmed_at, block_number, raw_transaction
      FROM transactions
      WHERE hash ILIKE $1 
         OR from_address ILIKE $1 
         OR to_address ILIKE $1 
         OR memo ILIKE $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [`%${searchTerm}%`, limit, offset]);
    return result.rows;
  }

  /**
   * Get transactions filtered by address and/or status with pagination
   */
  static async getFiltered({ address = null, status = null, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (address) {
      conditions.push(`(from_address = $${paramIndex} OR to_address = $${paramIndex})`);
      params.push(address);
      paramIndex++;
    }
    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const query = `
      SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo,
             status, created_at, confirmed_at, block_number, raw_transaction
      FROM transactions
      ${where}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get total transaction count
   */
  static async getCount() {
    const result = await pool.query('SELECT COUNT(*) as count FROM transactions');
    return parseInt(result.rows[0].count, 10);
  }
}

module.exports = TransactionsDAL;