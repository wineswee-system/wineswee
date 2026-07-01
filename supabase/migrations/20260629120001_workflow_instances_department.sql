-- workflow_instances 加 department 欄，並回填舊資料
ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS department TEXT;

-- 回填：assignee 對應 employees.name 取 dept
UPDATE public.workflow_instances wi
SET department = e.dept
FROM public.employees e
WHERE wi.assignee = e.name
  AND e.organization_id = wi.organization_id
  AND wi.department IS NULL
  AND e.dept IS NOT NULL;

NOTIFY pgrst, 'reload schema';
