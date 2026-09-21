-- ============================================================================
-- liff_list_my_tasks active scope 補上「待處理」排除
-- ============================================================================
--
-- 上一輪 migration 只排除「未開始」，但 DB 內實際 task status 有兩種「還沒輪
-- 到」的值（schema drift）：
--   未開始: 6 筆
--   待處理: 22 筆  ← ★ 主流值
--
-- 主系統 wf-354 UI 顯示「未開始」 — 是 UI mapping，DB 實際 status='待處理'。
-- LIFF Tasks.jsx 直接 render t.status 所以顯示「待處理」（用戶看到的字串）。
--
-- 修法：active scope 排除 '待處理' / '未開始' / '已完成' / '已取消' / 'completed'
-- ============================================================================

CREATE OR REPLACE FUNCTION public.liff_list_my_tasks(
  p_line_user_id text,
  p_scope text DEFAULT 'active'
) RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t.*)
    ORDER BY
      CASE WHEN t.status IN ('已完成','已取消','completed') THEN 1 ELSE 0 END,
      t.due_date NULLS LAST,
      t.id
  ), '[]'::json)
  FROM public.tasks t
  WHERE t.assignee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND (
      CASE lower(COALESCE(p_scope, 'active'))
        WHEN 'all'       THEN TRUE
        WHEN 'completed' THEN t.status IN ('已完成','已取消','completed')
        -- ★ 'active' 排除「未開始」+「待處理」— 兩種「還沒輪到」schema drift 都擋
        ELSE                  t.status NOT IN ('已完成','已取消','completed','未開始','待處理')
      END
    )
$$;

COMMENT ON FUNCTION public.liff_list_my_tasks IS
  'LIFF 任務列表 — active 排除「未開始」+「待處理」(流程前置 step 未完成的 task 不顯示)';
