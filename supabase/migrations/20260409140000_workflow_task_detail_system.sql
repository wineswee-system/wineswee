-- ── Workflow Steps: add priority, category, reminder ──
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT '中';
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Workflow';
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS approval_chain_id INT;

-- ── Step Dependencies (前置條件 & 觸發動作) ──
CREATE TABLE IF NOT EXISTS workflow_step_dependencies (
  id SERIAL PRIMARY KEY,
  step_id INT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  depends_on_step_id INT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  dep_type TEXT NOT NULL DEFAULT 'prerequisite',  -- 'prerequisite' | 'trigger'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(step_id, depends_on_step_id, dep_type)
);

-- ── Step Comments (備註留言) ──
CREATE TABLE IF NOT EXISTS workflow_step_comments (
  id SERIAL PRIMARY KEY,
  step_id INT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  author TEXT NOT NULL DEFAULT '系統',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Step Attachments (附件) ──
CREATE TABLE IF NOT EXISTS workflow_step_attachments (
  id SERIAL PRIMARY KEY,
  step_id INT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Step-Checklist Link (關聯查核清單) ──
CREATE TABLE IF NOT EXISTS workflow_step_checklists (
  id SERIAL PRIMARY KEY,
  step_id INT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  checklist_id INT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(step_id, checklist_id)
);

-- ── Approval Chains (簽核鏈定義) ──
CREATE TABLE IF NOT EXISTS approval_chains (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  steps JSONB DEFAULT '[]',
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Approval Forms (簽核表單) ──
CREATE TABLE IF NOT EXISTS approval_forms (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  applicant TEXT,
  chain_id INT REFERENCES approval_chains(id),
  store TEXT,
  current_step INT DEFAULT 0,
  status TEXT DEFAULT '簽核中',
  form_data JSONB,
  completed_at TIMESTAMPTZ,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Approval Form Steps ──
CREATE TABLE IF NOT EXISTS approval_form_steps (
  id SERIAL PRIMARY KEY,
  form_id INT REFERENCES approval_forms(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  role TEXT,
  status TEXT DEFAULT '等待中',
  approver TEXT,
  comment TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── RLS Policies ──
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflow_step_dependencies',
    'workflow_step_comments',
    'workflow_step_attachments',
    'workflow_step_checklists',
    'approval_chains',
    'approval_forms',
    'approval_form_steps'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'anon_' || t) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', 'anon_' || t, t);
    END IF;
  END LOOP;
END $$;
