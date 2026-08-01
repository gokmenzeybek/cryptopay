/**
 * P2P Orders Data Access Layer
 * Handles all database operations for P2P orders
 */

const { pool } = require('../connection');

const FULL_COLUMNS = `id, order_id, xrpl_address, order_type, amount_xrp, amount_try, rate,
       payment_methods, status, counterparty_order_id, counterparty_address,
       payment_reference, xrp_transaction_hash, created_at, matched_at,
       payment_confirmed_at, completed_at, expires_at, dispute_reason,
       dispute_created_at, escrow_status, escrow_transaction_hash, escrow_sequence,
       escrow_owner, escrow_condition, escrow_created_at, escrow_finished_at,
       escrow_cancel_after, escrow_preimage, metadata`;

class P2POrdersDAL {
  /**
   * Get all P2P orders with pagination
   */
  static async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get order by order_id (accepts business order_id or uuid primary key)
   */
  static async getByOrderId(order_id) {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      WHERE order_id = $1 OR id::text = $1
    `;
    const result = await pool.query(query, [order_id]);
    return result.rows[0] || null;
  }

  /**
   * Get order by order_id (alias for compatibility)
   */
  static async getById(order_id) {
    return this.getByOrderId(order_id);
  }

  /**
   * Get orders by XRPL address
   */
  static async getByAddress(xrpl_address, limit = 50, offset = 0) {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      WHERE xrpl_address = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [xrpl_address, limit, offset]);
    return result.rows;
  }

  /**
   * Count a user's currently open orders (for max_orders_per_user enforcement)
   */
  static async countOpenByAddress(xrpl_address) {
    const query = `
      SELECT COUNT(*)::int AS count
      FROM p2p_orders
      WHERE xrpl_address = $1 AND status = 'open'
    `;
    const result = await pool.query(query, [xrpl_address]);
    return result.rows[0].count;
  }

  /**
   * Get orders by type and status
   */
  static async getByTypeAndStatus(order_type, status, limit = 50, offset = 0) {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      WHERE order_type = $1 AND status = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `;
    const result = await pool.query(query, [order_type, status, limit, offset]);
    return result.rows;
  }

