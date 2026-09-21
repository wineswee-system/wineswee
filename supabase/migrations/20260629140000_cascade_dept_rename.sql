-- 先修 employees.dept 文字欄（用 FK 直接查 departments.name，繞過舊快照）
UPDATE public.employees e
SET dept = d.name
FROM public.departments d
WHERE e.department_id = d.id
  AND e.dept IS DISTINCT FROM d.name;

-- 再修 workflow_instances.department（同樣走 FK，不走 employees.dept 快照）
UPDATE public.workflow_instances wi
SET department = d.name
FROM public.employees e
JOIN public.departments d ON d.id = e.department_id
WHERE wi.assignee = e.name
  AND wi.organization_id = e.organization_id
  AND d.name IS NOT NULL;

-- Trigger：departments.name 改名時串聯更新 employees.dept + workflow_instances.department
CREATE OR REPLACE FUNCTION trg_cascade_dept_name_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.employees
    SET dept = NEW.name
    WHERE department_id = NEW.id;

    UPDATE public.workflow_instances wi
    SET department = NEW.name
    FROM public.employees e
    WHERE e.department_id = NEW.id
      AND wi.assignee = e.name
      AND wi.organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_dept_name ON public.departments;
CREATE TRIGGER trg_cascade_dept_name
  AFTER UPDATE OF name ON public.departments
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_dept_name_change();

NOTIFY pgrst, 'reload schema';
