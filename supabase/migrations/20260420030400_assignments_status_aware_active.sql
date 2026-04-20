-- ============================================================
--  Make employee_assignments.is_active status-aware.
--
--  Rule: active = (end_date IS NULL OR end_date >= CURRENT_DATE)
--                 AND employees.status = '在職'
--
--  Also: when employees.status changes, cascade to assignments.
-- ============================================================

BEGIN;

-- 1. Rewrite the BEFORE trigger to consider employee.status.
CREATE OR REPLACE FUNCTION public.tg_ea_auto_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  emp_status TEXT;
BEGIN
  SELECT status INTO emp_status
  FROM public.employees
  WHERE id = NEW.employee_id;

  NEW.is_active := (
    (NEW.end_date IS NULL OR NEW.end_date >= CURRENT_DATE)
    AND COALESCE(emp_status, '在職') = '在職'
  );
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- 2. Cascade from employees.status to assignments.
CREATE OR REPLACE FUNCTION public.tg_employee_status_sync_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = '在職' THEN
      -- Rehire: any assignment with NULL/future end_date flips active.
      UPDATE public.employee_assignments
      SET is_active = true, updated_at = now()
      WHERE employee_id = NEW.id
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
        AND is_active = false;
    ELSE
      -- 離職 / 留職停薪 / anything else → all assignments inactive.
      UPDATE public.employee_assignments
      SET is_active = false, updated_at = now()
      WHERE employee_id = NEW.id
        AND is_active = true;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_employee_status_sync_assignments ON public.employees;
CREATE TRIGGER trg_employee_status_sync_assignments
  AFTER UPDATE OF status ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_employee_status_sync_assignments();

-- 3. One-shot recompute for current data.
UPDATE public.employee_assignments ea
SET is_active = (
      (ea.end_date IS NULL OR ea.end_date >= CURRENT_DATE)
      AND e.status = '在職'
    ),
    updated_at = now()
FROM public.employees e
WHERE ea.employee_id = e.id
  AND ea.is_active <> (
    (ea.end_date IS NULL OR ea.end_date >= CURRENT_DATE)
    AND e.status = '在職'
  );

COMMIT;
