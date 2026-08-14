-- 簽核者用的任務完整內容撈取(SECURITY DEFINER,繞過 tasks 只給 admin 的 RLS)
-- 授權:caller 是這任務的簽核人(task_confirmations.approver=本人)或負責人或 admin/super,且同 org。
-- 給「確認審批」的唯讀簽核視窗用:一次回 任務+專案+子任務+檢查清單+附件+留言+簽核關卡+工作流。

CREATE OR REPLACE FUNCTION public.web_get_task_approval_detail(p_task_id integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_emp        employees;
  v_task       tasks;
  v_authorized boolean;
  v_result     json;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'TASK_NOT_FOUND'); END IF;

  v_authorized := (v_task.organization_id = v_emp.organization_id) AND (
       EXISTS (SELECT 1 FROM task_confirmations tc WHERE tc.task_id = p_task_id AND tc.approver = v_emp.name)
    OR v_task.assignee_id = v_emp.id
    OR v_task.assignee = v_emp.name
    OR public.is_admin()
    OR public.is_super_admin()
  );
  IF NOT v_authorized THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;

  SELECT json_build_object(
    'ok', true,
    'has_chain', (v_task.approval_chain_id IS NOT NULL),
    'task', (SELECT row_to_json(x) FROM (
        SELECT id, title, description, notes, assignee, assignee_id, status, priority,
               due_date, store, task_code, category, bucket, project_id, created_at
          FROM tasks WHERE id = p_task_id) x),
    'project', (SELECT row_to_json(p) FROM (
        SELECT id, name, description, status, progress
          FROM projects WHERE id = v_task.project_id) p),
    'project_tasks', COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'status', status) ORDER BY id)
        FROM tasks WHERE project_id = v_task.project_id AND parent_task_id IS NULL), '[]'::json),
    'subtasks', COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'status', status) ORDER BY id)
        FROM tasks WHERE parent_task_id = p_task_id), '[]'::json),
    'checklist', COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'checked', checked) ORDER BY sort_order, id)
        FROM task_checklist_items WHERE task_id = p_task_id), '[]'::json),
    'attachments', COALESCE((SELECT json_agg(json_build_object('id', id, 'file_name', file_name, 'storage_path', storage_path, 'file_url', file_url) ORDER BY created_at)
        FROM task_attachments WHERE task_id = p_task_id), '[]'::json),
    'comments', COALESCE((SELECT json_agg(json_build_object('id', id, 'author', author, 'content', content, 'created_at', created_at) ORDER BY created_at)
        FROM task_comments WHERE task_id = p_task_id), '[]'::json),
    'confirmations', COALESCE((SELECT json_agg(json_build_object('id', id, 'approver', approver, 'status', status, 'step_order', step_order, 'notes', notes) ORDER BY step_order, id)
        FROM task_confirmations WHERE task_id = p_task_id), '[]'::json),
    'workflow', COALESCE((SELECT json_agg(json_build_object('id', id, 'template_name', template_name, 'status', status) ORDER BY started_at DESC NULLS LAST)
        FROM workflow_instances WHERE triggered_by_task_id = p_task_id), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.web_get_task_approval_detail(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.web_get_task_approval_detail(integer) TO authenticated;
