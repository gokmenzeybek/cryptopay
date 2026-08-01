-- ==============================================================================
-- Migration 006: Papara Payments Reference Mapping
-- ==============================================================================
-- Maps Papara payment referenceIds (format: P2P_<orderId>_<timestamp>) to
-- p2p_orders so the HMAC-verified webhook can resolve the order from the
-- mapping instead of treating the referenceId as an order ID. The
-- processed_at column provides replay protection: a second identical webhook
-- is acknowledged without re-advancing state.
-- Idempotent: safe to run multiple times.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS papara_payments (
    id SERIAL PRIMARY KEY,
    reference_id VARCHAR(128) NOT NULL UNIQUE,
    order_id VARCHAR(36) NOT NULL REFERENCES p2p_orders(order_id) ON DELETE CASCADE,
    transaction_id VARCHAR(64),
    amount_try DECIMAL(15, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'completed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_papara_payments_reference_id ON papara_payments(reference_id);
CREATE INDEX IF NOT EXISTS idx_papara_payments_order_id ON papara_payments(order_id);
