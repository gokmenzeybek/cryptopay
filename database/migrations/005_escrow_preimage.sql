-- ==============================================================================
-- Migration 005: Escrow Preimage + Pending Escrow Statuses
-- ==============================================================================
-- 1. Adds escrow_preimage to p2p_orders: the random 32-byte fulfillment
--    preimage generated per escrow at preparation time (on-chain condition is
--    SHA-256 of the preimage bytes). Stored server-side, revealed only inside
--    the EscrowFinish flow after payment verification.
-- 2. Widens the escrow_status CHECK constraint with the pending states
--    introduced by the on-chain verification flow: finish_pending,
--    refund_pending, cancel_pending.
-- Idempotent: safe to run multiple times.
-- ==============================================================================

-- Random per-escrow fulfillment preimage (64-char hex)
ALTER TABLE p2p_orders ADD COLUMN IF NOT EXISTS escrow_preimage VARCHAR(64);

-- Widen escrow_status lifecycle values (pending states require on-chain
-- hash confirmation before reaching a terminal state)
ALTER TABLE p2p_orders DROP CONSTRAINT IF EXISTS p2p_orders_escrow_status_check;
ALTER TABLE p2p_orders
  ADD CONSTRAINT p2p_orders_escrow_status_check
  CHECK (escrow_status IN (
    'none', 'prepared', 'locked',
    'finish_pending', 'refund_pending', 'cancel_pending',
    'finished', 'cancelled', 'refunded'
  ));
