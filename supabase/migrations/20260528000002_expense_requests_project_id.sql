-- ============================================================
-- Link expense requests to projects (budget actuals)
-- ============================================================

ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_req_project
  ON expense_requests(project_id)
  WHERE project_id IS NOT NULL;

COMMENT ON COLUMN expense_requests.project_id IS
  'Optional link to a project for budget actuals tracking';
