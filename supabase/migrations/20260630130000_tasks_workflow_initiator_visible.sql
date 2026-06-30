-- tasks 可見性補：流程發起人可以看到自己發起的流程的所有步驟
-- 原 tasks_sel 只有 assignee_id / created_by_emp_id / project_member，
-- 沒有「你是 workflow_instances.started_by_id → 看得到所屬步驟」這條，
-- 造成發起人進流程詳情頁，步驟全空白。

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
);

NOTIFY pgrst, 'reload schema';
