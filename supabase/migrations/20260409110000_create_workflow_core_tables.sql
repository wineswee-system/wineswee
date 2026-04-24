-- ============================================================
-- Create workflow_instances and workflow_steps
--
-- These are the core execution tables for the workflow system.
-- The init schema (20260405053819) only creates `workflows`
-- (a template catalog); this migration creates the runtime tables.
--
-- Must run before 20260409120000 which ALTERs both tables.
-- Safe on a live DB — uses CREATE TABLE IF NOT EXISTS.
-- ============================================================

-- ── Runtime instances of workflow templates ──────────────────
CREATE TABLE IF NOT EXISTS workflow_instances (
  id            SERIAL PRIMARY KEY,
  template_name TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '進行中',
  store         TEXT,
  assignee      TEXT,
  started_by    TEXT,
  started_at    TIMESTAMPTZ DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workflow_instances' AND policyname = 'anon_workflow_instances'
  ) THEN
    CREATE POLICY anon_workflow_instances ON workflow_instances
      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Step definitions within a workflow instance ───────────────
CREATE TABLE IF NOT EXISTS workflow_steps (
  id           SERIAL PRIMARY KEY,
  instance_id  INT REFERENCES workflow_instances(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT DEFAULT '待處理',
  assignee     TEXT,
  role         TEXT,
  step_order   INT DEFAULT 0,
  step_type    TEXT,
  due_date     DATE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_instance ON workflow_steps(instance_id);

ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workflow_steps' AND policyname = 'anon_workflow_steps'
  ) THEN
    CREATE POLICY anon_workflow_steps ON workflow_steps
      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
