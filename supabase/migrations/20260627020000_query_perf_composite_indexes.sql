-- ============================================================
-- Query performance: composite indexes for filter+sort patterns
-- Addresses slow queries surfaced in pg_stat_statements:
--   expense_requests, tasks, projects, workflow_instances,
--   personnel_transfer_requests, resignation_requests
-- All CREATE INDEX IF NOT EXISTS — zero risk, additive only.
-- ============================================================

BEGIN;

-- expense_requests: WHERE status=$1 AND employee_id=ANY($2) ORDER BY created_at DESC
-- Existing idx_expense_req_employee(employee_id) and idx_expense_req_status(status) are
-- single-column; planner can't avoid a sort pass. This covers filter + sort in one scan.
CREATE INDEX IF NOT EXISTS idx_expense_req_emp_status_date
  ON public.expense_requests (employee_id, status, created_at DESC);

-- tasks: WHERE assignee_id=ANY($1), SELECT status only
-- Covering index avoids heap fetch entirely for this read-only status query.
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status_cover
  ON public.tasks (assignee_id) INCLUDE (status);

-- projects: WHERE status=$1 ORDER BY created_at DESC
-- Existing idx_projects_status(status) can't satisfy the ORDER BY; adds sort column.
CREATE INDEX IF NOT EXISTS idx_projects_status_date
  ON public.projects (status, created_at DESC);

-- workflow_instances: WHERE status=$1 ORDER BY started_at DESC
-- No index on (status, started_at) existed; 31 calls/session adds up.
CREATE INDEX IF NOT EXISTS idx_workflow_instances_status_started
  ON public.workflow_instances (status, started_at DESC);

-- personnel_transfer_requests: WHERE status=$1 AND employee_id=ANY($2) ORDER BY created_at DESC
-- Existing idx_transfer_emp_status(employee_id, status) lacks sort column.
CREATE INDEX IF NOT EXISTS idx_transfer_emp_status_date
  ON public.personnel_transfer_requests (employee_id, status, created_at DESC);

-- resignation_requests: same filter+sort pattern
-- Existing idx_resignation_emp_status(employee_id, status) lacks sort column.
CREATE INDEX IF NOT EXISTS idx_resignation_emp_status_date
  ON public.resignation_requests (employee_id, status, created_at DESC);

COMMIT;
