-- ============================================================
-- Projects（專案管理）
-- PROJECT → WORKFLOW → TASK → CHECKLIST
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT '規劃中',  -- 規劃中, 進行中, 已完成, 已取消, 暫停
  priority TEXT DEFAULT '中',             -- 高, 中, 低
  owner TEXT,                             -- 專案負責人
  owner_id INT REFERENCES employees(id),
  department TEXT,
  store TEXT,
  start_date DATE,
  end_date DATE,
  budget NUMERIC(12,2),
  spent NUMERIC(12,2) DEFAULT 0,
  progress INT DEFAULT 0,                 -- 0~100
  tags TEXT[] DEFAULT '{}',
  organization_id INT REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Link workflow_instances to projects
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id);
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- Project-level notes/comments
CREATE TABLE IF NOT EXISTS project_comments (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_workflow_project ON workflow_instances(project_id);
CREATE INDEX IF NOT EXISTS idx_project_comments ON project_comments(project_id);

-- RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'anon_projects') THEN
    CREATE POLICY anon_projects ON projects FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'auth_projects') THEN
    CREATE POLICY auth_projects ON projects FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_comments' AND policyname = 'anon_project_comments') THEN
    CREATE POLICY anon_project_comments ON project_comments FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_comments' AND policyname = 'auth_project_comments') THEN
    CREATE POLICY auth_project_comments ON project_comments FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
