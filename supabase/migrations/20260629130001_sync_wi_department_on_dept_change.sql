-- 重新 backfill（修正已改名的部門）
UPDATE public.workflow_instances wi
SET department = e.dept
FROM public.employees e
WHERE wi.assignee = e.name
  AND e.organization_id = wi.organization_id
  AND e.dept IS NOT NULL;

-- Trigger function：employees.dept 改名時同步 workflow_instances.department
CREATE OR REPLACE FUNCTION trg_sync_wi_department()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.dept IS DISTINCT FROM OLD.dept THEN
    UPDATE public.workflow_instances
    SET department = NEW.dept
    WHERE assignee = NEW.name
      AND organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_wi_department ON public.employees;
CREATE TRIGGER trg_sync_wi_department
  AFTER UPDATE OF dept ON public.employees
  FOR EACH ROW EXECUTE FUNCTION trg_sync_wi_department();

NOTIFY pgrst, 'reload schema';
