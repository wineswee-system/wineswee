-- ============================================================
-- Phase 3.1 — Drop sync triggers + TEXT denormalization columns
--
-- ⚠ DESTRUCTIVE — DO NOT APPLY UNTIL APP CODE IS UPDATED ⚠
--
-- This migration removes columns that the React frontend currently reads:
--   employees.dept, employees.store, employees.supervisor
--   stores.company, stores.manager
--   departments.head
--   attendance_records.employee
--   leave_requests.employee
--   overtime_requests.employee
--   salary_records.employee
--   tasks.assignee, tasks.workflow, tasks.store
--
-- Pre-flight checklist (DO ALL FIRST):
--   1. Update src/lib/db.js queries to JOIN on FK and read FK-referenced names
--   2. Update src/pages/**/*.jsx components that bind to these field names
--   3. Verify in dev that all employees/HR/tasks/POS pages render
--   4. Run E2E test suite (npm run test:e2e)
--
-- After applying:
--   Frontend code reading these columns returns NULL → blank UI fields.
-- ============================================================

BEGIN;

-- 0. Drop dependent views; recreate at the end with FK-based projections.
DROP VIEW IF EXISTS public.v_project_members_full CASCADE;
DROP VIEW IF EXISTS public.v_tasks_full CASCADE;
DROP VIEW IF EXISTS public.v_tasks_expanded CASCADE;

-- 1. Drop sync triggers first so dropping columns doesn't fail.
DROP TRIGGER IF EXISTS trg_sync_employee_fk_text ON public.employees;
DROP TRIGGER IF EXISTS trg_sync_store_fk_text ON public.stores;
DROP TRIGGER IF EXISTS trg_sync_department_fk_text ON public.departments;
DROP TRIGGER IF EXISTS trg_sync_task_assignee ON public.tasks;
DROP TRIGGER IF EXISTS trg_sync_hr_emp_attendance_records ON public.attendance_records;
DROP TRIGGER IF EXISTS trg_sync_hr_emp_leave_requests ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_sync_hr_emp_overtime_requests ON public.overtime_requests;
DROP TRIGGER IF EXISTS trg_sync_hr_emp_salary_records ON public.salary_records;

-- 2. Drop the trigger functions (no longer referenced).
DROP FUNCTION IF EXISTS public.tg_sync_employee_fk_text();
DROP FUNCTION IF EXISTS public.tg_sync_store_fk_text();
DROP FUNCTION IF EXISTS public.tg_sync_department_fk_text();
DROP FUNCTION IF EXISTS public.tg_sync_task_assignee();
DROP FUNCTION IF EXISTS public.tg_sync_hr_emp();

-- 3. Pre-flight: assert FK columns are filled for all rows where TEXT is filled.
--    If this assertion fails, rollback rather than lose data.
DO $$
DECLARE
  orphan_count INT;
BEGIN
  -- employees
  SELECT count(*) INTO orphan_count FROM public.employees
  WHERE (dept IS NOT NULL AND department_id IS NULL)
     OR (store IS NOT NULL AND store_id IS NULL)
     OR (supervisor IS NOT NULL AND supervisor_id IS NULL);
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'employees has % rows with TEXT-only references; backfill FK first', orphan_count;
  END IF;

  -- attendance_records (only check if both columns exist)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='attendance_records' AND column_name='employee') THEN
    SELECT count(*) INTO orphan_count FROM public.attendance_records
    WHERE employee IS NOT NULL AND employee_id IS NULL;
    IF orphan_count > 0 THEN
      RAISE EXCEPTION 'attendance_records has % TEXT-only rows; backfill first', orphan_count;
    END IF;
  END IF;
END $$;

-- 4. Drop the columns.
ALTER TABLE public.employees DROP COLUMN IF EXISTS dept;
ALTER TABLE public.employees DROP COLUMN IF EXISTS store;
ALTER TABLE public.employees DROP COLUMN IF EXISTS supervisor;

ALTER TABLE public.stores DROP COLUMN IF EXISTS company;
ALTER TABLE public.stores DROP COLUMN IF EXISTS manager;

