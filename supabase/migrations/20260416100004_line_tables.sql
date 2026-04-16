-- ============================================================
-- Phase 4: LINE Tables Restructuring
-- Purpose: Expand line_users with FK, add full LINE messaging pipeline
-- ============================================================

-- ─── 4a. Expand existing line_users ───

-- Add serial PK if table uses line_user_id as PK
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'line_users' AND column_name = 'id'
  ) THEN
    ALTER TABLE line_users ADD COLUMN id SERIAL;
  END IF;
END $$;

ALTER TABLE line_users ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id);
ALTER TABLE line_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE line_users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE line_users ADD COLUMN IF NOT EXISTS pending_action JSONB;
ALTER TABLE line_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Backfill employee_id from bound_employee TEXT
UPDATE line_users lu
SET employee_id = e.id
FROM employees e
WHERE lu.bound_employee = e.name
  AND lu.employee_id IS NULL;

-- Mark verified if bound to employee
UPDATE line_users
SET is_verified = true
WHERE employee_id IS NOT NULL
  AND is_verified = false;

CREATE INDEX IF NOT EXISTS idx_line_users_employee_id ON line_users(employee_id);

-- ─── 4b. LINE Groups ───

CREATE TABLE IF NOT EXISTS line_groups (
  id SERIAL PRIMARY KEY,
  line_group_id TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL,
  group_type TEXT NOT NULL DEFAULT 'general',  -- general, department, store, project
  is_active BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_groups_type ON line_groups(group_type);

-- ─── 4c. LINE Group Members ───

CREATE TABLE IF NOT EXISTS line_group_members (
  line_group_id INT NOT NULL REFERENCES line_groups(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (line_group_id, line_user_id)
);

-- ─── 4d. Department ↔ LINE Group mapping ───

CREATE TABLE IF NOT EXISTS department_line_groups (
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  line_group_id INT NOT NULL REFERENCES line_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id, line_group_id)
);

-- ─── 4e. LINE Messages (full message log) ───

CREATE TABLE IF NOT EXISTS line_messages (
  id SERIAL PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  message_text TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'user',       -- user, bot
  direction TEXT NOT NULL DEFAULT 'incoming',      -- incoming, outgoing
  group_id TEXT,
  event_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_messages_user ON line_messages(line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_messages_group ON line_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_line_messages_created ON line_messages(created_at DESC);

-- ─── 4f. LINE Command Logs ───

CREATE TABLE IF NOT EXISTS line_command_logs (
  id SERIAL PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  command_matched TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'user',
  group_id TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_entity_type TEXT,
  created_entity_id INT,
  metadata JSONB,
  execution_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_commands_user ON line_command_logs(line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_commands_created ON line_command_logs(created_at DESC);

-- ─── 4g. LINE Error Logs ───

CREATE TABLE IF NOT EXISTS line_error_logs (
  id SERIAL PRIMARY KEY,
  line_user_id TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── 4h. LINE Daily Summaries (AI-generated) ───

CREATE TABLE IF NOT EXISTS line_daily_summaries (
  id SERIAL PRIMARY KEY,
  group_id TEXT NOT NULL,
  group_name TEXT,
  summary_date DATE NOT NULL,
  message_count INT NOT NULL DEFAULT 0,
  unique_users INT DEFAULT 0,
  user_names TEXT[],
  summary_text TEXT NOT NULL DEFAULT '',
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (group_id, summary_date)
);

-- ─── 4i. LINE Weekly Summaries ───

CREATE TABLE IF NOT EXISTS line_weekly_summaries (
  id SERIAL PRIMARY KEY,
  group_id TEXT NOT NULL,
  group_name TEXT,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_messages INT DEFAULT 0,
  key_decisions TEXT[],
  action_items TEXT[],
  summary_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (group_id, week_start)
);

-- ─── 4j. LINE Monthly Summaries ───

CREATE TABLE IF NOT EXISTS line_monthly_summaries (
  id SERIAL PRIMARY KEY,
  group_id TEXT NOT NULL,
  group_name TEXT,
  month TEXT NOT NULL,  -- 'YYYY-MM'
  total_messages INT DEFAULT 0,
  notable_events TEXT[],
  summary_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (group_id, month)
);

-- ─── RLS for all LINE tables ───

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'line_groups', 'line_group_members', 'department_line_groups',
    'line_messages', 'line_command_logs', 'line_error_logs',
    'line_daily_summaries', 'line_weekly_summaries', 'line_monthly_summaries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'anon_' || t) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', 'anon_' || t, t);
    END IF;
  END LOOP;
END $$;