  /**
   * Get orders by status
   */
  static async getByStatus(status, limit = 100, offset = 0) {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      WHERE status = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [status, limit, offset]);
    return result.rows;
  }

  /**
   * Get disputed orders (for moderator dashboard)
   */
  static async getDisputed(limit = 100, offset = 0) {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      WHERE status = 'disputed'
      ORDER BY dispute_created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get open orders (for matching)
   */
  static async getOpenOrders(order_type, limit = 50) {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      WHERE order_type = $1 AND status = 'open' AND expires_at > NOW()
      ORDER BY created_at ASC
      LIMIT $2
    `;
    const result = await pool.query(query, [order_type, limit]);
    return result.rows;
  }

  /**
   * Create a new P2P order
   */
  static async create(orderData) {
    const {
      order_id,
      xrpl_address,
      order_type,
      amount_xrp,
      amount_try,
      rate,
      payment_methods,
      expires_at,
      metadata = null
    } = orderData;

    const query = `
      INSERT INTO p2p_orders (order_id, xrpl_address, order_type, amount_xrp, 
                             amount_try, rate, payment_methods, expires_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (order_id) DO UPDATE SET
        xrpl_address = EXCLUDED.xrpl_address,
        order_type = EXCLUDED.order_type,
        amount_xrp = EXCLUDED.amount_xrp,
        amount_try = EXCLUDED.amount_try,
        rate = EXCLUDED.rate,
        payment_methods = EXCLUDED.payment_methods,
        expires_at = EXCLUDED.expires_at,
        metadata = EXCLUDED.metadata
      RETURNING ${FULL_COLUMNS}
    `;

    const result = await pool.query(query, [
      order_id, xrpl_address, order_type, amount_xrp, 
      amount_try, rate, payment_methods, expires_at, metadata
    ]);
    return result.rows[0];
  }

  /**
   * Match two orders
   */
  static async matchOrders(buy_order_id, sell_order_id) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Update buy order
      const buyQuery = `
        UPDATE p2p_orders 
        SET status = 'matched',
            counterparty_order_id = $2,
            matched_at = NOW(),
            updated_at = NOW()
        WHERE order_id = $1 AND status = 'open'
        RETURNING order_id, status, matched_at
      `;
      const buyResult = await client.query(buyQuery, [buy_order_id, sell_order_id]);

      // Atomicity guard: if the buy order was not 'open' (or does not exist),
      // the UPDATE matched zero rows — roll back before touching anything else.
      if (buyResult.rowCount === 0) {
        throw new Error(`Cannot match: buy order ${buy_order_id} is not open (already matched, cancelled, or not found)`);
      }

      // Update sell order
      const sellQuery = `
        UPDATE p2p_orders 
        SET status = 'matched',
            counterparty_order_id = $2,
            matched_at = NOW(),
            updated_at = NOW()
        WHERE order_id = $1 AND status = 'open'
        RETURNING order_id, status, matched_at
      `;
      const sellResult = await client.query(sellQuery, [sell_order_id, buy_order_id]);

      if (sellResult.rowCount === 0) {
        throw new Error(`Cannot match: sell order ${sell_order_id} is not open (already matched, cancelled, or not found)`);
      }

      // Create match record
      const matchQuery = `
        INSERT INTO p2p_order_matches (buy_order_id, sell_order_id)
        VALUES ($1, $2)
        RETURNING id, buy_order_id, sell_order_id, matched_at, status
      `;
      const matchResult = await client.query(matchQuery, [buy_order_id, sell_order_id]);

      await client.query('COMMIT');

      return {
        buy_order: buyResult.rows[0],
        sell_order: sellResult.rows[0],
        match: matchResult.rows[0]
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update order status
   */
  static async updateStatus(order_id, status, additionalData = {}) {
    const {
      counterparty_address,
      payment_reference,
      xrp_transaction_hash,
      dispute_reason
    } = additionalData;

    let query = `
      UPDATE p2p_orders 
      SET status = $2, updated_at = NOW()
    `;
    const params = [order_id, status];

    if (status === 'payment_confirmed') {
      query += `, payment_confirmed_at = NOW()`;
    } else if (status === 'completed') {
      query += `, completed_at = NOW()`;
    } else if (status === 'disputed') {
      query += `, dispute_reason = $3, dispute_created_at = NOW()`;
      params.push(dispute_reason);
    }

    if (counterparty_address) {
      query += `, counterparty_address = $${params.length + 1}`;
      params.push(counterparty_address);
    }
    if (payment_reference) {
      query += `, payment_reference = $${params.length + 1}`;
      params.push(payment_reference);
    }
    if (xrp_transaction_hash) {
      query += `, xrp_transaction_hash = $${params.length + 1}`;
      params.push(xrp_transaction_hash);
    }

    query += `
      WHERE order_id = $1
      RETURNING ${FULL_COLUMNS}
    `;

    const result = await pool.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * Get expired orders
   */
  static async getExpired() {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      WHERE status = 'open' AND expires_at < NOW()
      ORDER BY expires_at ASC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Clean up expired orders
   */
  static async cleanupExpired() {
    const query = `
      UPDATE p2p_orders 
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'open' AND expires_at < NOW()
      RETURNING ${FULL_COLUMNS}
    `;

    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Get locked escrows whose cancel-after deadline has passed
   */
  static async getExpiredLockedEscrows() {
    const query = `
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      WHERE escrow_status = 'locked' AND escrow_cancel_after < NOW()
      ORDER BY escrow_cancel_after ASC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Update escrow fields on an order (escrow columns only)
   */
  static async updateEscrow(order_id, escrowData = {}) {
    const allowed = {
      escrow_status: 'escrow_status',
      escrow_transaction_hash: 'escrow_transaction_hash',
      escrow_sequence: 'escrow_sequence',
      escrow_owner: 'escrow_owner',
      escrow_condition: 'escrow_condition',
      escrow_created_at: 'escrow_created_at',
      escrow_finished_at: 'escrow_finished_at',
      escrow_cancel_after: 'escrow_cancel_after',
      escrow_preimage: 'escrow_preimage',
      escrowStatus: 'escrow_status',
      escrowTransactionHash: 'escrow_transaction_hash',
      escrowSequence: 'escrow_sequence',
      escrowOwner: 'escrow_owner',
      escrowCondition: 'escrow_condition',
      escrowCreatedAt: 'escrow_created_at',
      escrowFinishedAt: 'escrow_finished_at',
      escrowCancelAfter: 'escrow_cancel_after',
      escrowPreimage: 'escrow_preimage'
    };

    const fields = [];
    const values = [order_id];
    let paramIndex = 2;

    for (const [key, dbCol] of Object.entries(allowed)) {
      if (escrowData[key] !== undefined) {
        fields.push(`${dbCol} = $${paramIndex}`);
        values.push(escrowData[key]);
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return this.getByOrderId(order_id);
    }

    const query = `
      UPDATE p2p_orders
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE order_id = $1
      RETURNING ${FULL_COLUMNS}
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Get orders filtered by type and/or status with pagination
   */
  static async getFiltered({ type = null, status = null, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (type) {
      conditions.push(`order_type = $${paramIndex}`);
      params.push(type);
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
      SELECT ${FULL_COLUMNS}
      FROM p2p_orders
      ${where}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get total order count
   */
  static async getCount() {
    const result = await pool.query('SELECT COUNT(*) as count FROM p2p_orders');
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get P2P order statistics
   */
  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_orders,
        COUNT(CASE WHEN status = 'matched' THEN 1 END) as matched_orders,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_orders,
        COUNT(CASE WHEN status = 'disputed' THEN 1 END) as disputed_orders,
        COUNT(CASE WHEN order_type = 'buy' THEN 1 END) as buy_orders,
        COUNT(CASE WHEN order_type = 'sell' THEN 1 END) as sell_orders,
        COUNT(CASE WHEN escrow_status = 'locked' THEN 1 END) as locked_escrows,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_orders_24h,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount_xrp END), 0) as total_volume_xrp,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount_try END), 0) as total_volume_try,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN rate END), 0) as avg_rate,
        MIN(created_at) as first_order,
        MAX(created_at) as last_order
      FROM p2p_orders
    `;

    const result = await pool.query(query);
    return result.rows[0];
  }

  /**
   * Update order status
   */
  static async updateOrderStatus(order_id, status, additionalData = {}) {
    const fields = ['status = $2'];
    const values = [order_id, status];
    let paramIndex = 3;

    // Add additional fields dynamically
    for (const [key, value] of Object.entries(additionalData)) {
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    const query = `
      UPDATE p2p_orders 
      SET ${fields.join(', ')}
      WHERE order_id = $1
      RETURNING ${FULL_COLUMNS}
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update P2P order
   */
  static async update(order_id, orderData) {
    const fields = [];
    const values = [order_id];
    let paramIndex = 2;

    const mappings = {
      status: 'status',
      type: 'order_type',
      tryAmount: 'amount_try',
      xrpAmount: 'amount_xrp',
      rate: 'rate',
      xrplAddress: 'xrpl_address',
      paymentMethods: 'payment_methods',
      counterpartyAddress: 'counterparty_address',
      counterpartyOrderId: 'counterparty_order_id',
      paymentReference: 'payment_reference',
      xrpTransactionHash: 'xrp_transaction_hash',
      disputeReason: 'dispute_reason',
      metadata: 'metadata',
      escrowStatus: 'escrow_status',
      escrowTransactionHash: 'escrow_transaction_hash',
      escrowSequence: 'escrow_sequence',
      escrowOwner: 'escrow_owner',
      escrowCondition: 'escrow_condition',
      escrowPreimage: 'escrow_preimage'
    };

    const timestamps = {
      matchedAt: 'matched_at',
      paymentConfirmedAt: 'payment_confirmed_at',
      xrpConfirmedAt: 'completed_at',
      completedAt: 'completed_at',
      expiresAt: 'expires_at',
      disputeCreatedAt: 'dispute_created_at',
      escrowCreatedAt: 'escrow_created_at',
      escrowFinishedAt: 'escrow_finished_at',
      escrowCancelAfter: 'escrow_cancel_after'
    };

    const allMappings = { ...mappings, ...timestamps };
    const assignedColumns = new Set();

    for (const [jsKey, dbCol] of Object.entries(allMappings)) {
      if (assignedColumns.has(dbCol)) continue;
      if (orderData[jsKey] !== undefined) {
        fields.push(`${dbCol} = $${paramIndex}`);
        values.push(orderData[jsKey]);
        paramIndex++;
        assignedColumns.add(dbCol);
      } else if (orderData[dbCol] !== undefined) {
        fields.push(`${dbCol} = $${paramIndex}`);
        values.push(orderData[dbCol]);
        paramIndex++;
        assignedColumns.add(dbCol);
      }
    }

    if (fields.length === 0) {
      return this.getByOrderId(order_id);
    }

    const query = `
      UPDATE p2p_orders 
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE order_id = $1
      RETURNING ${FULL_COLUMNS}
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Delete order
   */
  static async delete(order_id) {
    const query = `
      DELETE FROM p2p_orders 
      WHERE order_id = $1
      RETURNING id, order_id, xrpl_address, order_type, amount_xrp, amount_try, rate,
                payment_methods, status, created_at, expires_at
    `;

    const result = await pool.query(query, [order_id]);
    return result.rows[0] || null;
  }
}

module.exports = P2POrdersDAL;
