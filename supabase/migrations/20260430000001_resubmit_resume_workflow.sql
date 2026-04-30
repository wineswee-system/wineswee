-- ============================================================
-- Make liff_resubmit_request also re-arm the workflow:
--   1. Find the rejected workflow_instance for this request
--   2. Reset the rejected step's task back to '進行中'
--   3. Reset workflow_instance.status to '進行中'
-- DB trigger _task_enqueue_started_notify fires on the status
-- transition '已退回' → '進行中', so the rejecting approver
-- (whose task this was) gets a fresh LINE notification automatically.
--
-- Covers all 6 request types: leave / overtime / trip / correction
-- / expense / expense_request.
-- ============================================================

CREATE OR REPLACE FUNCTION public.liff_resubmit_request(
  p_line_user_id text,
  p_type         text,
  p_id           int,
  p_changes      jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n int;
  v_template_name text;
  v_instance_id   int;
  v_resumed_count int := 0;
BEGIN
  -- 1. Resolve employee
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 2. Type-specific UPDATE on the request table (existing behaviour preserved)
  IF p_type = 'leave' THEN
    UPDATE leave_requests
       SET status = '待審核', reject_reason = NULL,
           reason     = COALESCE(p_changes->>'reason', reason),
           start_date = COALESCE((p_changes->>'start_date')::date, start_date),
           end_date   = COALESCE((p_changes->>'end_date')::date, end_date),
           hours      = COALESCE((p_changes->>'hours')::numeric, hours)
     WHERE id = p_id AND status = '已退回'
       AND (employee_id = emp.id OR employee = emp.name)
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '請假簽核';

  ELSIF p_type = 'overtime' THEN
    UPDATE overtime_requests
       SET status = '待審核', reject_reason = NULL,
           reason = COALESCE(p_changes->>'reason', reason),
           date   = COALESCE((p_changes->>'date')::date, date),
           hours  = COALESCE((p_changes->>'hours')::numeric, hours)
     WHERE id = p_id AND status = '已退回'
       AND (employee_id = emp.id OR employee = emp.name)
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '加班簽核';

  ELSIF p_type = 'trip' THEN
    UPDATE business_trips SET status = '待審核', reject_reason = NULL
     WHERE id = p_id AND status = '已退回'
       AND employee = emp.name AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '出差申請簽核';

  ELSIF p_type = 'correction' THEN
    UPDATE clock_corrections SET status = '待審核', reject_reason = NULL
     WHERE id = p_id AND status = '已退回' AND employee = emp.name;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := NULL;  -- correction does not run a workflow

  ELSIF p_type = 'expense' THEN
    UPDATE expenses SET status = '待審核', reject_reason = NULL
     WHERE id = p_id AND status = '已退回' AND employee = emp.name;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '費用報帳簽核';

  ELSIF p_type = 'expense_request' THEN
    UPDATE expense_requests
       SET status = '申請中', reject_reason = NULL
     WHERE id = p_id AND status = '已退回'
       AND employee = emp.name AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '費用申請簽核';

  ELSE
    RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
  END IF;

  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_REJECTED');
  END IF;

  -- 3. Re-arm the workflow (skip when no template, e.g. correction)
  IF v_template_name IS NOT NULL THEN
    -- Resolve workflow_instance: prefer FK on expense_request,
    -- fall back to template + applicant match for the others.
    IF p_type = 'expense_request' THEN
      SELECT workflow_instance_id INTO v_instance_id
        FROM expense_requests WHERE id = p_id;
    ELSE
      SELECT id INTO v_instance_id
        FROM workflow_instances
       WHERE template_name = v_template_name
         AND organization_id = emp.organization_id
         AND (started_by_id = emp.id OR started_by = emp.name)
       ORDER BY started_at DESC
       LIMIT 1;
    END IF;

    IF v_instance_id IS NOT NULL THEN
      -- Bump the rejected step back to 進行中. Trigger fires LINE push.
      UPDATE tasks
         SET status = '進行中',
             confirmed = false,
             confirmed_by = NULL,
             confirmed_at = NULL,
             notes = NULL,
             completed_at = NULL
       WHERE workflow_instance_id = v_instance_id
         AND status = '已退回';
      GET DIAGNOSTICS v_resumed_count = ROW_COUNT;

      -- Reset workflow_instance status (covers both web reject path
      -- which sets '已退回' and LIFF reject path which leaves it alone).
      UPDATE workflow_instances
         SET status = '進行中',
             completed_at = NULL
       WHERE id = v_instance_id
         AND status IN ('已退回', '進行中');
    END IF;
  END IF;

  RETURN json_build_object(
    'ok',            true,
    'instance_id',   v_instance_id,
    'resumed_tasks', v_resumed_count
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_resubmit_request(text, text, int, jsonb) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
