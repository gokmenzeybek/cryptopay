-- Migration 007: add updated_at to transactions and payment_requests (PRD 3.3.3)
-- TransactionsDAL.updateStatus and PaymentRequestsDAL.updateStatus/markAsPaid/cleanupExpired
-- write updated_at, but schema.sql never declared the columns.
-- (PRD text said "migration 006"; 006 was already used by papara_payments — see §10 #14.)
-- Idempotent.

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE payment_requests
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
