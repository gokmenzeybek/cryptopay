/**
 * Wallets Data Access Layer
 * Handles all database operations for wallets
 */

const { pool } = require('../connection');

const COLUMNS = `id, address, public_key, is_active, role, created_at, updated_at, last_activity`;

class WalletsDAL {
  /**
   * Get all wallets
   */
  static async getAll() {
    const query = `
      SELECT ${COLUMNS}
      FROM wallets
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Get wallet by address
   */
  static async getByAddress(address) {
    const query = `
      SELECT ${COLUMNS}
      FROM wallets
      WHERE address = $1
    `;
    const result = await pool.query(query, [address]);
    return result.rows[0] || null;
  }

  /**
   * Create a new wallet
   */
  static async create(walletData) {
    const { address, public_key, is_active = true, role = 'buyer' } = walletData;
    
    const query = `
      INSERT INTO wallets (address, public_key, is_active, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (address) DO UPDATE SET
        public_key = EXCLUDED.public_key,
        is_active = EXCLUDED.is_active,
        role = EXCLUDED.role,
        updated_at = NOW()
      RETURNING ${COLUMNS}
    `;
    
    const result = await pool.query(query, [address, public_key, is_active, role]);
    return result.rows[0];
  }

  /**
   * Update wallet activity
   */
  static async updateActivity(address) {
    const query = `
      UPDATE wallets 
      SET last_activity = NOW(), updated_at = NOW()
      WHERE address = $1
      RETURNING ${COLUMNS}
    `;
    
    const result = await pool.query(query, [address]);
    return result.rows[0] || null;
  }

  /**
   * Update wallet status
   */
  static async updateStatus(address, is_active) {
    const query = `
      UPDATE wallets 
      SET is_active = $2, updated_at = NOW()
      WHERE address = $1
      RETURNING ${COLUMNS}
    `;
    
    const result = await pool.query(query, [address, is_active]);
    return result.rows[0] || null;
  }

  /**
   * Set a wallet's role ('buyer' | 'seller'). Used by moderator endpoints to
   * promote verified sellers / demote them back to buyers.
   */
  static async setRole(address, role) {
    if (!['buyer', 'seller'].includes(role)) {
      throw new Error('Role must be either "buyer" or "seller"');
    }
    const query = `
      UPDATE wallets
      SET role = $2, updated_at = NOW()
      WHERE address = $1
      RETURNING ${COLUMNS}
    `;
    const result = await pool.query(query, [address, role]);
    return result.rows[0] || null;
  }

  /**
   * Get wallets by role ('buyer' | 'seller')
   */
  static async getByRole(role) {
    const query = `
      SELECT ${COLUMNS}
      FROM wallets
      WHERE role = $1
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [role]);
    return result.rows;
  }

  /**
   * Get active wallets count
   */
  static async getActiveCount() {
    const query = `
      SELECT COUNT(*) as count
      FROM wallets
      WHERE is_active = true
    `;
    
    const result = await pool.query(query);
    return parseInt(result.rows[0].count);
  }

  /**
   * Get wallet statistics
   */
  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total_wallets,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_wallets,
        COUNT(CASE WHEN last_activity > NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h,
        MIN(created_at) as first_wallet_created,
        MAX(created_at) as last_wallet_created
      FROM wallets
    `;
    
    const result = await pool.query(query);
    return result.rows[0];
  }

  /**
   * Delete wallet (soft delete by setting inactive)
   */
  static async delete(address) {
    const query = `
      UPDATE wallets 
      SET is_active = false, updated_at = NOW()
      WHERE address = $1
      RETURNING ${COLUMNS}
    `;
    
    const result = await pool.query(query, [address]);
    return result.rows[0] || null;
  }

  /**
   * Get total wallet count
   */
  static async getCount() {
    const result = await pool.query('SELECT COUNT(*) as count FROM wallets');
    return parseInt(result.rows[0].count, 10);
  }
}

module.exports = WalletsDAL;