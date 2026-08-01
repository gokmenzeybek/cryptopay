-- Migration 008: Dedicated chat_messages table
-- Moves chat history out of p2p_orders.metadata read-modify-write and into
-- a proper table with a bounded history (200 messages per order).

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL REFERENCES p2p_orders(order_id) ON DELETE CASCADE,
  sender VARCHAR(64) NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_order_id ON chat_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
