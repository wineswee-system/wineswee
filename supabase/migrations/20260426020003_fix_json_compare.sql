-- 修：v_approvers = '[]'::json 失敗（json 型別沒 = 運算子，只有 jsonb 有）
-- 改用 jsonb 比較

CREATE OR REPLACE FUNCTION public.liff_complete_task_v2(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  task_row      tasks;
  has_pending   boolean;
  v_approvers   json := '[]'::json;
  new_status    text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO task_row FROM public.tasks
   WHERE id = p_task_id AND assignee_id = emp.id;
  IF task_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_ASSIGNED');
  END IF;

  IF task_row.approval_chain_id IS NOT NULL THEN
    PERFORM 1 FROM task_confirmations WHERE task_id = p_task_id LIMIT 1;
    IF NOT FOUND THEN
      v_approvers := public._create_task_confirmations_for_step(
        p_task_id, task_row.approval_chain_id, 0, task_row.organization_id
      );
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM task_confirmations
    WHERE task_id = p_task_id AND status = 'pending'
  ) INTO has_pending;

  IF task_row.approval_chain_id IS NOT NULL AND NOT has_pending THEN
    new_status := '已完成';
  ELSE
    new_status := CASE WHEN has_pending THEN '待確認' ELSE '已完成' END;
  END IF;

  UPDATE tasks SET
    status       = new_status,
    completed_at = CASE WHEN new_status = '已完成' THEN NOW() ELSE NULL END
  WHERE id = p_task_id;

  -- ★ 修：原本 v_approvers = '[]'::json 因 json 沒 = 運算子直接 raise
  --   改 jsonb 比較
  IF v_approvers::jsonb = '[]'::jsonb AND has_pending THEN
    SELECT COALESCE(json_agg(json_build_object(
      'emp_id', e.id, 'name', e.name, 'line_user_id', e.line_user_id
    )), '[]'::json) INTO v_approvers
      FROM task_confirmations tc
      JOIN employees e ON e.name = tc.approver
        AND (e.organization_id = task_row.organization_id OR task_row.organization_id IS NULL)
     WHERE tc.task_id = p_task_id AND tc.status = 'pending';
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task_id', p_task_id,
    'status', new_status,
    'has_pending_confirmations', has_pending,
    'approvers', v_approvers,
    'task_title', task_row.title
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_complete_task_v2(text, int) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
