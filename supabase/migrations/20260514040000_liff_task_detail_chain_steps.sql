-- ════════════════════════════════════════════════════════════
-- LIFF 任務確認加 chain 進度條 — 擴充 liff_get_task_detail 多回 chain_steps
-- 2026-05-14
--
-- 反饋：LIFF 看流程任務確認時，沒有 chain 進度條（HR 表單有）
-- 修法：liff_get_task_detail 多回傳 chain_steps（chain 的全部 steps + label + target）
--       LIFF 端用現成的 <ChainTimeline /> 元件直接渲染（不重造輪子）
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_get_task_detail(p_line_user_id text, p_task_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  is_approver := EXISTS (SELECT 1 FROM task_confirmations WHERE task_id = p_task_id AND approver = emp.name);

  IF NOT (is_assignee OR is_approver) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task', row_to_json(task_row),
    'is_assignee', is_assignee,
    'is_approver', is_approver,
    'checklists', COALESCE((
      SELECT json_agg(json_build_object(
        'id',    cl.id,
        'name',  cl.name,
        'items', COALESCE((
          SELECT json_agg(json_build_object(
            'id', ci.id, 'title', ci.title,
            'checked', COALESCE(s.checked, false), 'sort_order', ci.sort_order
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
        'id', tci.id, 'title', tci.title, 'checked', tci.checked, 'sort_order', tci.sort_order
      ) ORDER BY tci.sort_order, tci.id)
      FROM public.task_checklist_items tci
      WHERE tci.task_id = p_task_id
    ), '[]'::json),
    'comments', COALESCE((
      SELECT json_agg(json_build_object(
        'id', tc.id, 'author', tc.author, 'content', tc.content, 'source', tc.source, 'created_at', tc.created_at
      ) ORDER BY tc.created_at)
      FROM public.task_comments tc WHERE tc.task_id = p_task_id
    ), '[]'::json),
    'confirmations', COALESCE((
      SELECT json_agg(json_build_object(
        'id', tcf.id, 'approver', tcf.approver, 'status', tcf.status, 'notes', tcf.notes,
        'step_order', tcf.step_order, 'responded_at', tcf.responded_at, 'created_at', tcf.created_at
      ) ORDER BY tcf.step_order, tcf.id)
      FROM public.task_confirmations tcf WHERE tcf.task_id = p_task_id
    ), '[]'::json),
    'attachments', COALESCE((
      SELECT json_agg(json_build_object(
        'id', ta.id, 'file_name', ta.file_name, 'storage_path', ta.storage_path,
        'file_size', ta.file_size, 'file_type', ta.file_type,
        'uploaded_by', ta.uploaded_by, 'uploaded_by_emp_id', ta.uploaded_by_emp_id,
        'created_at', ta.created_at
      ) ORDER BY ta.created_at DESC)
      FROM public.task_attachments ta WHERE ta.task_id = p_task_id
    ), '[]'::json),
    -- ★ 2026-05-14 新：chain_steps（給 LIFF 用 ChainTimeline 畫進度條用）
    --   含 chain 全部 step 的 label + target_type，前端跟 confirmations 合併出 status
    'chain_steps', COALESCE((
      SELECT json_agg(json_build_object(
        'id', cs.id,
        'step_order', cs.step_order,
        'label', cs.label,
        'role_name', cs.role_name,
        'target_type', cs.target_type
      ) ORDER BY cs.step_order)
      FROM public.approval_chain_steps cs
      WHERE cs.chain_id = task_row.approval_chain_id
    ), '[]'::json)
  );
END $function$;

COMMIT;

-- 驗證
SELECT (pg_get_functiondef('public.liff_get_task_detail'::regproc) LIKE '%chain_steps%') AS has_chain_steps;
