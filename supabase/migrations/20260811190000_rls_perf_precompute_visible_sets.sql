-- ════════════════════════════════════════════════════════════════════════════
-- 流程/專案管理:一般員工仍卡(專案5s/流程3s)修正 — 2026-08-11
--   20260811180000 讓 super_admin/admin/擁有者短路,但一般員工沒東西短路 →
--   仍對 895 列 tasks / 132 列 workflow 逐列跑 is_project_member/has_task_in_workflow…
--   解法(同排班):把「我看得到哪些專案/流程/被提及任務」的 id 一次算好(跑在小表上),
--   tasks/workflow 改成便宜的陣列比對(id = ANY((SELECT …)::bigint[])),不再逐列查表。
--   ★關鍵:原本的 EXISTS(FROM workflow_instances/projects) 子查詢是「吃 RLS 過濾」的
--     (只算我看得到的),所以 helper 必須逐條精確複製那層可見性(不能用 SECURITY DEFINER
--     直接回全部,否則會把別人的放出來 = 資安洞)。逐角色驗證可見列數需與改前完全一致。
--   idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- 【我看得到的專案 id】= projects_sel 語意:owner=我 OR 我是成員 OR 我在該專案有任務 OR 我在該專案被提及
CREATE OR REPLACE FUNCTION public._my_visible_project_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(array_agg(DISTINCT id), '{}')::bigint[] FROM (
    SELECT p.id::bigint FROM projects p WHERE p.owner_id = current_employee_id()
    UNION
    SELECT pm.project_id::bigint FROM project_members pm WHERE pm.employee_id = current_employee_id()
    UNION
    SELECT t.project_id::bigint FROM tasks t WHERE t.assignee_id = current_employee_id() AND t.project_id IS NOT NULL
    UNION
    SELECT t.project_id::bigint FROM task_mentions tm JOIN tasks t ON t.id = tm.task_id
      WHERE tm.mentioned_employee_id = current_employee_id() AND t.project_id IS NOT NULL
  ) s
$fn$;

-- 【我看得到的流程 id】= workflow_instances_sel 語意:
--   started/target/applicant=我 OR 我在該流程有任務 OR 我在該流程被提及 OR 該流程掛的專案我看得到
CREATE OR REPLACE FUNCTION public._my_visible_workflow_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(array_agg(DISTINCT wid), '{}')::bigint[] FROM (
    SELECT wi.id::bigint AS wid FROM workflow_instances wi
      WHERE wi.started_by_id = current_employee_id()
         OR wi.target_employee_id = current_employee_id()
         OR wi.applicant_emp_id = current_employee_id()
    UNION
    SELECT t.workflow_instance_id::bigint FROM tasks t
      WHERE t.assignee_id = current_employee_id() AND t.workflow_instance_id IS NOT NULL
    UNION
    SELECT t.workflow_instance_id::bigint FROM task_mentions tm JOIN tasks t ON t.id = tm.task_id
      WHERE tm.mentioned_employee_id = current_employee_id() AND t.workflow_instance_id IS NOT NULL
    UNION
    SELECT wi.id::bigint FROM workflow_instances wi
      WHERE wi.project_id IS NOT NULL AND wi.project_id = ANY ((SELECT public._my_visible_project_ids())::bigint[])
  ) s
$fn$;

-- 【tasks 經「專案」可見的專案 id】= is_project_member OR is_project_owner(僅成員/擁有者,不含 has_task/mention)
CREATE OR REPLACE FUNCTION public._my_task_project_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(array_agg(DISTINCT id), '{}')::bigint[] FROM (
    SELECT pm.project_id::bigint AS id FROM project_members pm WHERE pm.employee_id = current_employee_id()
    UNION
    SELECT p.id::bigint FROM projects p WHERE p.owner_id = current_employee_id()
  ) s
$fn$;

-- 【tasks 經「流程」可見的流程 id】= is_workflow_initiator OR has_task_in_workflow OR (我看得到的流程 且 該流程有掛專案)
CREATE OR REPLACE FUNCTION public._my_task_workflow_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(array_agg(DISTINCT wid), '{}')::bigint[] FROM (
    SELECT wi.id::bigint AS wid FROM workflow_instances wi WHERE wi.started_by_id = current_employee_id()
    UNION
    SELECT t.workflow_instance_id::bigint FROM tasks t WHERE t.assignee_id = current_employee_id() AND t.workflow_instance_id IS NOT NULL
    UNION
    SELECT wi.id::bigint FROM workflow_instances wi
      WHERE wi.project_id IS NOT NULL AND wi.id = ANY ((SELECT public._my_visible_workflow_ids())::bigint[])
  ) s
$fn$;

-- 【我被提及的任務 id】= is_mentioned_in_task
CREATE OR REPLACE FUNCTION public._my_mentioned_task_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(array_agg(tm.task_id::bigint), '{}')::bigint[] FROM task_mentions tm WHERE tm.mentioned_employee_id = current_employee_id()
$fn$;

GRANT EXECUTE ON FUNCTION public._my_visible_project_ids(), public._my_visible_workflow_ids(),
  public._my_task_project_ids(), public._my_task_workflow_ids(), public._my_mentioned_task_ids()
  TO anon, authenticated;

-- ── tasks:逐列函式 → 一次算好的 id 集合比對 ──
ALTER POLICY tasks_sel ON public.tasks USING (
  (SELECT public.is_super_admin())
  OR ((SELECT public.is_admin()) AND organization_id = (SELECT public.current_user_org_id()))
  OR ((SELECT auth.role()) = 'service_role')
  OR assignee_id = (SELECT public.current_employee_id())
  OR created_by_emp_id = (SELECT public.current_employee_id())
  OR id = ANY ((SELECT public._my_mentioned_task_ids())::bigint[])
  OR (project_id IS NOT NULL AND project_id = ANY ((SELECT public._my_task_project_ids())::bigint[]))
  OR (workflow_instance_id IS NOT NULL AND workflow_instance_id = ANY ((SELECT public._my_task_workflow_ids())::bigint[]))
);

-- ── workflow_instances:逐列函式 → 「我看得到的流程」集合比對 ──
ALTER POLICY workflow_instances_sel ON public.workflow_instances USING (
  (SELECT public.is_super_admin())
  OR ((SELECT public.is_admin()) AND organization_id = (SELECT public.current_user_org_id()))
  OR ((SELECT auth.role()) = 'service_role')
  OR id = ANY ((SELECT public._my_visible_workflow_ids())::bigint[])
);
