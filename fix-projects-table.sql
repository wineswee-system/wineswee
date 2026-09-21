-- ============================================================
-- Fix: Create projects table + open RLS policies
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT '規劃中',
  priority TEXT DEFAULT '中',
  owner TEXT,
  owner_id INT REFERENCES employees(id),
  department TEXT,
  store TEXT,
  start_date DATE,
  end_date DATE,
  budget NUMERIC(12,2),
  spent NUMERIC(12,2) DEFAULT 0,
  progress INT DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  organization_id INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id);
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS triggered_by_task_id INT REFERENCES tasks(id);

CREATE TABLE IF NOT EXISTS project_comments (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, employee_id)
);

CREATE TABLE IF NOT EXISTS project_sections (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#64748b',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_custom_field_defs (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  field_type TEXT DEFAULT 'text',
  options JSONB,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_custom_field_values (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  field_def_id INT NOT NULL REFERENCES project_custom_field_defs(id) ON DELETE CASCADE,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  workflows JSONB DEFAULT '[]',
  estimated_days INT,
  estimated_budget NUMERIC(12,2),
  default_priority TEXT DEFAULT '中',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Open RLS policies (drops any org-scoped restrictions first)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_scope_select_projects ON projects;
DROP POLICY IF EXISTS org_scope_insert_projects ON projects;
DROP POLICY IF EXISTS org_scope_modify_projects ON projects;
DROP POLICY IF EXISTS org_scope_delete_projects ON projects;
DROP POLICY IF EXISTS anon_projects ON projects;
DROP POLICY IF EXISTS auth_projects ON projects;
CREATE POLICY auth_projects ON projects FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_projects ON projects FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE project_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_project_comments ON project_comments;
DROP POLICY IF EXISTS auth_project_comments ON project_comments;
CREATE POLICY auth_project_comments ON project_comments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_project_comments ON project_comments FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_project_members ON project_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_project_members ON project_members FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE project_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_project_sections ON project_sections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_project_sections ON project_sections FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE project_custom_field_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_project_field_defs ON project_custom_field_defs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_project_field_defs ON project_custom_field_defs FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE project_custom_field_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_project_field_values ON project_custom_field_values FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_project_field_values ON project_custom_field_values FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE project_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_project_templates ON project_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_project_templates ON project_templates FOR ALL TO anon USING (true) WITH CHECK (true);

SELECT 'Projects tables ready' AS result;

-- ============================================================
-- Fix: Task confirmation enhancements
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmed_by TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_status TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_required BOOLEAN DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_responded_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_approver TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmation_rejected_reason TEXT;

SELECT 'Task confirmation columns ready' AS result;
