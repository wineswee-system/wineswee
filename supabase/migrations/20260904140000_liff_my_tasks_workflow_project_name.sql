-- 2026-09-04 LIFF「我的任務」帶出所屬流程名稱 + 專案名稱(對齊員工後台待辦)
--   原本 row_to_json(t.*) 只有 workflow_instance_id / project_id;補 workflow_name / project_name。
--   專案名稱:優先 task.project_id,沒有就用其所屬流程的 project_id。

CREATE OR REPLACE FUNCTION public.liff_list_my_tasks(p_line_user_id text, p_scope text DEFAULT 'active'::text)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(
    (to_jsonb(t.*) || jsonb_build_object(
       'workflow_name', wi.template_name,
       'project_name',  pr.name
     ))
    ORDER BY
      CASE WHEN t.status IN ('已完成','已取消','completed') THEN 1 ELSE 0 END,
      t.due_date NULLS LAST,
      t.id
  ), '[]'::json)
  FROM public.tasks t
  LEFT JOIN public.workflow_instances wi ON wi.id = t.workflow_instance_id
  LEFT JOIN public.projects pr ON pr.id = COALESCE(t.project_id, wi.project_id)
  WHERE t.assignee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND (
      CASE lower(COALESCE(p_scope, 'active'))
        WHEN 'all'       THEN TRUE
        WHEN 'completed' THEN t.status IN ('已完成','已取消','completed')
        ELSE                  t.status NOT IN ('已完成','已取消','completed','未開始','待處理')
      END
    )
$function$;
