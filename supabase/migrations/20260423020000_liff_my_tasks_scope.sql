-- ================================================
-- 擴充 liff_list_my_tasks 支援 p_scope
--
-- 原版：固定只回 active (非完成/取消)
-- 新版：p_scope = 'active' | 'completed' | 'all'（預設 active，向後相容）
--
-- 驅動來源：LIFF Tasks.jsx 新增「進行中 / 已完成 / 全部」tab，
-- LINE BOT 主選單「📁 所有任務」按鈕會 deep-link 到 /tasks?filter=all
-- ================================================

DROP FUNCTION IF EXISTS public.liff_list_my_tasks(text);

CREATE OR REPLACE FUNCTION public.liff_list_my_tasks(
  p_line_user_id text,
  p_scope        text DEFAULT 'active'
)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t.*)
    ORDER BY
      CASE WHEN t.status IN ('已完成','已取消') THEN 1 ELSE 0 END,  -- 未完成優先
      t.due_date NULLS LAST,
      t.id
  ), '[]'::json)
  FROM public.tasks t
  WHERE t.assignee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND (
      CASE lower(COALESCE(p_scope, 'active'))
        WHEN 'all'       THEN TRUE
        WHEN 'completed' THEN t.status IN ('已完成','已取消')
        ELSE                  t.status NOT IN ('已完成','已取消')
      END
    )
$$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_tasks(text, text) TO anon, authenticated;
