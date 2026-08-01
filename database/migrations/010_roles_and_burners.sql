-- Migration 010: two-tier users — seller roles + burner buyer wallets
--
-- Implements the TWO_TIER_USERS plan:
--   1. wallets.role — gates sell-order creation to verified sellers.
--   2. burner_wallets — lifecycle metadata for guest buyer wallets. The seed is
--      NEVER stored here (or anywhere on disk); burnerWalletService holds it
--      in-memory only and destroys the account via AccountDelete.

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'buyer'
    CHECK (role IN ('buyer', 'seller'));

CREATE INDEX IF NOT EXISTS idx_wallets_role ON wallets(role);

CREATE TABLE IF NOT EXISTS burner_wallets (
    address      VARCHAR(34) PRIMARY KEY,
    order_id     VARCHAR(36),
    status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sweep_pending', 'destroyed')),
    funded_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_burner_wallets_status ON burner_wallets(status);

INSERT INTO system_settings (key, value, description) VALUES
('sponsor_seed', '', 'Seed of the platform account that sponsors burner reserves'),
('sponsor_address', '', 'Address of the sponsor account'),
('burner_sweep_interval_ms', '60000', 'Burner wallet sweeper interval in ms'),
('burner_destroy_delay_ms', '960000', 'Burner wallet destroy age delay in ms')
ON CONFLICT (key) DO NOTHING;
