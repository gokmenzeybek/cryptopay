const { pool } = require('../connection');

class WebhookEventsDAL {
  static async create({
    webhookType,
    referenceId = null,
    payload,
    headers = null,
    signatureValid = null,
    processingStatus = 'received',
    rejectionReason = null,
    ipAddress = null
  }) {
    const query = `
      INSERT INTO webhook_events 
        (webhook_type, reference_id, payload, headers, signature_valid, processing_status, rejection_reason, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, webhook_type, reference_id, processing_status, created_at
    `;
    const result = await pool.query(query, [
      webhookType, referenceId, JSON.stringify(payload), headers ? JSON.stringify(headers) : null,
      signatureValid, processingStatus, rejectionReason, ipAddress
    ]);
    return result.rows[0];
  }

  static async updateStatus(id, status, rejectionReason = null) {
    const query = `
      UPDATE webhook_events
      SET processing_status = $1, rejection_reason = COALESCE($2, rejection_reason), processed_at = NOW()
      WHERE id = $3
      RETURNING id, processing_status, processed_at
    `;
    const result = await pool.query(query, [status, rejectionReason, id]);
    return result.rows[0] || null;
  }

  static async getByReferenceId(referenceId, limit = 20) {
    const query = `
      SELECT id, webhook_type, reference_id, signature_valid, processing_status, 
             rejection_reason, ip_address, created_at, processed_at
      FROM webhook_events
      WHERE reference_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [referenceId, limit]);
    return result.rows;
  }

  static async getRecent(webhookType, processingStatus = null, limit = 50) {
    let query = `
      SELECT id, webhook_type, reference_id, signature_valid, processing_status,
             rejection_reason, ip_address, created_at, processed_at
      FROM webhook_events
      WHERE webhook_type = $1
    `;
    const params = [webhookType];
    let paramIdx = 2;

    if (processingStatus) {
      query += ` AND processing_status = $${paramIdx++}`;
      params.push(processingStatus);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx++}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows;
  }

  static async cleanupOldEvents(retentionDays = 90) {
    const query = `
      DELETE FROM webhook_events
      WHERE created_at < NOW() - MAKE_INTERVAL(days => $1)
    `;
    const result = await pool.query(query, [retentionDays]);
    return result.rowCount || 0;
  }

  static async countByStatus(webhookType, status) {
    const query = `
      SELECT COUNT(*) FROM webhook_events
      WHERE webhook_type = $1 AND processing_status = $2
    `;
    const result = await pool.query(query, [webhookType, status]);
    return parseInt(result.rows[0].count);
  }
}

module.exports = WebhookEventsDAL;
