-- ==============================================================================
-- CryptoPay PostgreSQL Database Schema
-- ==============================================================================
-- This file contains the complete database schema for the CryptoPay application
-- including tables for wallets, transactions, payment requests, and P2P orders.
-- ==============================================================================

-- Enable UUID extension for generating unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- Wallets Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(34) UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    role VARCHAR(20) DEFAULT 'buyer' CHECK (role IN ('buyer', 'seller', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for wallet lookups
CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address);
CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(is_active);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'wallets' AND column_name = 'role'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_wallets_role ON wallets(role)';
    END IF;
END $$;

-- ==============================================================================
-- Auth Challenges Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS auth_challenges (
    address VARCHAR(34) PRIMARY KEY,
    nonce VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for auth challenge lookups
CREATE INDEX IF NOT EXISTS idx_auth_challenges_address ON auth_challenges(address);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_nonce ON auth_challenges(nonce);

-- ==============================================================================
-- Transactions Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hash VARCHAR(64) UNIQUE NOT NULL,
    from_address VARCHAR(34) NOT NULL,
    to_address VARCHAR(34) NOT NULL,
    amount_xrp DECIMAL(20, 6) NOT NULL,
    fee_xrp DECIMAL(20, 6) NOT NULL,
    memo TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    block_number BIGINT,
    raw_transaction JSONB
);

-- Indexes for transaction lookups
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(hash);
CREATE INDEX IF NOT EXISTS idx_transactions_from_address ON transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_transactions_to_address ON transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_amount_xrp ON transactions(amount_xrp);
CREATE INDEX IF NOT EXISTS idx_transactions_confirmed_at ON transactions(confirmed_at);
CREATE INDEX IF NOT EXISTS idx_transactions_from_to ON transactions(from_address, to_address);
CREATE INDEX IF NOT EXISTS idx_transactions_created_status ON transactions(created_at, status);

-- ==============================================================================
-- Payment Requests Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS payment_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id VARCHAR(36) UNIQUE NOT NULL,
    from_address VARCHAR(34) NOT NULL,
    to_address VARCHAR(34) NOT NULL,
    amount_xrp DECIMAL(20, 6) NOT NULL,
    memo TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    qr_code_data TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    paid_at TIMESTAMP WITH TIME ZONE,
    transaction_hash VARCHAR(64)
);

-- Indexes for payment request lookups
CREATE INDEX IF NOT EXISTS idx_payment_requests_request_id ON payment_requests(request_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_from_address ON payment_requests(from_address);
CREATE INDEX IF NOT EXISTS idx_payment_requests_to_address ON payment_requests(to_address);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_expires_at ON payment_requests(expires_at);

-- ==============================================================================
-- P2P Orders Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS p2p_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(36) UNIQUE NOT NULL,
    xrpl_address VARCHAR(34) NOT NULL,
    order_type VARCHAR(10) NOT NULL CHECK (order_type IN ('buy', 'sell')),
    amount_xrp DECIMAL(20, 6) NOT NULL,
    amount_try DECIMAL(20, 2) NOT NULL,
    rate DECIMAL(20, 6) NOT NULL,
    payment_methods TEXT[] NOT NULL,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'matched', 'payment_confirmed', 'completed', 'cancelled', 'expired', 'disputed')),
    counterparty_order_id VARCHAR(36),
    counterparty_address VARCHAR(34),
    payment_reference VARCHAR(100),
    xrp_transaction_hash VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    matched_at TIMESTAMP WITH TIME ZONE,
    payment_confirmed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 minutes'),
    dispute_reason TEXT,
    dispute_created_at TIMESTAMP WITH TIME ZONE,
    escrow_status VARCHAR(20) DEFAULT 'none' CHECK (escrow_status IN ('none', 'prepared', 'locked', 'finish_pending', 'refund_pending', 'cancel_pending', 'finished', 'cancelled', 'refunded')),
    escrow_transaction_hash VARCHAR(64),
    escrow_sequence BIGINT,
    escrow_owner VARCHAR(34),
    escrow_condition VARCHAR(78),
    escrow_created_at TIMESTAMP WITH TIME ZONE,
    escrow_finished_at TIMESTAMP WITH TIME ZONE,
    escrow_cancel_after TIMESTAMP WITH TIME ZONE,
    escrow_preimage VARCHAR(80),
    -- Papara instant-transfer fields (reconciled from migration 003)
    papara_account_number VARCHAR(50),
    counterparty_papara_account VARCHAR(50),
    papara_transaction_id VARCHAR(255),
    papara_payment_status VARCHAR(50),
    papara_verified_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for P2P order lookups
CREATE INDEX IF NOT EXISTS idx_p2p_orders_order_id ON p2p_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_xrpl_address ON p2p_orders(xrpl_address);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_type ON p2p_orders(order_type);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_status ON p2p_orders(status);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_created_at ON p2p_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_expires_at ON p2p_orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_counterparty ON p2p_orders(counterparty_order_id);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_type_status ON p2p_orders(order_type, status);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_created_status ON p2p_orders(created_at, status);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_amount_xrp ON p2p_orders(amount_xrp);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_rate ON p2p_orders(rate);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_payment_methods ON p2p_orders USING GIN(payment_methods);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_metadata ON p2p_orders USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_xrp_transaction_hash ON p2p_orders(xrp_transaction_hash);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_payment_reference ON p2p_orders(payment_reference);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_escrow_status ON p2p_orders(escrow_status);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_escrow_transaction_hash ON p2p_orders(escrow_transaction_hash);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_escrow_cancel_after ON p2p_orders(escrow_cancel_after) WHERE escrow_status = 'locked';
CREATE INDEX IF NOT EXISTS idx_p2p_orders_papara_transaction ON p2p_orders(papara_transaction_id);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_papara_account ON p2p_orders(papara_account_number);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_counterparty_papara ON p2p_orders(counterparty_papara_account);

