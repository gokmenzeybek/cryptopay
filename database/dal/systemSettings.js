/**
 * System Settings Data Access Layer
 * Reads application configuration from the system_settings table
 */

const { pool } = require('../connection');

class SystemSettingsDAL {
  /**
   * Get all settings as a flat { key: value } object (values are strings)
   */
  static async getAll() {
    const result = await pool.query('SELECT key, value FROM system_settings');
    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }
}

module.exports = SystemSettingsDAL;
