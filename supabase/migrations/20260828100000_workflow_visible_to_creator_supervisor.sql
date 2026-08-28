-- 流程(工作流)可見性:主管看不到部下開的流程。
-- 需求:開單人 / 流程負責人 / 任務負責人 三者的「直屬主管鏈 + 門市店長」都要看得到整個流程。
-- 做法:把主管可見併進既有 _my_visible_workflow_ids()(policy 已呼叫,InitPlan 只算一次,不逐列跑遞迴)。
--   先算「我的下屬集合」_my_subordinate_emp_ids()(supervisor_id 遞迴往下 + 我當店長的門市員工),
--   再把 started_by_id/target_employee_id/applicant_emp_id/assignee(文字)/tasks.assignee_id 落在下屬集合的流程納入。

-- 我的下屬(含間接)+ 我當店長門市的員工
CREATE OR REPLACE FUNCTION public._my_subordinate_emp_ids()
RETURNS integer[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH RECURSIVE down(id, depth) AS (
    SELECT e.id, 1 FROM public.employees e WHERE e.supervisor_id = public.current_employee_id()
    UNION ALL
    SELECT e.id, d.depth + 1 FROM public.employees e JOIN down d ON e.supervisor_id = d.id WHERE d.depth < 20
  )
  SELECT COALESCE(array_agg(DISTINCT id), '{}')::int[] FROM (
    SELECT id FROM down
    UNION
    SELECT e.id FROM public.employees e JOIN public.stores s ON s.id = e.store_id
      WHERE s.manager_id = public.current_employee_id()
  ) x
$function$;

CREATE OR REPLACE FUNCTION public._my_visible_workflow_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH subs AS (SELECT public._my_subordinate_emp_ids() AS ids)
  SELECT COALESCE(array_agg(DISTINCT wid), '{}')::bigint[] FROM (
    -- 我本人涉入(原邏輯)
    SELECT wi.id::bigint AS wid FROM public.workflow_instances wi
      WHERE wi.started_by_id = public.current_employee_id()
         OR wi.target_employee_id = public.current_employee_id()
         OR wi.applicant_emp_id = public.current_employee_id()
    UNION
    SELECT t.workflow_instance_id::bigint FROM public.tasks t
      WHERE t.assignee_id = public.current_employee_id() AND t.workflow_instance_id IS NOT NULL
    UNION
    SELECT t.workflow_instance_id::bigint FROM public.task_mentions tm JOIN public.tasks t ON t.id = tm.task_id
      WHERE tm.mentioned_employee_id = public.current_employee_id() AND t.workflow_instance_id IS NOT NULL
    UNION
    SELECT wi.id::bigint FROM public.workflow_instances wi
      WHERE wi.project_id IS NOT NULL AND wi.project_id = ANY ((SELECT public._my_visible_project_ids())::bigint[])
    -- ★ 主管可見:開單人 / 流程負責人(target_employee_id 或 assignee 文字)/ 申請人 是我的下屬
    UNION
    SELECT wi.id::bigint FROM public.workflow_instances wi, subs
      WHERE wi.started_by_id     = ANY(subs.ids)
         OR wi.target_employee_id = ANY(subs.ids)
         OR wi.applicant_emp_id  = ANY(subs.ids)
    UNION
    SELECT wi.id::bigint FROM public.workflow_instances wi
      CROSS JOIN subs
      JOIN public.employees e ON e.name = wi.assignee AND e.organization_id = wi.organization_id
      WHERE e.id = ANY(subs.ids)
    -- ★ 任務負責人是我的下屬
    UNION
    SELECT t.workflow_instance_id::bigint FROM public.tasks t, subs
      WHERE t.workflow_instance_id IS NOT NULL AND t.assignee_id = ANY(subs.ids)
  ) s
$function$;
