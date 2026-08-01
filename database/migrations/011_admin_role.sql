-- Migration 011: Add admin role
-- Upgrades the role check constraint to include 'admin'

DO $$
DECLARE
    role_constraint text;
BEGIN
    -- Find the auto-generated check constraint for the role column
    SELECT conname INTO role_constraint
    FROM pg_constraint
    WHERE conrelid = 'wallets'::regclass 
      AND contype = 'c' 
      AND pg_get_constraintdef(oid) LIKE '%role IN%';

    IF role_constraint IS NOT NULL THEN
        EXECUTE 'ALTER TABLE wallets DROP CONSTRAINT ' || role_constraint;
    END IF;
END $$;

-- Add the updated constraint
ALTER TABLE wallets ADD CONSTRAINT wallets_role_check CHECK (role IN ('buyer', 'seller', 'admin'));

-- Insert circuit breaker setting
INSERT INTO system_settings (key, value, description) VALUES
('circuit_breaker_percentage', '10.0', 'Halt trading if XRP/TRY rate changes by this percentage in 5 minutes')
ON CONFLICT (key) DO NOTHING;