ALTER TABLE public.departments DROP COLUMN IF EXISTS head;

ALTER TABLE public.attendance_records DROP COLUMN IF EXISTS employee;
ALTER TABLE public.leave_requests DROP COLUMN IF EXISTS employee;
ALTER TABLE public.overtime_requests DROP COLUMN IF EXISTS employee;
ALTER TABLE public.salary_records DROP COLUMN IF EXISTS employee;

ALTER TABLE public.tasks DROP COLUMN IF EXISTS assignee;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS workflow;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS store;

-- 5. Recreate dependent views using FK-based projections.
CREATE OR REPLACE VIEW public.v_project_members_full AS
SELECT
  pm.id, pm.project_id, pm.employee_id, pm.employee_name, pm.role,
  pm.added_by, pm.added_at,
  e.name AS employee_full_name,
  e.email AS employee_email,
  d.name AS employee_dept
FROM public.project_members pm
LEFT JOIN public.employees e ON pm.employee_id = e.id
LEFT JOIN public.departments d ON d.id = e.department_id;

CREATE OR REPLACE VIEW public.v_tasks_full AS
SELECT
  t.id, t.title, t.status, t.due_date, t.priority, t.created_at,
  t.workflow_instance_id, t.workflow_step_id, t.description,
  t.store_id, t.assigned_to, t.planned_start, t.due_time,
  t.completed_at, t.updated_at, t.notes, t.sort_order, t.step_order,
  t.step_type, t.role, t.category, t.bucket, t.metadata,
  t.reminder_at, t.confirmation_required, t.confirmation_status,
  t.confirmation_requested_at, t.confirmation_responded_at, t.confirmation_notes,
  t.approval_chain_id, t.trigger_actions, t.start_conditions,
  t.assignee_id,
  s.name AS store_name,
  ae.name AS assignee_name,
  wi.template_name AS workflow_instance_name,
  wi.status AS workflow_instance_status,
  wi.store AS workflow_instance_store
FROM public.tasks t
LEFT JOIN public.workflow_instances wi ON t.workflow_instance_id = wi.id
LEFT JOIN public.stores s ON s.id = t.store_id
LEFT JOIN public.employees ae ON ae.id = t.assignee_id;

CREATE OR REPLACE VIEW public.v_tasks_expanded AS
SELECT
  t.id, t.title, t.status, t.due_date, t.priority, t.created_at,
  t.workflow_instance_id, t.workflow_step_id, t.description,
  t.store_id, t.assigned_to, t.planned_start, t.due_time,
  t.completed_at, t.updated_at, t.notes, t.sort_order, t.step_order,
  t.step_type, t.role, t.category, t.bucket, t.metadata,
  t.reminder_at, t.confirmation_required, t.confirmation_status,
  t.confirmation_requested_at, t.confirmation_responded_at, t.confirmation_notes,
  t.approval_chain_id, t.trigger_actions, t.start_conditions,
  t.assignee_id, t.project_id, t.section_id, t.parent_task_id,
  t.recurrence_rule, t.recurrence_parent_id, t.recurrence_until,
  t.last_materialized_at,
  s.name AS store_name,
  ae.name AS assignee_name,
  p.name AS project_name,
  ps.name AS section_name,
  ps.color AS section_color,
  (SELECT count(*) FROM public.task_watchers tw WHERE tw.task_id = t.id) AS watcher_count,
  (SELECT count(*) FROM public.task_comments tc WHERE tc.task_id = t.id) AS comment_count,
  (SELECT count(*) FROM public.task_attachments ta WHERE ta.task_id = t.id) AS attachment_count,
  (SELECT count(*) FROM public.task_custom_field_values v WHERE v.task_id = t.id) AS custom_field_count
FROM public.tasks t
LEFT JOIN public.projects p ON t.project_id = p.id
LEFT JOIN public.project_sections ps ON t.section_id = ps.id
LEFT JOIN public.stores s ON s.id = t.store_id
LEFT JOIN public.employees ae ON ae.id = t.assignee_id;

COMMIT;
