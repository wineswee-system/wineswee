-- ============================================================
-- Phase 4.2 — Enterprise indexes (FK-based, replacing the broken TEXT-based draft)
--
-- Source of truth: supabase/migrations_broken/20260410_enterprise_indexes_rls.sql
-- That draft indexed TEXT columns (employee, store, dept, supplier, customer)
-- which Phase 3.1 drops. This rewrite uses the FK-based equivalents.
--
-- Each index is wrapped in a column-existence check so the migration is
-- tolerant of schema variations (e.g. pos_transactions has no `date` column;
-- schedules has no `store_id`).
--
-- Risk: LOW (additive). All CREATE INDEX IF NOT EXISTS.
-- ============================================================

BEGIN;

DO $$
DECLARE
  spec RECORD;
  cols_present BOOLEAN;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('idx_employees_store_status', 'employees', ARRAY['store_id','status']),
      ('idx_employees_dept_status', 'employees', ARRAY['department_id','status']),
      ('idx_employees_org_status', 'employees', ARRAY['organization_id','status']),
      ('idx_attendance_emp_date', 'attendance_records', ARRAY['employee_id','date']),
      ('idx_attendance_date_status', 'attendance_records', ARRAY['date','status']),
      ('idx_leave_emp_status', 'leave_requests', ARRAY['employee_id','status']),
      ('idx_leave_dates', 'leave_requests', ARRAY['start_date','end_date']),
      ('idx_salary_emp_month', 'salary_records', ARRAY['employee_id','month']),
      ('idx_schedules_emp_date', 'schedules', ARRAY['employee_id','date']),
      ('idx_tasks_assignee_status', 'tasks', ARRAY['assignee_id','status']),
      ('idx_tasks_wf_instance', 'tasks', ARRAY['workflow_instance_id']),
      ('idx_pos_store_created', 'pos_transactions', ARRAY['store_id','created_at']),
      ('idx_outbox_status_created', 'event_outbox', ARRAY['status','created_at']),
      ('idx_je_date_status', 'journal_entries', ARRAY['entry_date','status']),
      ('idx_audit_logs_created', 'audit_logs', ARRAY['created_at'])
    ) AS t(idx_name, tab, cols)
  LOOP
    -- Skip if table doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=spec.tab) THEN
      RAISE NOTICE 'Skipping % (table missing)', spec.idx_name;
      CONTINUE;
    END IF;
    -- Verify every column exists
    SELECT bool_and(EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=spec.tab AND column_name=c
    )) INTO cols_present
    FROM unnest(spec.cols) c;
    IF NOT cols_present THEN
      RAISE NOTICE 'Skipping % (one or more columns missing in %)', spec.idx_name, spec.tab;
      CONTINUE;
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
                   spec.idx_name, spec.tab, array_to_string(spec.cols, ', '));
  END LOOP;
END $$;

-- Conditional partial index on notifications (read-state aware)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='notifications' AND column_name='read')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='notifications' AND column_name='user_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notifications_user_read
             ON public.notifications(user_id, read, created_at DESC) WHERE read = false';
  END IF;
END $$;

-- Conditional partial index on tasks.due_date
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='tasks' AND column_name='due_date') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tasks_due ON public.tasks(due_date) WHERE due_date IS NOT NULL';
  END IF;
END $$;

COMMIT;
