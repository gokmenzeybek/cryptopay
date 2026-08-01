-- ==============================================================================
-- Migration 004: Add XRPL Escrow Fields
-- ==============================================================================
-- This migration adds XRPL escrow tracking fields to the p2p_orders table
-- to support locking XRP on-ledger during P2P trades.
-- ==============================================================================

-- Add escrow lifecycle fields to p2p_orders table
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_status VARCHAR(20) DEFAULT 'none';
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_transaction_hash VARCHAR(64);
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_sequence BIGINT;
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_owner VARCHAR(34);
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_condition VARCHAR(64);
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_created_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_finished_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_cancel_after TIMESTAMP WITH TIME ZONE;

-- Constrain escrow_status to known lifecycle values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'p2p_orders_escrow_status_check'
    ) THEN
        ALTER TABLE p2p_orders
        ADD CONSTRAINT p2p_orders_escrow_status_check
        CHECK (escrow_status IN ('none', 'prepared', 'locked', 'finished', 'cancelled', 'refunded'));
    END IF;
END $$;

-- Indexes for escrow lookups
CREATE INDEX IF NOT EXISTS idx_p2p_orders_escrow_status ON p2p_orders(escrow_status);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_escrow_transaction_hash ON p2p_orders(escrow_transaction_hash);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_escrow_cancel_after ON p2p_orders(escrow_cancel_after) WHERE escrow_status = 'locked';

-- Add comments for documentation
COMMENT ON COLUMN p2p_orders.escrow_status IS 'Escrow lifecycle: none, prepared, locked, finished, cancelled, refunded';
COMMENT ON COLUMN p2p_orders.escrow_transaction_hash IS 'XRPL EscrowCreate transaction hash';
COMMENT ON COLUMN p2p_orders.escrow_sequence IS 'Ledger sequence (offer sequence) of the EscrowCreate transaction';
COMMENT ON COLUMN p2p_orders.escrow_owner IS 'XRPL address that owns the escrow (seller)';
COMMENT ON COLUMN p2p_orders.escrow_condition IS 'PREIMAGE-SHA-256 condition hex for the escrow';
COMMENT ON COLUMN p2p_orders.escrow_created_at IS 'Timestamp when the escrow was locked on ledger';
COMMENT ON COLUMN p2p_orders.escrow_finished_at IS 'Timestamp when the escrow was finished/cancelled';
COMMENT ON COLUMN p2p_orders.escrow_cancel_after IS 'Timestamp after which the escrow can be cancelled/refunded';
