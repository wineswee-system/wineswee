-- Project Lists: named task groups within a project (like Asana sections / Notion lists)
CREATE TABLE IF NOT EXISTS project_lists (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id      bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  color       text,
  sort_order  int  DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Allow tasks to belong to a list
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS list_id bigint REFERENCES project_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_lists_project ON project_lists(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(list_id);

ALTER TABLE project_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members access project lists" ON project_lists;
DROP POLICY IF EXISTS "project_lists_org_sel" ON project_lists;
DROP POLICY IF EXISTS "project_lists_ins" ON project_lists;
DROP POLICY IF EXISTS "project_lists_upd" ON project_lists;
DROP POLICY IF EXISTS "project_lists_del" ON project_lists;

CREATE POLICY "project_lists_org_sel" ON project_lists FOR SELECT USING (org_visible(org_id));
CREATE POLICY "project_lists_ins" ON project_lists FOR INSERT WITH CHECK (true);
CREATE POLICY "project_lists_upd" ON project_lists FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "project_lists_del" ON project_lists FOR DELETE USING (true);
