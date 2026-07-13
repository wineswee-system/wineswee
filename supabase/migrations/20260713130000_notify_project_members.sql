-- 專案成員通知:聚合專案內被指派任務的人 + 去重 + 寫站內通知,回傳待發 LINE 名單
-- 2026-07-13  需求:專案建立後(或手動),凡在專案任一流程有任務者,各發一則「你被安排到XX專案」彙總。
--   一人一則(按 assignee_id 彙總任務數);去重(已通知過同專案跳過,force 則重發)。
--   SECURITY DEFINER:繞 RLS 幫別人寫 notifications;LINE 卡由前端 lineNotify 依回傳名單發。
--   idempotent:CREATE OR REPLACE。

CREATE OR REPLACE FUNCTION public.notify_project_members(p_project_id bigint, p_force boolean DEFAULT false)
RETURNS TABLE(employee_id integer, employee_name text, task_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_project_name text;
  v_org int;
BEGIN
  SELECT name, organization_id INTO v_project_name, v_org FROM public.projects WHERE id = p_project_id;
  IF v_project_name IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH proj_tasks AS (
    -- 專案內任務:直接掛專案 或 掛專案的流程
    SELECT t.assignee_id, COUNT(*)::int AS cnt
    FROM public.tasks t
    WHERE t.assignee_id IS NOT NULL
      AND (t.project_id = p_project_id
           OR t.workflow_instance_id IN (SELECT id FROM public.workflow_instances WHERE project_id = p_project_id))
    GROUP BY t.assignee_id
  ),
  to_notify AS (
    SELECT pt.assignee_id, pt.cnt
    FROM proj_tasks pt
    WHERE p_force OR NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.type = 'project_assigned'
        AND n.recipient_emp_id = pt.assignee_id
        AND n.payload->>'project_id' = p_project_id::text
    )
  ),
  ins AS (
    INSERT INTO public.notifications (type, title, recipient_emp_id, organization_id, payload)
    SELECT 'project_assigned',
           '你被安排到專案「' || v_project_name || '」，共 ' || tn.cnt || ' 項任務',
           tn.assignee_id, v_org,
           jsonb_build_object('project_id', p_project_id::text, 'task_count', tn.cnt)
    FROM to_notify tn
    RETURNING recipient_emp_id
  )
  SELECT e.id, e.name, tn.cnt
  FROM to_notify tn
  JOIN public.employees e ON e.id = tn.assignee_id;
END $$;

NOTIFY pgrst, 'reload schema';
