-- 修：之前 line_user_id 用 employee_line_accounts.is_primary 取
-- 但「primary」可能是舊綁的官方 OA → 通知會跑到舊 channel
-- 改為優先 line_channels.is_default = true 的 channel
-- 並同時回傳 channel_code 給 client 推 LINE 時帶上

-- helper：拿員工在「預設 channel」的 line_user_id + channel_code
CREATE OR REPLACE FUNCTION public._employee_line_target(p_emp_id INT)
RETURNS TABLE(line_user_id TEXT, channel_code TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ela.line_user_id, lc.code
    FROM employee_line_accounts ela
    JOIN line_channels lc ON lc.id = ela.channel_id
   WHERE ela.employee_id = p_emp_id
     AND lc.status = 'active'
   ORDER BY lc.is_default DESC NULLS LAST,
            ela.is_primary DESC NULLS LAST,
            ela.id
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public._employee_line_target(INT) TO anon, authenticated, service_role;


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
           'emp_id',       e.id,
           'name',         e.name,
           'line_user_id', t.line_user_id,
           'channel_code', t.channel_code
         )), '[]'::json)
    INTO v_inserted
    FROM approvers a
    JOIN employees e ON e.name = a.emp_name AND (p_org_id IS NULL OR e.organization_id = p_org_id)
    LEFT JOIN LATERAL public._employee_line_target(e.id) t ON true;

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
      'line_user_id', t.line_user_id,
      'channel_code', t.channel_code
    )), '[]'::json) INTO v_approvers
      FROM task_confirmations tc
      JOIN employees e ON e.name = tc.approver
        AND (e.organization_id = task_row.organization_id OR task_row.organization_id IS NULL)
      LEFT JOIN LATERAL public._employee_line_target(e.id) t ON true
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
      'line_user_id', t.line_user_id,
      'channel_code', t.channel_code
    ))
    FROM task_confirmations tc
    JOIN employees e ON e.name = tc.approver
    LEFT JOIN LATERAL public._employee_line_target(e.id) t ON true
   WHERE tc.task_id = p_task_id
     AND tc.step_order = v_max_step
     AND tc.status = 'pending'
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_complete_task_v2(text, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.liff_get_task_next_approvers(text, int) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
