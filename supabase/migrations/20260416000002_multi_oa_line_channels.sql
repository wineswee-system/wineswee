-- ============================================================
--  Migration: Multi-OA LINE Channel Support
--  Allows a single employee to be mapped to multiple
--  LINE Official Accounts, each with its own credentials.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. LINE Channels (Official Account registry)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_channels (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                -- short code e.g. 'sme-ops', 'wines'
  name TEXT NOT NULL,                       -- display name e.g. 'SME Ops 官方帳號'
  channel_id TEXT,                          -- LINE Channel ID
  liff_id TEXT,                             -- LIFF App ID for this channel
  webhook_url TEXT,                         -- webhook endpoint
  is_default BOOLEAN DEFAULT false,         -- default channel for notifications
  status TEXT DEFAULT 'active',             -- active, paused, archived
  metadata JSONB DEFAULT '{}',              -- rich menu ID, greeting, etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- NOTE: channel_secret and channel_access_token are stored in
-- Supabase Edge Function env vars, NOT in this table.
-- Convention: LINE_CHANNEL_SECRET_{CODE}, LINE_CHANNEL_TOKEN_{CODE}
-- e.g. LINE_CHANNEL_SECRET_SME_OPS, LINE_CHANNEL_TOKEN_WINES

COMMENT ON TABLE line_channels IS 'Registry of LINE Official Accounts. Secrets stored in Edge Function env vars.';


-- ────────────────────────────────────────────────────────────
-- 2. Employee ↔ LINE Account mapping (many-to-many)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_line_accounts (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  channel_id INT NOT NULL REFERENCES line_channels(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,               -- LINE user ID (unique per channel)
  display_name TEXT,                        -- LINE display name
  picture_url TEXT,                         -- LINE profile picture
  is_primary BOOLEAN DEFAULT false,         -- preferred channel for this employee
  is_verified BOOLEAN DEFAULT false,        -- employee confirmed identity
  linked_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ,
  UNIQUE(channel_id, line_user_id),         -- one LINE user per channel
  UNIQUE(employee_id, channel_id)           -- one mapping per employee per channel
);

CREATE INDEX IF NOT EXISTS idx_ela_employee ON employee_line_accounts(employee_id);
CREATE INDEX IF NOT EXISTS idx_ela_channel ON employee_line_accounts(channel_id);
CREATE INDEX IF NOT EXISTS idx_ela_line_user ON employee_line_accounts(line_user_id);

COMMENT ON TABLE employee_line_accounts IS 'Maps employees to LINE user IDs across multiple Official Accounts.';


-- ────────────────────────────────────────────────────────────
-- 3. LINE message logs (per-channel)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_messages (
  id SERIAL PRIMARY KEY,
  channel_id INT REFERENCES line_channels(id) ON DELETE SET NULL,
  line_user_id TEXT,
  display_name TEXT,
  message_text TEXT,
  source_type TEXT DEFAULT 'user',          -- user, group, room
  direction TEXT DEFAULT 'incoming',        -- incoming, outgoing, outgoing_failed
  group_id TEXT,
  event_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_msg_channel ON line_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_line_msg_user ON line_messages(line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_msg_created ON line_messages(created_at);

-- ────────────────────────────────────────────────────────────
-- 4. LINE command logs (per-channel)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_command_logs (
  id SERIAL PRIMARY KEY,
  channel_id INT REFERENCES line_channels(id) ON DELETE SET NULL,
  line_user_id TEXT,
  display_name TEXT,
  command_matched TEXT,
  raw_input TEXT,
  source_type TEXT DEFAULT 'user',
  group_id TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  execution_ms INT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_cmd_channel ON line_command_logs(channel_id);
CREATE INDEX IF NOT EXISTS idx_line_cmd_created ON line_command_logs(created_at);

-- ────────────────────────────────────────────────────────────
-- 5. LINE error logs (per-channel)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_error_logs (
  id SERIAL PRIMARY KEY,
  channel_id INT REFERENCES line_channels(id) ON DELETE SET NULL,
  line_user_id TEXT,
  source_type TEXT,
  group_id TEXT,
  error_type TEXT,
  error_message TEXT,
  error_stack TEXT,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_err_channel ON line_error_logs(channel_id);
CREATE INDEX IF NOT EXISTS idx_line_err_created ON line_error_logs(created_at);

-- ────────────────────────────────────────────────────────────
-- 6. LINE groups (per-channel)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_groups (
  id SERIAL PRIMARY KEY,
  channel_id INT REFERENCES line_channels(id) ON DELETE SET NULL,
  line_group_id TEXT NOT NULL,
  group_name TEXT,
  group_type TEXT DEFAULT 'general',        -- general, department, store, project
  is_active BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(channel_id, line_group_id)
);

CREATE INDEX IF NOT EXISTS idx_line_grp_channel ON line_groups(channel_id);

-- ────────────────────────────────────────────────────────────
-- 7. LINE group members
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_group_members (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL REFERENCES line_groups(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, line_user_id)
);

-- ────────────────────────────────────────────────────────────
-- 8. LINE daily summaries (per-channel group)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_daily_summaries (
  id SERIAL PRIMARY KEY,
  channel_id INT REFERENCES line_channels(id) ON DELETE SET NULL,
  group_id TEXT,
  summary_date DATE NOT NULL,
  message_count INT DEFAULT 0,
  unique_users INT DEFAULT 0,
  user_names TEXT[],
  summary_text TEXT,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(channel_id, group_id, summary_date)
);

-- ────────────────────────────────────────────────────────────
-- 9. Migrate existing employees.line_user_id → employee_line_accounts
--    If a default channel exists, map existing bindings to it.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  default_channel_id INT;
BEGIN
  -- Create a default channel if none exists
  INSERT INTO line_channels (code, name, is_default, status)
  VALUES ('default', 'Default LINE OA', true, 'active')
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO default_channel_id FROM line_channels WHERE code = 'default';

  -- Migrate existing employee LINE bindings
  IF default_channel_id IS NOT NULL THEN
    INSERT INTO employee_line_accounts (employee_id, channel_id, line_user_id, is_primary, is_verified)
    SELECT e.id, default_channel_id, e.line_user_id, true, true
    FROM employees e
    WHERE e.line_user_id IS NOT NULL
      AND e.line_user_id != ''
    ON CONFLICT (employee_id, channel_id) DO NOTHING;
  END IF;

  -- Also migrate line_users table entries if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'line_users') THEN
    INSERT INTO employee_line_accounts (employee_id, channel_id, line_user_id, display_name, is_primary)
    SELECT e.id, default_channel_id, lu.line_user_id, lu.display_name, true
    FROM line_users lu
    JOIN employees e ON e.name = lu.bound_employee
    WHERE lu.bound_employee IS NOT NULL
      AND default_channel_id IS NOT NULL
    ON CONFLICT (employee_id, channel_id) DO NOTHING;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 10. Helper view: resolve employee → LINE user for a channel
-- ────────────────────────────────────────────────────────────
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


-- ────────────────────────────────────────────────────────────
-- 11. RLS policies
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'line_channels',
    'employee_line_accounts',
    'line_messages',
    'line_command_logs',
    'line_error_logs',
    'line_groups',
    'line_group_members',
    'line_daily_summaries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'anon_' || tbl) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO anon USING (true) WITH CHECK (true)',
        'anon_' || tbl, tbl
      );
    END IF;
  END LOOP;
END $$;
