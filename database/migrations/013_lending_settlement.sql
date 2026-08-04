-- 013_lending_settlement.sql
-- Lending marketplace: the platform is the XRP reserve.
--
-- Adds a lend / settlement ledger so the platform can:
--   * escrow XRP from its reserve to the buyer (the "lend"),
--   * clear TRY through the platform treasury (buyer -> platform),
--   * keep a 2.5% cut on TRY (the only cut basis),
--   * pay the seller net TRY and return the lend to the reserve.
-- See docs/LENDING_MARKETPLACE.md.
--
-- Idempotent (IF NOT EXISTS / DO NOTHING), matching repo migration style.

-- --- 1. p2p_orders: escrow-source + settlement bookkeeping -------------------
ALTER TABLE p2p_orders
    ADD COLUMN IF NOT EXISTS escrow_source VARCHAR(34),
    ADD COLUMN IF NOT EXISTS lent_xrp DECIMAL(20, 6) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(20) DEFAULT 'pending'
        CHECK (settlement_status IN ('pending', 'settled', 'void')),
    ADD COLUMN IF NOT EXISTS gross_try DECIMAL(20, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cut_try DECIMAL(20, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS seller_payout_try DECIMAL(20, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

-- 2. reserve_credit: per-seller XRP lend balances (quota + outstanding) -------
CREATE TABLE IF NOT EXISTS reserve_credit (
    seller_address VARCHAR(34) PRIMARY KEY,
    credit_limit_xrp DECIMAL(20, 6) NOT NULL DEFAULT 0,
    outstanding_xrp DECIMAL(20, 6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reserve_credit_seller ON reserve_credit(seller_address);

-- 3. reserve_settlements: immutable cut/payout audit log -----------------------
CREATE TABLE IF NOT EXISTS reserve_settlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(36) NOT NULL,
    seller_address VARCHAR(34) NOT NULL,
    gross_try DECIMAL(20, 2) NOT NULL,
    cut_try DECIMAL(20, 2) NOT NULL,
    cut_percent DECIMAL(5, 4) NOT NULL DEFAULT 0.0250,
    lent_xrp DECIMAL(20, 6) NOT NULL DEFAULT 0,
    seller_payout_try DECIMAL(20, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'void')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    paid_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_reserve_settlements_order ON reserve_settlements(order_id);
CREATE INDEX IF NOT EXISTS idx_reserve_settlements_seller ON reserve_settlements(seller_address);