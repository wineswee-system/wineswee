-- tasks 可見性補：專案擁有者可以看到自己專案的所有任務
-- is_project_member 只查 project_members，不包含 projects.owner_id，
-- 造成專案擁有者進詳情頁任務全空（與流程發起人問題同型）。

DROP POLICY IF EXISTS tasks_sel ON public.tasks;
CREATE POLICY tasks_sel ON public.tasks FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR assignee_id = current_employee_id()
  OR created_by_emp_id = current_employee_id()
  OR (project_id IS NOT NULL AND is_project_member(project_id))
  OR EXISTS (
    SELECT 1 FROM public.workflow_instances wi
     WHERE wi.id = tasks.workflow_instance_id
       AND wi.started_by_id = current_employee_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = tasks.project_id
       AND p.owner_id = current_employee_id()
  )
);

NOTIFY pgrst, 'reload schema';
