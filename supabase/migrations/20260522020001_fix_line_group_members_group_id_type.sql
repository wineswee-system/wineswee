-- ════════════════════════════════════════════════════════════════════════════
-- Fix line_group_members.group_id type: INT → TEXT
-- Fix line_users: add missing updated_at column
--
-- Root cause:
--   20260416100004 created line_group_members with group_id INT FK → line_groups.id
--   20260418000001 tried to redefine with group_id TEXT but IF NOT EXISTS skipped it
--   Edge function passes raw LINE group IDs (e.g. "C875...") causing 22P02 errors
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Fix line_group_members.group_id: INT → TEXT ──────────────────────────

-- Drop FK constraint (auto-named by Postgres)
ALTER TABLE public.line_group_members
  DROP CONSTRAINT IF EXISTS line_group_members_group_id_fkey;

-- Drop unique constraint that references the INT column
ALTER TABLE public.line_group_members
  DROP CONSTRAINT IF EXISTS line_group_members_group_id_line_user_id_key;

-- Cast existing integer values to text (handles any legacy rows)
ALTER TABLE public.line_group_members
  ALTER COLUMN group_id TYPE TEXT USING group_id::TEXT;

-- Restore unique constraint matching the intended (line_user_id, group_id) schema
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'line_group_members_line_user_id_group_id_key'
      AND conrelid = 'public.line_group_members'::regclass
  ) THEN
    ALTER TABLE public.line_group_members
      ADD CONSTRAINT line_group_members_line_user_id_group_id_key
      UNIQUE (line_user_id, group_id);
  END IF;
END $$;

-- ─── 2. Add missing updated_at column to line_users ──────────────────────────
-- Edge function always sends { updated_at: now } in every PATCH causing 400 errors

ALTER TABLE public.line_users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

COMMIT;
