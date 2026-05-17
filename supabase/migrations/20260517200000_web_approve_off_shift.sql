-- ════════════════════════════════════════════════════════════════════════════
-- Web wrappers for off_request + shift_swap approval
--
-- LIFF 已有 liff_approve_off_request / liff_respond_shift_swap_peer /
-- liff_approve_shift_swap_manager。Web 需要對應的不依賴 line_user_id 的版本，
-- 用 auth.uid() 解 employee。
--
-- 邏輯完全複製 LIFF 版本（包含換班的 schedule swap），確保兩邊行為一致。
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. web_approve_off_request ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.web_approve_off_request(
  p_id     int,
  p_action text,         -- 'approve' / 'reject'
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  emp        employees;
  v_req      record;
  v_eligible boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_req FROM off_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_req.status <> '待審核' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;
  IF v_req.organization_id IS DISTINCT FROM emp.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORG_MISMATCH');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM _resolve_hr_approver_ids(v_req.employee_id)
    WHERE _resolve_hr_approver_ids = emp.id
  ) INTO v_eligible;
  IF NOT v_eligible THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  IF p_action = 'approve' THEN
    UPDATE off_requests SET
      status = '已核准',
      approver_id = emp.id,
      approver_name = emp.name,
      approved_at = NOW(),
      reject_reason = NULL
    WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'event', 'approved');

  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
    END IF;
    UPDATE off_requests SET
      status = '已駁回',
      approver_id = emp.id,
      approver_name = emp.name,
      approved_at = NOW(),
      reject_reason = btrim(p_reason)
    WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'event', 'rejected');
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.web_approve_off_request(int, text, text) TO authenticated;

-- ─── 2. web_respond_shift_swap_peer（換班對方同意/拒絕）─────────────────────
CREATE OR REPLACE FUNCTION public.web_respond_shift_swap_peer(
  p_swap_id int,
  p_action  text,        -- 'agree' / 'reject'
  p_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  emp    employees;
  v_swap record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_swap FROM shift_swaps WHERE id = p_swap_id;
  IF v_swap.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_swap.target_id IS DISTINCT FROM emp.id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;
  IF v_swap.status <> '待對方同意' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  IF p_action = 'agree' THEN
    UPDATE shift_swaps SET
      status = '待主管核准',
      peer_response = '同意',
      peer_responded_at = NOW()
    WHERE id = p_swap_id;
    RETURN jsonb_build_object('ok', true, 'event', 'agreed');

  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
    END IF;
    UPDATE shift_swaps SET
      status = '已拒絕',
      peer_response = '拒絕',
      peer_responded_at = NOW(),
      peer_reject_reason = btrim(p_reason)
    WHERE id = p_swap_id;
    RETURN jsonb_build_object('ok', true, 'event', 'rejected');
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.web_respond_shift_swap_peer(int, text, text) TO authenticated;

-- ─── 3. web_approve_shift_swap_manager（含實際 schedules 交換）──────────────
CREATE OR REPLACE FUNCTION public.web_approve_shift_swap_manager(
  p_swap_id int,
  p_action  text,        -- 'approve' / 'reject'
  p_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  emp       employees;
  v_swap    record;
  v_a_sched record;
  v_b_sched record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_swap FROM shift_swaps WHERE id = p_swap_id;
  IF v_swap.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_swap.status <> '待主管核准' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AT_MANAGER_STAGE');
  END IF;

  -- 店長 OR schedule.approve perm
  IF NOT (
    EXISTS (SELECT 1 FROM stores WHERE id = v_swap.store_id AND manager_id = emp.id)
    OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  IF p_action = 'approve' THEN
    -- 抓 A / B 當天的 schedules
    SELECT shift, actual_start, actual_end, actual_hours INTO v_a_sched
      FROM schedules
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.requester_id OR employee = v_swap.requester)
     LIMIT 1;
    SELECT shift, actual_start, actual_end, actual_hours INTO v_b_sched
      FROM schedules
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.target_id OR employee = v_swap.target)
     LIMIT 1;

    IF v_a_sched.shift IS NULL OR v_b_sched.shift IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SCHEDULE_MISSING');
    END IF;

    UPDATE schedules SET
      shift = v_b_sched.shift,
      actual_start = v_b_sched.actual_start,
      actual_end = v_b_sched.actual_end,
      actual_hours = v_b_sched.actual_hours
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.requester_id OR employee = v_swap.requester);

    UPDATE schedules SET
      shift = v_a_sched.shift,
      actual_start = v_a_sched.actual_start,
      actual_end = v_a_sched.actual_end,
      actual_hours = v_a_sched.actual_hours
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.target_id OR employee = v_swap.target);

    UPDATE shift_swaps SET
      status = '已核准',
      approver_id = emp.id,
      approver_name = emp.name,
      approved_at = NOW()
    WHERE id = p_swap_id;

    RETURN jsonb_build_object('ok', true, 'event', 'approved');

  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
    END IF;
    UPDATE shift_swaps SET
      status = '已駁回',
      approver_id = emp.id,
      approver_name = emp.name,
      approved_at = NOW(),
      reject_reason = btrim(p_reason)
    WHERE id = p_swap_id;
    RETURN jsonb_build_object('ok', true, 'event', 'rejected');
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.web_approve_shift_swap_manager(int, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
