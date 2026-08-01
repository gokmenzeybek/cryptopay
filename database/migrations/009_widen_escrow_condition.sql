-- Migration 009: widen escrow condition/preimage columns for on-chain formats
--
-- PREIMAGE-SHA-256 crypto-conditions are 78 hex chars
-- (A0258020 <32-byte digest> 8101 <cost>) and the encoded fulfillment blob
-- is 72 hex chars (A0228020 <32-byte preimage>) — both exceed the original
-- VARCHAR(64) columns, which were sized for a bare SHA-256 digest.
--
-- The active_orders view does `SELECT o.*`, so it must be dropped and
-- recreated around the ALTER (PostgreSQL refuses to alter columns a view
-- depends on).

DROP VIEW IF EXISTS active_orders;

ALTER TABLE p2p_orders ALTER COLUMN escrow_condition TYPE VARCHAR(78);
ALTER TABLE p2p_orders ALTER COLUMN escrow_preimage TYPE VARCHAR(80);

COMMENT ON COLUMN p2p_orders.escrow_condition IS 'PREIMAGE-SHA-256 crypto-condition hex (78 chars: A0258020<digest>8101<cost>)';
COMMENT ON COLUMN p2p_orders.escrow_preimage IS 'Encoded PREIMAGE-SHA-256 fulfillment blob hex (72 chars: A0228020<preimage>)';

CREATE OR REPLACE VIEW active_orders AS
SELECT
    o.*,
    w.is_active as user_active,
    w.last_activity
FROM p2p_orders o
LEFT JOIN wallets w ON o.xrpl_address = w.address
WHERE o.status IN ('open', 'matched', 'payment_confirmed');
