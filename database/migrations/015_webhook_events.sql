-- Webhook event audit log
-- Persists ALL incoming webhook payloads (accepted and rejected) for debugging,
-- compliance, and replay analysis. Retention: 90 days via sweeper.
CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  webhook_type VARCHAR(50) NOT NULL,
  reference_id VARCHAR(255),
  payload JSONB NOT NULL,
  headers JSONB,
  signature_valid BOOLEAN,
  processing_status VARCHAR(20) DEFAULT 'received' CHECK (processing_status IN ('received', 'accepted', 'rejected', 'processing', 'completed', 'failed')),
  rejection_reason TEXT,
  ip_address INET,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_reference_id 
  ON webhook_events (reference_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_type_status 
  ON webhook_events (webhook_type, processing_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at 
  ON webhook_events (created_at);
