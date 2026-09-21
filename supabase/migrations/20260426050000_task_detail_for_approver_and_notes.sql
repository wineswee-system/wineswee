-- ============================================================
-- liff_get_task_detail 升級
-- 1. 讓「審批人」也能拉 detail (原本只 assignee 才能)
-- 2. 回傳 task_confirmations 陣列 (含 status / notes / 簽核人)
--    → Tasks.jsx 顯示退回原因；TaskConfirmations.jsx 老闆審時可看完整資訊
-- ============================================================

CREATE OR REPLACE FUNCTION public.liff_get_task_detail(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  task_row tasks;
  is_assignee boolean;
  is_approver boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO task_row FROM public.tasks WHERE id = p_task_id;
  IF task_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  is_assignee := (task_row.assignee_id = emp.id);
  is_approver := EXISTS (
    SELECT 1 FROM task_confirmations WHERE task_id = p_task_id AND approver = emp.name
  );

  IF NOT (is_assignee OR is_approver) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task', row_to_json(task_row),
    'is_assignee', is_assignee,
    'is_approver', is_approver,
    -- 範本清單（已改 per-task 狀態表）
    'checklists', COALESCE((
      SELECT json_agg(json_build_object(
        'id',    cl.id,
        'name',  cl.name,
        'items', COALESCE((
          SELECT json_agg(json_build_object(
            'id',         ci.id,
            'title',      ci.title,
            'checked',    COALESCE(s.checked, false),
            'sort_order', ci.sort_order
          ) ORDER BY ci.sort_order, ci.id)
          FROM public.checklist_items ci
          LEFT JOIN public.task_checklist_item_state s
            ON s.checklist_item_id = ci.id AND s.task_id = p_task_id
          WHERE ci.checklist_id = cl.id
        ), '[]'::json)
      ) ORDER BY tc.id)
      FROM public.task_checklists tc
      JOIN public.checklists cl ON cl.id = tc.checklist_id
      WHERE tc.task_id = p_task_id
    ), '[]'::json),
    'inline_items', COALESCE((
      SELECT json_agg(json_build_object(
        'id',      tci.id,
        'title',   tci.title,
        'checked', tci.checked,
        'sort_order', tci.sort_order
      ) ORDER BY tci.sort_order, tci.id)
      FROM public.task_checklist_items tci
      WHERE tci.task_id = p_task_id
    ), '[]'::json),
    'comments', COALESCE((
      SELECT json_agg(json_build_object(
        'id',         tc.id,
        'author',     tc.author,
        'content',    tc.content,
        'source',     tc.source,
        'created_at', tc.created_at
      ) ORDER BY tc.created_at)
      FROM public.task_comments tc
      WHERE tc.task_id = p_task_id
    ), '[]'::json),
    -- ★ 新：confirmations 陣列（status + notes + 簽核時間）
    'confirmations', COALESCE((
      SELECT json_agg(json_build_object(
        'id',           tcf.id,
        'approver',     tcf.approver,
        'status',       tcf.status,
        'notes',        tcf.notes,
        'step_order',   tcf.step_order,
        'responded_at', tcf.responded_at,
        'created_at',   tcf.created_at
      ) ORDER BY tcf.step_order, tcf.id)
      FROM public.task_confirmations tcf
      WHERE tcf.task_id = p_task_id
    ), '[]'::json)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_task_detail(text, int) TO authenticated, anon;
NOTIFY pgrst, 'reload schema';
