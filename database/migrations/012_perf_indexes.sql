-- Migration 012: performance indexes for the hot query paths.
-- Backs the most common filtered/ordered queries so the free-tier Postgres
-- (Neon) does index scans instead of full table scans as tables grow.
-- Idempotent.

-- payment_requests.getFiltered orders by created_at DESC
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at ON payment_requests(created_at);

-- p2p_orders.getOpenOrders filters order_type + status + expires_at > NOW()
CREATE INDEX IF NOT EXISTS idx_p2p_orders_type_status_expires
    ON p2p_orders(order_type, status, expires_at);

-- burner_wallets.runSweep filters status IN (...) AND created_at <= $1
CREATE INDEX IF NOT EXISTS idx_burner_wallets_status_created
    ON burner_wallets(status, created_at);

-- chat_messages history/trim queries filter by order_id then order by created_at
CREATE INDEX IF NOT EXISTS idx_chat_messages_order_created
    ON chat_messages(order_id, created_at);
