-- 修復 20260630110000 / 20260630120000 / 20260630130000 / 20260630140000 造成的
-- 循環 RLS 問題：
--   tasks_sel → 查 workflow_instances → workflow_instances_sel → 查 tasks → tasks_sel → 無限遞迴
--   tasks_sel → 查 projects          → projects_sel          → 查 tasks → tasks_sel → 無限遞迴
--
-- 解法：用 SECURITY DEFINER 函式包跨表查詢，讓子查詢不再觸發 RLS。

-- ── SECURITY DEFINER helpers ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_workflow_initiator(p_wf_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workflow_instances
     WHERE id = p_wf_id
       AND started_by_id = current_employee_id()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_workflow_initiator(bigint) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_project_owner(p_proj_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
     WHERE id = p_proj_id
       AND owner_id = current_employee_id()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_project_owner(bigint) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.has_task_in_workflow(p_wf_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks
     WHERE workflow_instance_id = p_wf_id
       AND assignee_id = current_employee_id()
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_task_in_workflow(bigint) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.has_task_in_project(p_proj_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks
     WHERE project_id = p_proj_id
       AND assignee_id = current_employee_id()
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_task_in_project(bigint) TO authenticated, anon;

-- ── tasks_sel（最終版，覆蓋 20260630130000 / 20260630140000）────────────────

DROP POLICY IF EXISTS tasks_sel ON public.tasks;
CREATE POLICY tasks_sel ON public.tasks FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR assignee_id     = current_employee_id()
  OR created_by_emp_id = current_employee_id()
  OR (project_id IS NOT NULL AND is_project_member(project_id))
  OR (workflow_instance_id IS NOT NULL AND is_workflow_initiator(workflow_instance_id))
  OR (project_id IS NOT NULL AND is_project_owner(project_id))
);

-- ── workflow_instances_sel（覆蓋 20260630110000）──────────────────────────

DROP POLICY IF EXISTS workflow_instances_sel ON public.workflow_instances;
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR started_by_id       = current_employee_id()
  OR target_employee_id  = current_employee_id()
  OR applicant_emp_id    = current_employee_id()
  OR has_task_in_workflow(id)
);

-- ── projects_sel（覆蓋 20260630120000）────────────────────────────────────

DROP POLICY IF EXISTS projects_sel ON public.projects;
CREATE POLICY projects_sel ON public.projects FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR owner_id = current_employee_id()
  OR is_project_member(id)
  OR has_task_in_project(id)
);

NOTIFY pgrst, 'reload schema';
