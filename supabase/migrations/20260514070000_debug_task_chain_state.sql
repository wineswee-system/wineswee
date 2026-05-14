-- ════════════════════════════════════════════════════════════
-- 診斷工具：dump 一筆 task 的 chain + confirmations + trigger 狀態
-- 用於排查「第 2 關沒收到 LINE」之類問題
--
-- 用法：
--   SELECT public._debug_task_chain_state();          -- 自動找最近一筆卡住的
--   SELECT public._debug_task_chain_state(123);       -- 指定 task_id
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._debug_task_chain_state(p_task_id int DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task tasks;
  v_result json;
BEGIN
  IF p_task_id IS NULL THEN
    SELECT id INTO p_task_id FROM tasks
     WHERE status IN ('待確認','待簽核') AND approval_chain_id IS NOT NULL
     ORDER BY id DESC LIMIT 1;
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN
    RETURN json_build_object('error', 'TASK_NOT_FOUND', 'task_id', p_task_id);
  END IF;

  SELECT json_build_object(
    'task', json_build_object(
      'id', v_task.id, 'title', v_task.title, 'status', v_task.status,
      'approval_chain_id', v_task.approval_chain_id,
      'assignee_id', v_task.assignee_id,
      'organization_id', v_task.organization_id,
      'confirmation_status', v_task.confirmation_status,
      'completed_at', v_task.completed_at,
      'updated_at', v_task.updated_at
    ),
    'chain_steps', (
      SELECT json_agg(json_build_object(
        'id', s.id,
        'step_order', s.step_order,
        'label', s.label,
        'role_name', s.role_name,
        'target_type', s.target_type,
        'target_emp_id', s.target_emp_id,
        'target_role_id', s.target_role_id,
        'target_dept_id', s.target_dept_id,
        'resolved_approvers', (
          SELECT json_agg(json_build_object('id', e.id, 'name', e.name,
                  'organization_id', e.organization_id,
                  'line_user_id', (
                    SELECT v.line_user_id FROM v_employee_line_resolved v
                     WHERE v.employee_id = e.id
                     ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
                     LIMIT 1
                  )))
            FROM employees e
           WHERE e.status = '在職'
             AND (v_task.organization_id IS NULL OR e.organization_id = v_task.organization_id)
             AND public._employee_matches_chain_step(e.id, s.id, v_task.assignee_id)
        )
      ) ORDER BY s.step_order)
        FROM approval_chain_steps s
       WHERE s.chain_id = v_task.approval_chain_id
    ),
    'confirmations', (
      SELECT json_agg(row_to_json(tc) ORDER BY tc.step_order, tc.id)
        FROM (
          SELECT id, step_order, approver, status, responded_at, notes, created_at
            FROM task_confirmations
           WHERE task_id = p_task_id
           ORDER BY step_order, id
        ) tc
    ),
    'triggers', (
      SELECT json_agg(json_build_object(
        'name', tgname, 'enabled', tgenabled,
        'function', (SELECT proname FROM pg_proc WHERE oid = tgfoid)
      ))
        FROM pg_trigger
       WHERE tgrelid = 'public.task_confirmations'::regclass AND NOT tgisinternal
    ),
    'function_overloads', (
      SELECT json_agg(pg_get_function_arguments(p.oid))
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proname = '_create_task_confirmations_for_step' AND n.nspname = 'public'
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public._debug_task_chain_state(int) TO authenticated, anon, service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
