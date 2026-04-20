-- ============================================================
--  Revert ALL TEXT-column drops from phase3_1
--    (20260420010600_phase3_1_drop_text_denorm.sql)
--
--  Re-adds every TEXT denormalization column that was dropped,
--  repopulates them from the current FK ids, and re-installs
--  BEFORE INSERT/UPDATE sync triggers so the text stays in sync
--  as rows are written.
--
--  Note: any text values that existed before the drop are gone
--  forever. This migration only restores the schema shape and
--  fills text from whatever the FK resolves to right now.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Re-add columns (no-op if they still exist)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.employees           ADD COLUMN IF NOT EXISTS dept       TEXT;
ALTER TABLE public.employees           ADD COLUMN IF NOT EXISTS store      TEXT;
ALTER TABLE public.employees           ADD COLUMN IF NOT EXISTS supervisor TEXT;

ALTER TABLE public.stores              ADD COLUMN IF NOT EXISTS company    TEXT;
ALTER TABLE public.stores              ADD COLUMN IF NOT EXISTS manager    TEXT;

ALTER TABLE public.departments         ADD COLUMN IF NOT EXISTS head       TEXT;

ALTER TABLE public.attendance_records  ADD COLUMN IF NOT EXISTS employee   TEXT;
ALTER TABLE public.leave_requests      ADD COLUMN IF NOT EXISTS employee   TEXT;
ALTER TABLE public.overtime_requests   ADD COLUMN IF NOT EXISTS employee   TEXT;
ALTER TABLE public.salary_records      ADD COLUMN IF NOT EXISTS employee   TEXT;

ALTER TABLE public.tasks               ADD COLUMN IF NOT EXISTS assignee   TEXT;
ALTER TABLE public.tasks               ADD COLUMN IF NOT EXISTS workflow   TEXT;
ALTER TABLE public.tasks               ADD COLUMN IF NOT EXISTS store      TEXT;

-- ────────────────────────────────────────────────────────────
-- 2. Backfill text from current FK values
-- ────────────────────────────────────────────────────────────
UPDATE public.employees e
SET dept = d.name
FROM public.departments d
WHERE e.department_id = d.id AND e.dept IS DISTINCT FROM d.name;

UPDATE public.employees e
SET store = s.name
FROM public.stores s
WHERE e.store_id = s.id AND e.store IS DISTINCT FROM s.name;

UPDATE public.employees e
SET supervisor = sup.name
FROM public.employees sup
WHERE e.supervisor_id = sup.id AND e.supervisor IS DISTINCT FROM sup.name;

UPDATE public.stores s
SET company = c.name
FROM public.companies c
WHERE s.company_id = c.id AND s.company IS DISTINCT FROM c.name;

UPDATE public.stores s
SET manager = e.name
FROM public.employees e
WHERE s.manager_id = e.id AND s.manager IS DISTINCT FROM e.name;

UPDATE public.departments d
SET head = e.name
FROM public.employees e
WHERE d.manager_id = e.id AND d.head IS DISTINCT FROM e.name;

UPDATE public.attendance_records a
SET employee = e.name
FROM public.employees e
WHERE a.employee_id = e.id AND a.employee IS DISTINCT FROM e.name;

UPDATE public.leave_requests lr
SET employee = e.name
FROM public.employees e
WHERE lr.employee_id = e.id AND lr.employee IS DISTINCT FROM e.name;

UPDATE public.overtime_requests o
SET employee = e.name
FROM public.employees e
WHERE o.employee_id = e.id AND o.employee IS DISTINCT FROM e.name;

UPDATE public.salary_records sr
SET employee = e.name
FROM public.employees e
WHERE sr.employee_id = e.id AND sr.employee IS DISTINCT FROM e.name;

UPDATE public.tasks t
SET assignee = e.name
FROM public.employees e
WHERE t.assignee_id = e.id AND t.assignee IS DISTINCT FROM e.name;

UPDATE public.tasks t
SET store = s.name
FROM public.stores s
WHERE t.store_id = s.id AND t.store IS DISTINCT FROM s.name;

