-- 任務可見性對齊流程可見性:主管看得到流程,流程底下的任務就該一起看得到。
-- 原 _my_task_workflow_ids() 第三支只納入「有 project_id」的可見流程 → 沒綁專案的流程,任務被擋(不一致)。
-- 改成:凡 _my_visible_workflow_ids() 看得到的流程,其任務都可見(移除 project_id 限制)。

CREATE OR REPLACE FUNCTION public._my_task_workflow_ids()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(array_agg(DISTINCT wid), '{}')::bigint[] FROM (
    SELECT wi.id::bigint AS wid FROM public.workflow_instances wi WHERE wi.started_by_id = current_employee_id()
    UNION
    SELECT t.workflow_instance_id::bigint FROM public.tasks t
      WHERE t.assignee_id = current_employee_id() AND t.workflow_instance_id IS NOT NULL
    UNION
    -- ★ 看得到流程=看得到其任務(對齊 _my_visible_workflow_ids,不再限 project_id)
    SELECT unnest(public._my_visible_workflow_ids())
  ) s
$function$;
