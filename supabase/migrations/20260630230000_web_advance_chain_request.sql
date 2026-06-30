-- web_advance_chain_request: web dashboard chain-aware approval
-- Mirrors liff_approve_request HR-A logic but resolves employee by auth.uid()
-- instead of LINE user ID. Handles: leave, overtime, trip, correction.
-- Side effects (attendance write, event publish) remain in the frontend.

CREATE OR REPLACE FUNCTION public.web_advance_chain_request(
  p_type   TEXT,
  p_id     INT,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp                  employees;
  v_app_emp_id         INT;
  v_app_name           TEXT;
  v_app_org            INT;
  v_eligible           BOOLEAN;
  reject_val           TEXT;
  approve_status       TEXT;
  reject_status        TEXT;
  result_status        TEXT;
  v_chain_id           INT;
  v_cur_step           INT;
  v_step               approval_chain_steps;
  v_total_steps        INT;
  v_is_last            BOOLEAN;
  v_table_name         TEXT;
  v_next_step          approval_chain_steps;
  v_next_approver_ids  INT[];
  v_next_approvers     JSON;
  v_has_snapshot       BOOLEAN;
  v_snap_matches       BOOLEAN;
  v_snap_rt            TEXT;
  v_effective_step     INT;
  v_step_skipped       BOOLEAN;
BEGIN
  SELECT * INTO emp FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  IF p_type NOT IN ('leave', 'overtime', 'trip', 'correction') THEN
    RETURN json_build_object('ok', false, 'error', 'UNSUPPORTED_TYPE');
  END IF;

  reject_val     := COALESCE(p_reason, '');
  approve_status := '已核准';
  reject_status  := CASE p_type WHEN 'correction' THEN '已駁回' ELSE '已退回' END;

  v_table_name := CASE p_type
    WHEN 'leave'      THEN 'leave_requests'
    WHEN 'overtime'   THEN 'overtime_requests'
    WHEN 'trip'       THEN 'business_trips'
    WHEN 'correction' THEN 'clock_corrections'
  END;

  IF p_type IN ('leave', 'overtime') THEN
    EXECUTE format(
      'SELECT approval_chain_id, current_step, organization_id, employee_id, employee, status FROM %I WHERE id=$1',
      v_table_name
    ) INTO v_chain_id, v_cur_step, v_app_org, v_app_emp_id, v_app_name, result_status USING p_id;
  ELSE
    EXECUTE format(
      'SELECT approval_chain_id, current_step, organization_id, NULL::INT, employee, status FROM %I WHERE id=$1',
      v_table_name
    ) INTO v_chain_id, v_cur_step, v_app_org, v_app_emp_id, v_app_name, result_status USING p_id;
  END IF;

  IF v_app_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF result_status NOT IN ('申請中', '待審', '待審核') THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;
  IF v_app_org IS NOT NULL AND v_app_org <> emp.organization_id THEN
    RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
  END IF;

  -- ── 有掛 chain ──
  IF v_chain_id IS NOT NULL THEN
    v_snap_rt := CASE p_type
      WHEN 'leave'      THEN 'leave_request'
      WHEN 'overtime'   THEN 'overtime_request'
      WHEN 'trip'       THEN 'trip'
      WHEN 'correction' THEN 'correction'
    END;

    SELECT EXISTS(
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = v_snap_rt AND request_id = p_id
    ) INTO v_has_snapshot;

    IF v_has_snapshot THEN
      SELECT public._employee_matches_snapshot_step(
        emp.id, v_snap_rt, p_id, v_cur_step, v_app_emp_id
      ) INTO v_snap_matches;
      IF NOT v_snap_matches THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN',
          'source', 'snapshot', 'current_step', v_cur_step);
      END IF;
    ELSE
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_cur_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
      END IF;
      IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_app_emp_id) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
    v_is_last := (v_cur_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approved_by=$3 WHERE id=$4', v_table_name)
        USING reject_status, reject_val, emp.name, p_id;
      RETURN json_build_object('ok', true, 'status', reject_status, 'event', 'rejected',
        'rejected_at_step', v_cur_step,
        'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
    END IF;

    IF v_is_last THEN
      EXECUTE format('UPDATE %I SET status=$1, approved_by=$2 WHERE id=$3', v_table_name)
        USING approve_status, emp.name, p_id;
      RETURN json_build_object('ok', true, 'status', approve_status, 'event', 'approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
    END IF;

    -- advance：跳過 auto_skipped 步
    v_effective_step := v_cur_step + 1;
    LOOP
      EXIT WHEN v_effective_step >= v_total_steps;
      SELECT COALESCE(rcs.auto_skipped, false) INTO v_step_skipped
        FROM public.request_chain_snapshots rcs
       WHERE rcs.request_type = v_snap_rt
         AND rcs.request_id   = p_id
         AND rcs.step_order   = v_effective_step;
      EXIT WHEN NOT COALESCE(v_step_skipped, false);
      v_effective_step := v_effective_step + 1;
    END LOOP;

    IF v_effective_step >= v_total_steps THEN
      EXECUTE format('UPDATE %I SET status=$1, current_step=$2, approved_by=$3 WHERE id=$4', v_table_name)
        USING approve_status, v_effective_step, emp.name, p_id;
      RETURN json_build_object('ok', true, 'status', approve_status, 'event', 'approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
    END IF;

    EXECUTE format('UPDATE %I SET current_step=$1 WHERE id=$2', v_table_name) USING v_effective_step, p_id;
    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_effective_step;
    SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
     WHERE e.status = '在職' AND e.organization_id = v_app_org
       AND public._employee_matches_chain_step(e.id, v_next_step.id, v_app_emp_id);
    SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
      FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
    RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_effective_step, 'is_last_step', false,
      'next_approvers', COALESCE(v_next_approvers, '[]'::json),
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
  END IF;

  -- ── 沒掛 chain：組織圖 fallback ──
  SELECT public._employee_is_eligible_approver(emp.id, v_app_emp_id, v_app_org) INTO v_eligible;
  IF NOT v_eligible THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;
  IF p_action = 'reject' THEN
    EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approved_by=$3 WHERE id=$4', v_table_name)
      USING reject_status, reject_val, emp.name, p_id;
    RETURN json_build_object('ok', true, 'status', reject_status, 'event', 'rejected',
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
  ELSE
    EXECUTE format('UPDATE %I SET status=$1, approved_by=$2 WHERE id=$3', v_table_name)
      USING approve_status, emp.name, p_id;
    RETURN json_build_object('ok', true, 'status', approve_status, 'event', 'approved',
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.web_advance_chain_request(TEXT, INT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