UPDATE public.tasks t
SET workflow = wi.template_name
FROM public.workflow_instances wi
WHERE t.workflow_instance_id = wi.id AND t.workflow IS DISTINCT FROM wi.template_name;

-- ────────────────────────────────────────────────────────────
-- 3. Re-install sync triggers (BEFORE INSERT/UPDATE of FK cols)
-- ────────────────────────────────────────────────────────────

-- employees: dept / store / supervisor
CREATE OR REPLACE FUNCTION public.tg_sync_employee_fk_text()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.dept       := (SELECT name FROM public.departments WHERE id = NEW.department_id);
  NEW.store      := (SELECT name FROM public.stores      WHERE id = NEW.store_id);
  NEW.supervisor := (SELECT name FROM public.employees   WHERE id = NEW.supervisor_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_employee_fk_text ON public.employees;
CREATE TRIGGER trg_sync_employee_fk_text
  BEFORE INSERT OR UPDATE OF department_id, store_id, supervisor_id
  ON public.employees FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_employee_fk_text();

-- stores: company / manager
CREATE OR REPLACE FUNCTION public.tg_sync_store_fk_text()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.company := (SELECT name FROM public.companies WHERE id = NEW.company_id);
  NEW.manager := (SELECT name FROM public.employees WHERE id = NEW.manager_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_store_fk_text ON public.stores;
CREATE TRIGGER trg_sync_store_fk_text
  BEFORE INSERT OR UPDATE OF company_id, manager_id
  ON public.stores FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_store_fk_text();

-- departments: head
CREATE OR REPLACE FUNCTION public.tg_sync_department_fk_text()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.head := (SELECT name FROM public.employees WHERE id = NEW.manager_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_department_fk_text ON public.departments;
CREATE TRIGGER trg_sync_department_fk_text
  BEFORE INSERT OR UPDATE OF manager_id
  ON public.departments FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_department_fk_text();

-- attendance_records / leave_requests / overtime_requests / salary_records: employee text
CREATE OR REPLACE FUNCTION public.tg_sync_hr_emp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.employee := (SELECT name FROM public.employees WHERE id = NEW.employee_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_hr_emp_attendance_records ON public.attendance_records;
CREATE TRIGGER trg_sync_hr_emp_attendance_records
  BEFORE INSERT OR UPDATE OF employee_id
  ON public.attendance_records FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_hr_emp();

DROP TRIGGER IF EXISTS trg_sync_hr_emp_leave_requests ON public.leave_requests;
CREATE TRIGGER trg_sync_hr_emp_leave_requests
  BEFORE INSERT OR UPDATE OF employee_id
  ON public.leave_requests FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_hr_emp();

DROP TRIGGER IF EXISTS trg_sync_hr_emp_overtime_requests ON public.overtime_requests;
CREATE TRIGGER trg_sync_hr_emp_overtime_requests
  BEFORE INSERT OR UPDATE OF employee_id
  ON public.overtime_requests FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_hr_emp();

DROP TRIGGER IF EXISTS trg_sync_hr_emp_salary_records ON public.salary_records;
CREATE TRIGGER trg_sync_hr_emp_salary_records
  BEFORE INSERT OR UPDATE OF employee_id
  ON public.salary_records FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_hr_emp();

-- tasks: assignee / store / workflow
CREATE OR REPLACE FUNCTION public.tg_sync_task_assignee()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.assignee := (SELECT name FROM public.employees WHERE id = NEW.assignee_id);
  NEW.store    := (SELECT name FROM public.stores    WHERE id = NEW.store_id);
  NEW.workflow := (SELECT template_name FROM public.workflow_instances WHERE id = NEW.workflow_instance_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_task_assignee ON public.tasks;
CREATE TRIGGER trg_sync_task_assignee
  BEFORE INSERT OR UPDATE OF assignee_id, store_id, workflow_instance_id
  ON public.tasks FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_task_assignee();

COMMIT;
