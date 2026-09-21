-- ============================================================
--  Migration: Finalize multi-OA LINE integration
--  - Adds channel_id to line_users (webhook state per channel)
--  - Safety backfill of employee_line_accounts from legacy column
--  - Drops legacy employees.line_user_id
-- ============================================================

-- 1. Make webhook state (line_users) channel-aware
ALTER TABLE line_users ADD COLUMN IF NOT EXISTS channel_id INT REFERENCES line_channels(id) ON DELETE SET NULL;

-- Drop the old single-channel unique on line_user_id so we can make it composite.
DO $$
DECLARE
  ukey TEXT;
BEGIN
  SELECT conname INTO ukey
  FROM pg_constraint
  WHERE conrelid = 'line_users'::regclass
    AND contype = 'u'
    AND conkey = (
      SELECT ARRAY[a.attnum]
      FROM pg_attribute a
      WHERE a.attrelid = 'line_users'::regclass AND a.attname = 'line_user_id'
    );
  IF ukey IS NOT NULL THEN
    EXECUTE format('ALTER TABLE line_users DROP CONSTRAINT %I', ukey);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_line_users_channel_user ON line_users(channel_id, line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_users_channel ON line_users(channel_id);

-- 2. Safety backfill: ensure employee_line_accounts covers everything the legacy
--    column still points at (previous migration already handled most of this).
DO $$
DECLARE
  default_channel_id INT;
BEGIN
  SELECT id INTO default_channel_id FROM line_channels WHERE is_default = true LIMIT 1;
  IF default_channel_id IS NULL THEN
    SELECT id INTO default_channel_id FROM line_channels ORDER BY id ASC LIMIT 1;
  END IF;

  IF default_channel_id IS NULL THEN
    RAISE NOTICE 'No line_channels row exists — skipping backfill. Run once a channel is registered.';
  ELSE
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'employees' AND column_name = 'line_user_id'
    ) THEN
      INSERT INTO employee_line_accounts (employee_id, channel_id, line_user_id, is_primary, is_verified, linked_at)
      SELECT e.id, default_channel_id, e.line_user_id, true, true, now()
      FROM employees e
      WHERE e.line_user_id IS NOT NULL
        AND e.line_user_id <> ''
        AND NOT EXISTS (
          SELECT 1 FROM employee_line_accounts ela
          WHERE ela.employee_id = e.id AND ela.channel_id = default_channel_id
        );
    END IF;

    -- Backfill channel_id on line_users
    UPDATE line_users SET channel_id = default_channel_id WHERE channel_id IS NULL;
  END IF;
END $$;

-- 3. Drop the legacy column (all application code updated in this release)
ALTER TABLE employees DROP COLUMN IF EXISTS line_user_id;

-- 4. Refresh the helper view so it no longer references the dropped column path
CREATE OR REPLACE VIEW v_employee_line_resolved AS
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  ela.line_user_id,
  ela.display_name AS line_display_name,
  ela.is_primary,
  ela.channel_id,
  lc.code AS channel_code,
  lc.name AS channel_name,
  lc.liff_id
FROM employees e
JOIN employee_line_accounts ela ON ela.employee_id = e.id
JOIN line_channels lc ON lc.id = ela.channel_id
WHERE lc.status = 'active';
