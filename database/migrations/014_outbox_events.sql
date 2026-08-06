-- 014_outbox_events.sql
-- Transactional outbox for reliable event publication
-- Ensures state-change notifications are delivered even if process crashes

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  publish_attempts INT DEFAULT 0,
  last_error TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed'))
);

-- Backs: sweeper's "find next batch to publish" query
CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created_at 
  ON outbox_events (status, created_at) 
  WHERE status = 'pending';

-- Backs: monitoring query for "how many unpublished"
CREATE INDEX IF NOT EXISTS idx_outbox_events_unpublished 
  ON outbox_events (created_at) 
  WHERE published_at IS NULL;
