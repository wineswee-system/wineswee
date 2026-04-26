-- 修：employees.line_user_id 在 20260419000000 被 DROP 搬到 employee_line_accounts
-- 三個 RPC 重新 JOIN ela 拿 line_user_id

CREATE OR REPLACE FUNCTION public._create_task_confirmations_for_step(
  p_task_id  INT,
  p_chain_id INT,
  p_step_ord INT,
  p_org_id   INT
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step approval_chain_steps;
  v_inserted json;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = p_chain_id AND step_order = p_step_ord;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  WITH approvers AS (
    SELECT e.id AS emp_id, e.name AS emp_name
      FROM employees e
     WHERE e.status = '在職'
       AND (p_org_id IS NULL OR e.organization_id = p_org_id)
       AND public._employee_matches_chain_step(e.id, v_step.id)
  ), inserted AS (
    INSERT INTO task_confirmations (task_id, approver, status, step_order, organization_id)
    SELECT p_task_id, emp_name, 'pending', p_step_ord, p_org_id FROM approvers
    ON CONFLICT (task_id, approver) DO NOTHING
    RETURNING approver
  )
  SELECT COALESCE(json_agg(json_build_object(
           'emp_id', e.id,
           'name',   e.name,
           'line_user_id', (
             SELECT line_user_id FROM employee_line_accounts ela
              WHERE ela.employee_id = e.id
              ORDER BY ela.is_primary DESC NULLS LAST, ela.id
              LIMIT 1
           )
         )), '[]'::json)
    INTO v_inserted
    FROM approvers a
    JOIN employees e ON e.name = a.emp_name AND (p_org_id IS NULL OR e.organization_id = p_org_id);

  RETURN v_inserted;
END $$;


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

  IF v_approvers::jsonb = '[]'::jsonb AND has_pending THEN
    SELECT COALESCE(json_agg(json_build_object(
      'emp_id', e.id, 'name', e.name,
      'line_user_id', (
        SELECT line_user_id FROM employee_line_accounts ela
         WHERE ela.employee_id = e.id
         ORDER BY ela.is_primary DESC NULLS LAST, ela.id
         LIMIT 1
      )
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


CREATE OR REPLACE FUNCTION public.liff_get_task_next_approvers(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_max_step INT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT MAX(step_order) INTO v_max_step
    FROM task_confirmations WHERE task_id = p_task_id;

  IF v_max_step IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'emp_id', e.id, 'name', e.name,
      'line_user_id', (
        SELECT line_user_id FROM employee_line_accounts ela
         WHERE ela.employee_id = e.id
         ORDER BY ela.is_primary DESC NULLS LAST, ela.id
         LIMIT 1
      )
    ))
    FROM task_confirmations tc
    JOIN employees e ON e.name = tc.approver
   WHERE tc.task_id = p_task_id
     AND tc.step_order = v_max_step
     AND tc.status = 'pending'
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_complete_task_v2(text, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._create_task_confirmations_for_step(INT, INT, INT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.liff_get_task_next_approvers(text, int) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
