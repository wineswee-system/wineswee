-- ============================================================
--  Migration: Task Collaboration, Projects v2, Views Support
--  Closes Asana/Jira feature gaps:
--    1. task_watchers        — followers / collaborators
--    2. task_mentions        — @mention parsing + notification state
--    3. project_members      — first-class project membership + roles
--    4. project_sections     — kanban columns / asana sections
--    5. project_custom_fields + task_custom_field_values
--    6. tasks.recurrence_rule + tasks.recurrence_parent_id
--    7. tasks.project_id + tasks.section_id (direct link)
--    8. task_activity        — per-task audit timeline
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. task_watchers (followers / collaborators)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_watchers (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  employee_name TEXT,                       -- fallback when no id (TEXT-only org data)
  role TEXT NOT NULL DEFAULT 'watcher',     -- 'watcher' | 'collaborator'
  added_by TEXT,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, employee_id),
  CHECK (employee_id IS NOT NULL OR employee_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_task_watchers_task ON task_watchers(task_id);
CREATE INDEX IF NOT EXISTS idx_task_watchers_employee ON task_watchers(employee_id);


-- ────────────────────────────────────────────────────────────
-- 2. task_mentions (@mentions inside comments)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_mentions (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id INT REFERENCES task_comments(id) ON DELETE CASCADE,
  mentioned_employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  mentioned_name TEXT,
  mentioned_by TEXT,
  notified BOOLEAN DEFAULT false,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_mentions_task ON task_mentions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_mentions_employee ON task_mentions(mentioned_employee_id);
CREATE INDEX IF NOT EXISTS idx_task_mentions_comment ON task_mentions(comment_id);


-- ────────────────────────────────────────────────────────────
-- 3. project_members (first-class membership)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_members (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  employee_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member' | 'viewer'
  added_by TEXT,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, employee_id),
  CHECK (employee_id IS NOT NULL OR employee_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_employee ON project_members(employee_id);


-- ────────────────────────────────────────────────────────────
-- 4. project_sections (kanban columns / asana sections)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_sections (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#64748b',
  sort_order INT DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_sections_project ON project_sections(project_id, sort_order);


-- ────────────────────────────────────────────────────────────
-- 5. project_custom_fields + task_custom_field_values
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_custom_fields (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  field_key TEXT NOT NULL,  -- machine name, e.g. 'client_contact'
  field_type TEXT NOT NULL, -- 'text'|'number'|'date'|'select'|'multi_select'|'checkbox'|'user'|'url'
  options JSONB DEFAULT '[]',  -- for select/multi_select: [{label, value, color}]
  required BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_project_cf_project ON project_custom_fields(project_id, sort_order);

CREATE TABLE IF NOT EXISTS task_custom_field_values (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_id INT NOT NULL REFERENCES project_custom_fields(id) ON DELETE CASCADE,
  value JSONB,  -- any JSON; schema enforced at app layer based on field_type
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_task_cfv_task ON task_custom_field_values(task_id);
CREATE INDEX IF NOT EXISTS idx_task_cfv_field ON task_custom_field_values(field_id);


-- ────────────────────────────────────────────────────────────
-- 6. tasks: recurrence + direct project/section link
-- ────────────────────────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS section_id INT REFERENCES project_sections(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INT REFERENCES tasks(id) ON DELETE CASCADE;

-- Simple RRULE-like encoding: "FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE,FR",
--                            "FREQ=MONTHLY;BYMONTHDAY=15", "FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1"
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_parent_id INT REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_until DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_materialized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(section_id);
CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);


-- ────────────────────────────────────────────────────────────
-- 7. task_activity (per-task audit timeline)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_activity (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor TEXT,               -- employee name (or 'system')
  actor_id INT REFERENCES employees(id) ON DELETE SET NULL,
  action TEXT NOT NULL,     -- 'created'|'updated'|'assigned'|'status_changed'|'commented'
                            -- 'mentioned'|'attachment_added'|'watcher_added'|'completed'
                            -- 'field_changed'|'moved'|'due_changed'
  field TEXT,               -- which field if action='field_changed'
  old_value TEXT,
  new_value TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_activity_actor ON task_activity(actor_id);


-- ────────────────────────────────────────────────────────────
-- 8. Trigger: auto-log activity on task updates
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_task_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_activity(task_id, actor, action, new_value)
    VALUES (NEW.id, COALESCE(NEW.assigned_to, NEW.assignee, 'system'), 'created', NEW.title);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'status_changed', 'status', OLD.status, NEW.status);
    END IF;
    IF NEW.assignee IS DISTINCT FROM OLD.assignee OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'assigned', 'assignee', OLD.assignee, NEW.assignee);
    END IF;
    IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'due_changed', 'due_date', OLD.due_date::TEXT, NEW.due_date::TEXT);
    END IF;
    IF NEW.priority IS DISTINCT FROM OLD.priority THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'field_changed', 'priority', OLD.priority, NEW.priority);
    END IF;
    IF NEW.section_id IS DISTINCT FROM OLD.section_id THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'moved', 'section_id', OLD.section_id::TEXT, NEW.section_id::TEXT);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_activity ON tasks;
CREATE TRIGGER trg_task_activity
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION log_task_activity();


-- ────────────────────────────────────────────────────────────
-- 9. Seed default sections for existing projects
-- ────────────────────────────────────────────────────────────
INSERT INTO project_sections (project_id, name, color, sort_order, is_default)
SELECT p.id, s.name, s.color, s.sort_order, true
FROM projects p
CROSS JOIN (VALUES
  ('待處理', '#94a3b8', 1),
  ('進行中', '#06b6d4', 2),
  ('審核中', '#f59e0b', 3),
  ('已完成', '#34d399', 4)
) AS s(name, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM project_sections ps WHERE ps.project_id = p.id
)
ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 10. RLS policies
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'task_watchers',
    'task_mentions',
    'project_members',
    'project_sections',
    'project_custom_fields',
    'task_custom_field_values',
    'task_activity'
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


-- ────────────────────────────────────────────────────────────
-- 11. Views
-- ────────────────────────────────────────────────────────────

-- Tasks with watcher count + custom field values + project/section
CREATE OR REPLACE VIEW v_tasks_expanded AS
SELECT
  t.*,
  p.name       AS project_name,
  ps.name      AS section_name,
  ps.color     AS section_color,
  (SELECT COUNT(*) FROM task_watchers tw WHERE tw.task_id = t.id)          AS watcher_count,
  (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id)          AS comment_count,
  (SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id)       AS attachment_count,
  (SELECT COUNT(*) FROM task_custom_field_values v WHERE v.task_id = t.id) AS custom_field_count
FROM tasks t
LEFT JOIN projects p         ON t.project_id = p.id
LEFT JOIN project_sections ps ON t.section_id = ps.id;

-- Project member roster with employee details
CREATE OR REPLACE VIEW v_project_members_full AS
SELECT
  pm.*,
  e.name  AS employee_full_name,
  e.email AS employee_email,
  e.dept  AS employee_dept
FROM project_members pm
LEFT JOIN employees e ON pm.employee_id = e.id;
