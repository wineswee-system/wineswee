-- @ 提及可見：任務討論裡被 @ 標記的人，可看到該任務 + 它的流程/專案
-- 2026-07-08
-- 需求：被 @mention（task_mentions.mentioned_employee_id = 我）→ 能看到該 task
--   以及該 task 所屬的 workflow_instance / project（否則會「看得到任務卻進不了流程」）。
-- helper 用 SECURITY DEFINER 繞 RLS 查 task_mentions/tasks，避免 policy 循環依賴。
-- idempotent。

BEGIN;

-- ── helpers ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_mentioned_in_task(p_task_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_mentions tm
     WHERE tm.task_id = p_task_id
       AND tm.mentioned_employee_id = current_employee_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_mention_in_workflow(p_wf_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_mentions tm
      JOIN public.tasks t ON t.id = tm.task_id
     WHERE t.workflow_instance_id = p_wf_id
       AND tm.mentioned_employee_id = current_employee_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_mention_in_project(p_proj_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_mentions tm
      JOIN public.tasks t ON t.id = tm.task_id
     WHERE t.project_id = p_proj_id
       AND tm.mentioned_employee_id = current_employee_id()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_mentioned_in_task(bigint)   TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_mention_in_workflow(bigint) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_mention_in_project(bigint)  TO authenticated, anon;

-- ── tasks_sel：加 被 @ 提及可見 ──────────────────────────
DROP POLICY IF EXISTS tasks_sel ON public.tasks;
CREATE POLICY tasks_sel ON public.tasks FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR assignee_id       = current_employee_id()
  OR created_by_emp_id = current_employee_id()
  OR (project_id IS NOT NULL AND is_project_member(project_id::bigint))
  OR (workflow_instance_id IS NOT NULL AND is_workflow_initiator(workflow_instance_id::bigint))
  OR (project_id IS NOT NULL AND is_project_owner(project_id::bigint))
  OR is_mentioned_in_task(id::bigint)
);

-- ── workflow_instances_sel：加 該流程內有 task 被 @ 提及可見 ──
DROP POLICY IF EXISTS workflow_instances_sel ON public.workflow_instances;
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR started_by_id      = current_employee_id()
  OR target_employee_id = current_employee_id()
  OR applicant_emp_id   = current_employee_id()
  OR has_task_in_workflow(id::bigint)
  OR has_mention_in_workflow(id::bigint)
);

-- ── projects_sel：加 該專案內有 task 被 @ 提及可見 ──
DROP POLICY IF EXISTS projects_sel ON public.projects;
CREATE POLICY projects_sel ON public.projects FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR owner_id = current_employee_id()
  OR is_project_member(id::bigint)
  OR has_task_in_project(id::bigint)
  OR has_mention_in_project(id::bigint)
);

COMMIT;
NOTIFY pgrst, 'reload schema';
