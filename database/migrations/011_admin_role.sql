-- Migration 011: Add admin role
-- Upgrades the role check constraint to include 'admin'.
--
-- Idempotent: drops ANY check constraint referencing wallets.role and re-adds
-- the three-role constraint. PostgreSQL rewrites `x IN (...)` into
-- `x = ANY (ARRAY[...])` internally, so matching the constraint by its
-- definition text (`LIKE '%role IN%'`) is unreliable — it silently skipped the
-- drop and the migration never applied. We match by column reference instead.

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname, c.conrelid, c.conkey
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'wallets'
      AND c.contype = 'c'
  LOOP
    IF con.conkey IS NOT NULL AND EXISTS (
      SELECT 1 FROM unnest(con.conkey) AS pos(attnum_val)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = pos.attnum_val
      WHERE a.attname = 'role'
    ) THEN
      EXECUTE 'ALTER TABLE wallets DROP CONSTRAINT IF EXISTS ' || quote_ident(con.conname);
    END IF;
  END LOOP;
END $$;

ALTER TABLE wallets ADD CONSTRAINT wallets_role_check CHECK (role IN ('buyer', 'seller', 'admin'));

-- Insert circuit breaker setting
INSERT INTO system_settings (key, value, description) VALUES
('circuit_breaker_percentage', '10.0', 'Halt trading if XRP/TRY rate changes by this percentage in 5 minutes')
ON CONFLICT (key) DO NOTHING;
