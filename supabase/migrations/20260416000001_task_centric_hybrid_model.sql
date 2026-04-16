-- ============================================================
--  Migration: Task-Centric Hybrid Model
--  Merges wines task/workflow model into sme-ops
--
--  Strategy:
--    1. Expand `tasks` table to be THE central execution entity
--    2. Keep `workflow_steps` as template definitions only
--    3. Create task-centric satellite tables (dependencies, comments, etc.)
--    4. Migrate existing workflow_step execution data → tasks
--    5. Add confirmation system (from wines)
--    6. Create backward-compatible views
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Expand `tasks` table — add all missing execution columns
-- ────────────────────────────────────────────────────────────

-- Link tasks to workflow execution
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_instance_id INT REFERENCES workflow_instances(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_step_id INT;
  -- FK added below after we ensure workflow_steps exists

-- Execution fields
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS store TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to TEXT;          -- employee name (mirrors assignee for compat)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_start DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TIME DEFAULT '17:00';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS step_order INT;           -- ordering within workflow
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS step_type TEXT;           -- step type from template
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS role TEXT;                -- required role for this task
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS bucket TEXT DEFAULT 'General';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Reminder
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ;

-- Confirmation (lightweight, from wines)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_required BOOLEAN DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_status TEXT;    -- pending, approved, rejected
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_requested_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_responded_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_notes TEXT;

-- Approval chain link (structured, from sme-ops)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_chain_id INT REFERENCES approval_chains(id) ON DELETE SET NULL;

-- Dependencies as JSON (display cache, from wines — source of truth is task_dependencies table)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS trigger_actions TEXT[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_conditions TEXT[];

-- Add FK for workflow_step_id if workflow_steps table has id column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'workflow_steps' AND column_name = 'id') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                   WHERE constraint_name = 'tasks_workflow_step_id_fkey') THEN
      ALTER TABLE tasks ADD CONSTRAINT tasks_workflow_step_id_fkey
        FOREIGN KEY (workflow_step_id) REFERENCES workflow_steps(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_tasks_updated_at();

-- Indexes on tasks
CREATE INDEX IF NOT EXISTS idx_tasks_workflow_instance ON tasks(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow_step ON tasks(workflow_step_id);
CREATE INDEX IF NOT EXISTS idx_tasks_store_id ON tasks(store_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_bucket ON tasks(bucket);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_confirmation ON tasks(confirmation_status) WHERE confirmation_required = true;


-- ────────────────────────────────────────────────────────────
-- 2. Task-centric satellite tables
-- ────────────────────────────────────────────────────────────

-- 2a. Task Dependencies (relational — replaces JSON arrays as source of truth)
CREATE TABLE IF NOT EXISTS task_dependencies (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dep_type TEXT NOT NULL DEFAULT 'prerequisite',  -- 'prerequisite' or 'trigger'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, depends_on_task_id, dep_type)
);

CREATE INDEX IF NOT EXISTS idx_task_dep_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dep_depends ON task_dependencies(depends_on_task_id);

-- 2b. Task Comments
CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author TEXT NOT NULL DEFAULT '系統',
  content TEXT NOT NULL,
  source TEXT DEFAULT 'web',   -- 'web', 'line', 'system' (from wines)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

-- 2c. Task Attachments (with Supabase Storage support)
CREATE TABLE IF NOT EXISTS task_attachments (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT,           -- Supabase Storage path (from wines)
  file_url TEXT,               -- Direct URL fallback (from sme-ops)
  file_size INT,
  mime_type TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

-- 2d. Task Checklists (link reusable checklist templates)
CREATE TABLE IF NOT EXISTS task_checklists (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  checklist_id INT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, checklist_id)
);

CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id);

-- 2e. Task Checklist Items (inline items, not from template)
CREATE TABLE IF NOT EXISTS task_checklist_items (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  checked BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_checklist_items_task ON task_checklist_items(task_id);

-- 2f. Task Confirmations (multi-approver, from wines)
CREATE TABLE IF NOT EXISTS task_confirmations (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  approver TEXT NOT NULL,            -- employee name (sme-ops uses TEXT names)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  notes TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, approver)
);

CREATE INDEX IF NOT EXISTS idx_task_confirmations_task ON task_confirmations(task_id);
CREATE INDEX IF NOT EXISTS idx_task_confirmations_status ON task_confirmations(status);

-- 2g. Approval Forms — add task reference (complement to existing ref_step_id)
ALTER TABLE approval_forms ADD COLUMN IF NOT EXISTS ref_task_id INT REFERENCES tasks(id) ON DELETE SET NULL;


-- ────────────────────────────────────────────────────────────
-- 3. Supabase Storage bucket for task attachments
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  false,
  52428800,  -- 50 MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 4. Enrich checklists table (from wines)
-- ────────────────────────────────────────────────────────────
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS store TEXT;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id) ON DELETE SET NULL;
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE checklists ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();


-- ────────────────────────────────────────────────────────────
-- 5. SOP Templates table (if not exists)
--    Stores reusable SOP definitions separate from workflows
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sop_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  steps JSONB DEFAULT '[]',  -- [{name, description, step_order, step_type, estimated_minutes, suggested_role}]
  status TEXT DEFAULT 'active',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ────────────────────────────────────────────────────────────
-- 6. Data migration: workflow_steps (execution) → tasks
--    Copies active workflow step data into tasks table
--    so all work items live in one place.
--    Original workflow_step rows are preserved for reference.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  step_row RECORD;
  new_task_id INT;
