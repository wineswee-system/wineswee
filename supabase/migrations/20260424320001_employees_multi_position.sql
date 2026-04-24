-- Add secondary and tertiary position columns to employees.
-- These were added to supabase-schema.sql last session but never got a migration.

BEGIN;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS position_secondary TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS position_third      TEXT;

COMMIT;
