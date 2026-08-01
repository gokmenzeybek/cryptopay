-- ==============================================================================
-- Migration 003: Add Papara Integration Fields
-- ==============================================================================
-- This migration adds Papara-specific fields to the p2p_orders table
-- to support Papara instant transfer payments in the P2P exchange.
-- ==============================================================================

-- Add Papara-specific fields to p2p_orders table
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS papara_account_number VARCHAR(50);
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS counterparty_papara_account VARCHAR(50);
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS papara_transaction_id VARCHAR(255);
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS papara_payment_status VARCHAR(50);
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS papara_verified_at TIMESTAMP WITH TIME ZONE;

-- Create index for Papara lookups
CREATE INDEX IF NOT EXISTS idx_p2p_orders_papara_transaction ON p2p_orders(papara_transaction_id);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_papara_account ON p2p_orders(papara_account_number);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_counterparty_papara ON p2p_orders(counterparty_papara_account);

-- Add comments for documentation
COMMENT ON COLUMN p2p_orders.papara_account_number IS 'Papara account number of the order creator';
COMMENT ON COLUMN p2p_orders.counterparty_papara_account IS 'Papara account number of the counterparty';
COMMENT ON COLUMN p2p_orders.papara_transaction_id IS 'Papara transaction ID for instant transfers';
COMMENT ON COLUMN p2p_orders.papara_payment_status IS 'Status of Papara payment (pending, completed, failed)';
COMMENT ON COLUMN p2p_orders.papara_verified_at IS 'Timestamp when Papara account was verified';

-- Update the order_stats view to include Papara statistics
CREATE OR REPLACE VIEW order_stats AS
SELECT 
    order_type,
    status,
    COUNT(*) as count,
    SUM(amount_xrp) as total_xrp,
    SUM(amount_try) as total_try,
    AVG(rate) as avg_rate,
    COUNT(CASE WHEN papara_transaction_id IS NOT NULL THEN 1 END) as papara_transactions
FROM p2p_orders
GROUP BY order_type, status;
