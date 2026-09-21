-- ============================================================
-- Phase 4.1 — Upgrade high-volume PKs SERIAL → BIGINT
--
-- ⚠ DESTRUCTIVE / LOCKING — DO NOT APPLY DURING BUSINESS HOURS ⚠
--
-- ALTER COLUMN ... TYPE BIGINT acquires AccessExclusiveLock and rewrites
-- the table. With current row counts (audit_logs ?, attendance 21, etc.) this
-- is fast — but with realistic load it's a maintenance-window operation.
--
-- Also: PostgREST returns BIGINT as STRING (to preserve precision in JS).
-- App code that compares ids with === to a number will break:
--   row.id === 5  →  "5" === 5  →  false
-- Audit src/lib/db.js and src/pages/**/*.jsx for `=== id` patterns first,
-- and convert to either parseInt or string compare.
--
-- This migration is intentionally idempotent and safe to skip if not needed yet.
-- ============================================================

BEGIN;

DO $$
DECLARE
  t TEXT;
  candidates TEXT[] := ARRAY[
    'attendance_records','audit_logs','event_outbox','journal_entries',
    'line_command_logs','line_error_logs','line_messages',
    'notifications','pos_transactions','task_activity'
  ];
BEGIN
  FOREACH t IN ARRAY candidates LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t) THEN
      CONTINUE;
    END IF;

    -- Already bigint? skip
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t
        AND column_name='id' AND data_type='bigint'
    ) THEN
      RAISE NOTICE 'Skipping % (already bigint)', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id TYPE BIGINT', t);
    EXECUTE format('ALTER SEQUENCE IF EXISTS public.%I_id_seq AS BIGINT', t);
    RAISE NOTICE 'Upgraded %.id to BIGINT', t;
  END LOOP;
END $$;

COMMIT;
