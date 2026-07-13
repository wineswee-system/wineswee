-- 專案內流程/任務全可見:看得到專案就看得到其所有流程與任務
-- 2026-07-13  現況:員工在專案「流程1」有任務→看得到流程1;但「流程2」他沒任務→看不到。
--   造成同專案內只看得到自己有份的流程,協作看不到全貌。
-- 修:workflow_instances_sel / tasks_sel 加「屬於某專案 + 看得到該專案」的委派條件。
--   委派給 projects_sel(EXISTS projects)/ workflow_instances_sel(EXISTS wi) — 這兩支的 RLS
--   只靠 SECURITY DEFINER helper(has_task_in_project/is_project_member…查 tasks/project_members,
--   繞過 RLS),不回查 workflow_instances/tasks → 無遞迴。
--   基於 20260708120000(最新版)+ 加新條件,保留原有全部條件。idempotent。

BEGIN;

-- ── workflow_instances_sel:專案內流程 → 看得到專案就看得到 ──
DROP POLICY IF EXISTS workflow_instances_sel ON public.workflow_instances;
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR started_by_id      = current_employee_id()
  OR target_employee_id = current_employee_id()
  OR applicant_emp_id   = current_employee_id()
  OR has_task_in_workflow(id::bigint)
  OR has_mention_in_workflow(id::bigint)
  -- 專案內流程:看得到專案(委派 projects_sel)就看得到該專案所有流程
  OR (project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = workflow_instances.project_id))
);

-- ── tasks_sel:專案內流程的任務 → 看得到該流程就看得到 ──
DROP POLICY IF EXISTS tasks_sel ON public.tasks;
CREATE POLICY tasks_sel ON public.tasks FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR assignee_id       = current_employee_id()
  OR created_by_emp_id = current_employee_id()
  OR (project_id IS NOT NULL AND is_project_member(project_id::bigint))
  OR (workflow_instance_id IS NOT NULL AND is_workflow_initiator(workflow_instance_id::bigint))
  OR (project_id IS NOT NULL AND is_project_owner(project_id::bigint))
  OR is_mentioned_in_task(id::bigint)
  -- 專案內流程的任務:看得到該流程(委派 workflow_instances_sel)就看得到
  OR (workflow_instance_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workflow_instances wi
        WHERE wi.id = tasks.workflow_instance_id AND wi.project_id IS NOT NULL))
);

COMMIT;

NOTIFY pgrst, 'reload schema';
