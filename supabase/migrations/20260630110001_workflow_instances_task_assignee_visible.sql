-- workflow_instances 可見性補：任務被指派人也能看到所屬的流程
-- 原 policy (20260618220000) 只有發起人/目標員工/申請人/admin，
-- 但流程任務的 assignee 不在名單 → 從儀表板點任務跳流程頁看不到內容。
-- 修法：加一條 OR：只要該員工有任何任務屬於這個 workflow_instance，就能看到它。

DROP POLICY IF EXISTS workflow_instances_sel ON public.workflow_instances;
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR started_by_id    = current_employee_id()
  OR target_employee_id = current_employee_id()
  OR applicant_emp_id = current_employee_id()
  OR EXISTS (
    SELECT 1 FROM public.tasks
     WHERE tasks.workflow_instance_id = workflow_instances.id
       AND tasks.assignee_id = current_employee_id()
  )
);

NOTIFY pgrst, 'reload schema';
