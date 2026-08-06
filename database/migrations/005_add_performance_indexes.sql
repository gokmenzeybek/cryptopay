-- ==============================================================================
-- Migration 005: Performance Indexes for Hot Query Paths
-- ==============================================================================
-- Adds composite/partial indexes that back the most common filtered + ordered
-- queries in the p2p / wallet / payment / auth code paths. The baseline
-- `schema.sql` already covers the obvious single-column lookups; this file
-- targets the multi-column access patterns the DALs and services use.
--
-- Idempotent: every CREATE INDEX uses IF NOT EXISTS.
-- Safe for both fresh installs (runs after schema.sql) and existing databases
-- (the schema_migrations table tracks this filename so it is only applied once).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- p2p_orders: wallet lookup by address (wallet page, order history)
-- ------------------------------------------------------------------------------
-- Backs: p2pOrders.getByAddress(xrpl_address, limit, offset)
--   SELECT ... FROM p2p_orders
--   WHERE xrpl_address = $1
--   ORDER BY created_at DESC
--   LIMIT $2 OFFSET $3
-- Single-column index idx_p2p_orders_xrpl_address already exists on
-- (xrpl_address) for the equality filter; this composite extends it with
-- created_at DESC so the planner can satisfy the WHERE+ORDER BY in one
-- index scan without a separate sort.
CREATE INDEX IF NOT EXISTS idx_p2p_orders_xrpl_address_created_at
  ON p2p_orders (xrpl_address, created_at DESC);

-- ------------------------------------------------------------------------------
-- p2p_orders: order book queries (matching engine, open orders list)
-- ------------------------------------------------------------------------------
-- Backs: p2pOrders.getOpenOrders(order_type, limit)
--   SELECT ... FROM p2p_orders
--   WHERE order_type = $1 AND status = 'open' AND expires_at > NOW()
--   ORDER BY created_at ASC
--   LIMIT $2
-- The existing idx_p2p_orders_type_status on (order_type, status) covers
-- the equality part but forces a filter pass for expires_at. This partial
-- index is restricted to status = 'open' (the only status the matching
-- engine cares about) so it stays small and the expires_at column is
-- naturally clustered with the row order.
CREATE INDEX IF NOT EXISTS idx_p2p_orders_order_book
  ON p2p_orders (order_type, status, expires_at)
  WHERE status = 'open';

-- ------------------------------------------------------------------------------
-- p2p_orders: status-based filtering for stats and sweeps
-- ------------------------------------------------------------------------------
-- Backs: p2pOrders.getByStatus, p2pOrders.getStats, p2pOrders.getDisputed,
-- and cleanupExpired()'s UPDATE that filters by status.
--   SELECT ... FROM p2p_orders
--   WHERE status = $1
--   ORDER BY created_at DESC
--   LIMIT $2 OFFSET $3
-- Single-column idx_p2p_orders_status exists for the equality part; this
-- composite adds created_at DESC so ORDER BY is satisfied without a sort.
CREATE INDEX IF NOT EXISTS idx_p2p_orders_status_created_at
  ON p2p_orders (status, created_at DESC);

-- ------------------------------------------------------------------------------
-- p2p_orders: escrow sweep queries (escrow_status filtering)
-- ------------------------------------------------------------------------------
-- Backs: p2pOrders.getExpiredLockedEscrows() and any cron/sweeper that
-- filters by escrow_status (e.g. moderator dashboards, lending
-- settlement reconciliation). Most rows have escrow_status = 'none' which
-- we want to exclude from the index entirely.
-- The single-column idx_p2p_orders_escrow_status (defined in schema.sql)
-- already exists for the equality predicate; this composite is a STRICT
-- SUPERSET for sweep queries that also order by created_at, and the
-- partial WHERE clause keeps it small. Named differently from the
-- existing index because Postgres treats index names as identifiers
-- (same name = same index, not a replacement).
CREATE INDEX IF NOT EXISTS idx_p2p_orders_escrow_status_sweep
  ON p2p_orders (escrow_status, created_at)
  WHERE escrow_status IS NOT NULL;

-- ------------------------------------------------------------------------------
-- wallets: address lookups (auth, payment verification)
-- ------------------------------------------------------------------------------
-- Backs: wallets.getByAddress, wallets.updateActivity, wallets.updateStatus,
-- wallets.delete -- every wallet DAL method keys on address.
-- Note: the wallets table column is named `address` (not `xrpl_address`),
-- and the column already carries a UNIQUE constraint which gives Postgres
-- a backing btree index. This CREATE INDEX is therefore a no-op on a
-- database where the UNIQUE index is present; it is kept here as an
-- explicit, named declaration so EXPLAIN plans are predictable and
-- future schema changes (e.g. dropping the UNIQUE) still leave the
-- address lookup index in place. The migration is idempotent.
CREATE INDEX IF NOT EXISTS idx_wallets_xrpl_address
  ON wallets (address);

-- ------------------------------------------------------------------------------
-- transactions: wallet transaction history
-- ------------------------------------------------------------------------------
-- Backs: outgoing-tx history for the wallet view, e.g.
--   SELECT ... FROM transactions
--   WHERE from_address = $1
--   ORDER BY created_at DESC
-- The transactions table has no `wallet_address` column -- it uses
-- `from_address` (sender) and `to_address` (recipient). The single-column
-- idx_transactions_from_address already exists for the equality part;
-- this composite adds created_at DESC so the most-recent-N query is a
-- single index scan, no sort.
-- (For incoming-tx history the symmetric index on (to_address, created_at)
-- is also covered by the existing idx_transactions_to_address plus a sort
-- pass; if that becomes hot, add a symmetric composite in a follow-up.)
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_address_created_at
  ON transactions (from_address, created_at DESC);

-- ------------------------------------------------------------------------------
-- payment_requests: status + expiry for sweep queries
-- ------------------------------------------------------------------------------
-- Backs: any sweeper that cancels/expires payment requests in
-- (status IN ('pending', 'active')) with expires_at < NOW().
-- The single-column indexes idx_payment_requests_status and
-- idx_payment_requests_expires_at already exist; this partial composite
-- restricts to the two non-terminal statuses so the index is small and
-- cheap to maintain as the table grows.
CREATE INDEX IF NOT EXISTS idx_payment_requests_status_expires_at
  ON payment_requests (status, expires_at)
  WHERE status IN ('pending', 'active');

-- ------------------------------------------------------------------------------
-- auth_challenges: cleanup of expired challenges
-- ------------------------------------------------------------------------------
-- Backs: the cron that deletes rows where expires_at < NOW() (used vs.
-- unused challenges both expire and are purged together -- the schema
-- has no `used` column, so we index every row).
-- The address PK and idx_auth_challenges_nonce already cover verification
-- lookups; this single-column index on expires_at lets the cleanup
-- sweeper do an index range scan instead of a seq scan.
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at
  ON auth_challenges (expires_at);
