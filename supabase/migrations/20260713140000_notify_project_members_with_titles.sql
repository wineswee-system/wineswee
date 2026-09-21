-- 專案成員通知:回傳「任務名稱陣列」(卡片列出所有任務,不只數量)
-- 2026-07-13  調整:LINE 卡要列出該人的所有任務名稱(移除前往查看按鈕,LIFF 無專案功能)。
--   RPC 多回 task_titles(jsonb 陣列);站內通知 payload 也帶。signature 改→先 DROP。
--   idempotent。

DROP FUNCTION IF EXISTS public.notify_project_members(bigint, boolean);
CREATE OR REPLACE FUNCTION public.notify_project_members(p_project_id bigint, p_force boolean DEFAULT false)
RETURNS TABLE(employee_id integer, employee_name text, task_count integer, task_titles jsonb)
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
    SELECT t.assignee_id, COUNT(*)::int AS cnt,
           jsonb_agg(t.title ORDER BY t.step_order NULLS LAST, t.id) AS titles
    FROM public.tasks t
    WHERE t.assignee_id IS NOT NULL
      AND (t.project_id = p_project_id
           OR t.workflow_instance_id IN (SELECT id FROM public.workflow_instances WHERE project_id = p_project_id))
    GROUP BY t.assignee_id
  ),
  to_notify AS (
    SELECT pt.assignee_id, pt.cnt, pt.titles
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
           jsonb_build_object('project_id', p_project_id::text, 'task_count', tn.cnt, 'task_titles', tn.titles)
    FROM to_notify tn
    RETURNING recipient_emp_id
  )
  SELECT e.id, e.name, tn.cnt, tn.titles
  FROM to_notify tn
  JOIN public.employees e ON e.id = tn.assignee_id;
END $$;

NOTIFY pgrst, 'reload schema';