BEGIN
  -- Only migrate steps that are execution instances (have instance_id)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'workflow_steps' AND column_name = 'instance_id') THEN

    FOR step_row IN
      SELECT ws.*
      FROM workflow_steps ws
      -- Skip steps that already have a corresponding task
      WHERE NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.workflow_step_id = ws.id
      )
      ORDER BY ws.id
    LOOP
      INSERT INTO tasks (
        title, description, status, priority, assignee, assigned_to,
        workflow_instance_id, workflow_step_id,
        store, planned_start, due_date, due_time, notes,
        step_order, step_type, role, category,
        bucket, reminder_at, completed_at,
        confirmation_required, confirmation_status,
        created_at
      ) VALUES (
        COALESCE(step_row.title, '未命名步驟'),
        step_row.description,
        COALESCE(step_row.status, '未開始'),
        COALESCE(step_row.priority, '中'),
        step_row.assignee,
        step_row.assignee,
        step_row.instance_id,
        step_row.id,
        step_row.store,
        step_row.planned_start,
        step_row.due_date,
        step_row.due_time,
        step_row.notes,
        step_row.step_order,
        step_row.step_type,
        step_row.role,
        COALESCE(step_row.category, 'Workflow'),
        'Workflow',
        step_row.reminder_at,
        step_row.completed_at,
        COALESCE(step_row.confirmed, false),
        CASE WHEN step_row.confirmed = true THEN 'approved' ELSE NULL END,
        COALESCE(step_row.created_at, now())
      )
      RETURNING id INTO new_task_id;

      -- Migrate step comments → task comments
      INSERT INTO task_comments (task_id, author, content, created_at)
      SELECT new_task_id, author, content, created_at
      FROM workflow_step_comments
      WHERE step_id = step_row.id;

      -- Migrate step attachments → task attachments
      INSERT INTO task_attachments (task_id, file_name, file_url, file_size, uploaded_by, created_at)
      SELECT new_task_id, file_name, file_url, file_size, uploaded_by, created_at
      FROM workflow_step_attachments
      WHERE step_id = step_row.id;

      -- Migrate step checklists → task checklists
      INSERT INTO task_checklists (task_id, checklist_id, created_at)
      SELECT new_task_id, checklist_id, created_at
      FROM workflow_step_checklists
      WHERE step_id = step_row.id;

      -- Migrate step checklist items → task checklist items
      INSERT INTO task_checklist_items (task_id, title, checked, sort_order, created_at)
      SELECT new_task_id, title, checked, sort_order, created_at
      FROM workflow_step_checklist_items
      WHERE step_id = step_row.id;

    END LOOP;

    -- Migrate dependencies (step→step → task→task)
    INSERT INTO task_dependencies (task_id, depends_on_task_id, dep_type, created_at)
    SELECT
      t1.id,
      t2.id,
      wsd.dep_type,
      wsd.created_at
    FROM workflow_step_dependencies wsd
    JOIN tasks t1 ON t1.workflow_step_id = wsd.step_id
    JOIN tasks t2 ON t2.workflow_step_id = wsd.depends_on_step_id
    WHERE NOT EXISTS (
      SELECT 1 FROM task_dependencies td
      WHERE td.task_id = t1.id
        AND td.depends_on_task_id = t2.id
        AND td.dep_type = wsd.dep_type
    );

    -- Migrate approval_forms ref_step_id → ref_task_id
    UPDATE approval_forms af
    SET ref_task_id = t.id
    FROM tasks t
    WHERE af.ref_step_id = t.workflow_step_id
      AND af.ref_task_id IS NULL;

  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 7. Backward-compatible views
--    So existing queries against workflow_step_* still work
--    during the transition period.
-- ────────────────────────────────────────────────────────────

-- View: tasks with workflow context (replaces direct workflow_steps queries)
-- Note: workflow_instances uses template_name (not name), and has no workflow_id FK
CREATE OR REPLACE VIEW v_tasks_full AS
SELECT
  t.*,
  wi.template_name AS workflow_instance_name,
  wi.status        AS workflow_instance_status,
  wi.store         AS workflow_instance_store
FROM tasks t
LEFT JOIN workflow_instances wi ON t.workflow_instance_id = wi.id;

-- View: workflow instance progress (task-based)
CREATE OR REPLACE VIEW v_workflow_instance_progress AS
SELECT
  wi.id AS instance_id,
  wi.template_name AS instance_name,
  wi.status AS instance_status,
  wi.store AS instance_store,
  wi.assignee AS instance_assignee,
  wi.started_at,
  COUNT(t.id) AS total_tasks,
  COUNT(t.id) FILTER (WHERE t.status = '已完成') AS completed_tasks,
  COUNT(t.id) FILTER (WHERE t.status = '進行中') AS active_tasks,
  COUNT(t.id) FILTER (WHERE t.status IN ('未開始', '待處理')) AS pending_tasks,
  COUNT(t.id) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status NOT IN ('已完成', '已取消')) AS overdue_tasks,
  CASE
    WHEN COUNT(t.id) = 0 THEN 0
    ELSE ROUND(100.0 * COUNT(t.id) FILTER (WHERE t.status = '已完成') / COUNT(t.id))
  END AS completion_pct
FROM workflow_instances wi
LEFT JOIN tasks t ON t.workflow_instance_id = wi.id
GROUP BY wi.id, wi.template_name, wi.status, wi.store, wi.assignee, wi.started_at;


-- ────────────────────────────────────────────────────────────
-- 8. RLS policies for new tables
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'task_dependencies',
    'task_comments',
    'task_attachments',
    'task_checklists',
    'task_checklist_items',
    'task_confirmations',
    'sop_templates'
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

-- Storage policy for task-attachments bucket
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'task_attachments_anon') THEN
    CREATE POLICY task_attachments_anon ON storage.objects
      FOR ALL TO anon
      USING (bucket_id = 'task-attachments')
      WITH CHECK (bucket_id = 'task-attachments');
  END IF;
END $$;
