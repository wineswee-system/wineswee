-- ============================================================
--  Rule: staff belong to 營運部 if ANY of these hold:
--    • store_id IS NOT NULL (assigned to a 門市)
--    • position LIKE '%門市%'  (門市人員 / 門市正職人員 / …)
--    • position LIKE '%店長%'  (店長 / 副店長 / …)
--
--  Forces department_id = 營運部 in employees and
--  employee_assignments wherever the rule matches, overriding
--  any existing department value. Historical department drift
--  from earlier imports is normalised here.
--
--  Safe no-op if 營運部 doesn't exist.
-- ============================================================

DO $$
DECLARE
  ops_dept_id INT;
  updated_emp INT;
  updated_ea  INT;
BEGIN
  SELECT id INTO ops_dept_id
  FROM public.departments
  WHERE name = '營運部'
  ORDER BY id DESC
  LIMIT 1;

  IF ops_dept_id IS NULL THEN
    RAISE NOTICE '營運部 not found — skipping store-staff dept backfill.';
    RETURN;
  END IF;

  -- employees master (override existing dept where rule matches)
  UPDATE public.employees
  SET department_id = ops_dept_id
  WHERE (
      store_id IS NOT NULL
      OR position LIKE '%門市%'
      OR position LIKE '%店長%'
    )
    AND department_id IS DISTINCT FROM ops_dept_id;
  GET DIAGNOSTICS updated_emp = ROW_COUNT;

  -- assignments history (override too — keeps history consistent with master)
  UPDATE public.employee_assignments
  SET department_id = ops_dept_id
  WHERE (
      store_id IS NOT NULL
      OR position LIKE '%門市%'
      OR position LIKE '%店長%'
    )
    AND department_id IS DISTINCT FROM ops_dept_id;
  GET DIAGNOSTICS updated_ea = ROW_COUNT;

  RAISE NOTICE 'store→營運部 override: employees=%, employee_assignments=%', updated_emp, updated_ea;
END $$;

-- ────────────────────────────────────────────────────────────
-- Trigger: keep the invariant going forward.
-- Any row inserted/updated with store_id set OR a position
-- containing 門市 / 店長 is forced to department_id = 營運部.
-- No-op if 營運部 is missing.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_force_ops_dept_for_store()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ops_dept_id INT;
BEGIN
  IF NEW.store_id IS NULL
     AND (NEW.position IS NULL
          OR (NEW.position NOT LIKE '%門市%'
              AND NEW.position NOT LIKE '%店長%')) THEN
    RETURN NEW;
  END IF;
  SELECT id INTO ops_dept_id
  FROM public.departments
  WHERE name = '營運部'
  ORDER BY id DESC
  LIMIT 1;
  IF ops_dept_id IS NOT NULL THEN
    NEW.department_id := ops_dept_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_ops_dept_employees ON public.employees;
CREATE TRIGGER trg_force_ops_dept_employees
  BEFORE INSERT OR UPDATE OF store_id, department_id, position ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_ops_dept_for_store();

DROP TRIGGER IF EXISTS trg_force_ops_dept_assignments ON public.employee_assignments;
CREATE TRIGGER trg_force_ops_dept_assignments
  BEFORE INSERT OR UPDATE OF store_id, department_id, position ON public.employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_ops_dept_for_store();
