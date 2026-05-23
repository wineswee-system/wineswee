-- ════════════════════════════════════════════════════════════════════════════
-- Phase 7: LIFF 任務詳情加 form_bindings
-- ────────────────────────────────────────────────────────────────────────────
-- liff_get_task_detail 新回傳：form_bindings（綁定表單清單）
-- 完整 CREATE OR REPLACE（partial overwrite 災難預防）
-- ════════════════════════════════════════════════════════════════════════════

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
    ), '[]'::json),
    -- ★ 2026-05-23 新：form_bindings（流程任務綁定的表單清單）
    'form_bindings', COALESCE((
      SELECT json_agg(json_build_object(
        'id', tfb.id,
        'form_type', tfb.form_type,
        'form_template_id', tfb.form_template_id,
        'form_id', tfb.form_id,
        'status', tfb.status,
        'required_status', tfb.required_status,
        'form_label', tfb.form_label,
        'completed_at', tfb.completed_at
      ) ORDER BY tfb.id)
      FROM public.task_form_bindings tfb
      WHERE tfb.task_id = p_task_id
    ), '[]'::json)
  );
END $function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