-- ==============================================================================
-- P2P Order Matches Table (for tracking order matching history)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS p2p_order_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buy_order_id VARCHAR(36) NOT NULL,
    sell_order_id VARCHAR(36) NOT NULL,
    matched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    completed_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (buy_order_id) REFERENCES p2p_orders(order_id),
    FOREIGN KEY (sell_order_id) REFERENCES p2p_orders(order_id)
);

-- Indexes for order matches
CREATE INDEX IF NOT EXISTS idx_p2p_matches_buy_order ON p2p_order_matches(buy_order_id);
CREATE INDEX IF NOT EXISTS idx_p2p_matches_sell_order ON p2p_order_matches(sell_order_id);
CREATE INDEX IF NOT EXISTS idx_p2p_matches_status ON p2p_order_matches(status);

-- ==============================================================================
-- Rate History Table (for tracking XRP/TRY rate changes)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS rate_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(50) NOT NULL,
    rate DECIMAL(20, 6) NOT NULL,
    change_24h DECIMAL(10, 4),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB
);

-- Index for rate history lookups
CREATE INDEX IF NOT EXISTS idx_rate_history_timestamp ON rate_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_rate_history_source ON rate_history(source);

-- ==============================================================================
-- System Settings Table (for application configuration)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
('conversion_fee_percent', '1.5', 'Default conversion fee percentage'),
('rate_cache_ttl_seconds', '300', 'Rate cache time-to-live in seconds'),
('order_expiry_minutes', '30', 'Default order expiry time in minutes'),
('max_orders_per_user', '10', 'Maximum number of open orders per user'),
('min_order_amount_xrp', '1.0', 'Minimum order amount in XRP'),
('max_order_amount_xrp', '10000.0', 'Maximum order amount in XRP'),
('sponsor_seed', '', 'Seed of the platform account that sponsors burner reserves'),
('sponsor_address', '', 'Address of the sponsor account'),
('burner_sweep_interval_ms', '60000', 'Burner wallet sweeper interval in ms'),
('burner_destroy_delay_ms', '960000', 'Burner wallet destroy age delay in ms'),
('circuit_breaker_percentage', '10.0', 'Halt trading if XRP/TRY rate changes by this percentage in 5 minutes')
ON CONFLICT (key) DO NOTHING;

-- ==============================================================================
-- Chat Messages Table (bounded per-order chat history)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL REFERENCES p2p_orders(order_id) ON DELETE CASCADE,
    sender VARCHAR(64) NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_order_id ON chat_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- ==============================================================================
-- Schema Updates and Migrations
-- ==============================================================================

-- Add updated_at column to p2p_orders if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'p2p_orders' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE p2p_orders ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- ==============================================================================
-- Functions and Triggers (Simplified for compatibility)
-- ==============================================================================

-- Note: Complex functions removed for initial setup
-- These can be added later once the basic schema is working

-- ==============================================================================
-- Views for Common Queries
-- ==============================================================================

-- View for active orders with user information
CREATE OR REPLACE VIEW active_orders AS
SELECT 
    o.*,
    w.is_active as user_active,
    w.last_activity
FROM p2p_orders o
LEFT JOIN wallets w ON o.xrpl_address = w.address
WHERE o.status IN ('open', 'matched', 'payment_confirmed');

-- View for order statistics
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

-- View for recent transactions
CREATE OR REPLACE VIEW recent_transactions AS
SELECT 
    t.*,
    w1.is_active as from_user_active,
    w2.is_active as to_user_active
FROM transactions t
LEFT JOIN wallets w1 ON t.from_address = w1.address
LEFT JOIN wallets w2 ON t.to_address = w2.address
ORDER BY t.created_at DESC;

-- ==============================================================================
-- Initial Data and Permissions
-- ==============================================================================

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO cryptopay;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO cryptopay;

-- Create a simple function to get application statistics
CREATE OR REPLACE FUNCTION get_app_stats()
RETURNS JSON AS $$
BEGIN
    RETURN json_build_object(
        'active_wallets', (SELECT COUNT(*) FROM wallets WHERE is_active = true),
        'total_transactions', (SELECT COUNT(*) FROM transactions),
        'total_requests', (SELECT COUNT(*) FROM payment_requests),
        'pending_requests', (SELECT COUNT(*) FROM payment_requests WHERE status = 'pending'),
        'total_volume_xrp', (SELECT COALESCE(SUM(amount_xrp), 0) FROM transactions WHERE status = 'completed'),
        'recent_transactions_24h', (SELECT COUNT(*) FROM transactions WHERE created_at > NOW() - INTERVAL '24 hours'),
        'last_updated', NOW()
    );
END;
$$ LANGUAGE plpgsql;
-- Papara payments reference mapping (migration 006): maps Papara referenceIds
-- (P2P_<orderId>_<timestamp>) to orders for the HMAC-verified webhook;
-- processed_at provides replay protection.
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

-- ==============================================================================
-- Burner Wallets Table (two-tier users: guest buyer wallets)
-- ==============================================================================
-- Lifecycle metadata only — the seed is NEVER stored here. burnerWalletService
-- keeps it in-memory (TTL'd) and destroys the account via AccountDelete.
CREATE TABLE IF NOT EXISTS burner_wallets (
    address      VARCHAR(34) PRIMARY KEY,
    order_id     VARCHAR(36),
    status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sweep_pending', 'destroyed')),
    funded_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_burner_wallets_status ON burner_wallets(status);
