-- ════════════════════════════════════════════════════════════════════════════
-- 加簽功能 P3f — RPC pending extra guard
--
-- 為其他 chain 的 approve RPC 加 guard：有 pending 加簽時禁止推進
--
-- 涵蓋：
--   1. liff_approve_request（HR 5 + expense_request）
--      - leave / overtime / trip / correction / expense → source_table 對應
--      - expense_request
--   2. hr_chain_approve（HR 異動 3：resignation / loa / transfer）
--
-- 不涵蓋：
--   - expense_settle（核銷 settle_chain 加簽未設計）
--   - task chain 相關 RPC（task_chain 加簽未實作）
--
-- 對齊 expense_request_step_advance 已加的 guard pattern（P2 migration）
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. liff_approve_request — 加 guard 給 HR 5 + expense_request 兩個分支
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.liff_approve_request(
  p_line_user_id text,
  p_type         text,
  p_id           int,
  p_action       text,
  p_reason       text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_app_emp_id  INT;
  v_app_name    TEXT;
  v_app_org     INT;
  v_eligible    BOOLEAN;
  reject_val    text;
  approve_status text;
  reject_status  text;
  result_status  text;
  v_chain_id    int;
  v_cur_step    int;
  v_step        approval_chain_steps;
  v_total_steps int;
  v_is_last     boolean;
  v_table_name  text;
  v_er          record;
  v_next_step   approval_chain_steps;
  v_next_approver_ids INT[];
  v_next_approvers JSON;
  v_amount      NUMERIC;
  v_extra       approval_extra_steps;  -- ★ P3f: 加簽 guard 用
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  reject_val := COALESCE(p_reason, '');

  -- ════ HR A 類 + expense（單表 chain） ════
  IF p_type IN ('leave','overtime','trip','correction','expense') THEN
    v_table_name := CASE p_type
      WHEN 'leave'      THEN 'leave_requests'
      WHEN 'overtime'   THEN 'overtime_requests'
      WHEN 'trip'       THEN 'business_trips'
      WHEN 'correction' THEN 'clock_corrections'
      WHEN 'expense'    THEN 'expenses'
    END;

    IF p_type IN ('leave','overtime') THEN
      EXECUTE format('SELECT approval_chain_id, current_step, organization_id, employee_id, employee, status FROM %I WHERE id=$1', v_table_name)
        INTO v_chain_id, v_cur_step, v_app_org, v_app_emp_id, v_app_name, result_status USING p_id;
    ELSE
      EXECUTE format('SELECT approval_chain_id, current_step, organization_id, NULL::INT, employee, status FROM %I WHERE id=$1', v_table_name)
        INTO v_chain_id, v_cur_step, v_app_org, v_app_emp_id, v_app_name, result_status USING p_id;
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

    -- ★ P3f 加簽 guard：當前 step 若有 pending 加簽，禁止推進
    v_extra := public.get_pending_extra_step(v_table_name, p_id, COALESCE(v_cur_step, 0));
    IF v_extra.id IS NOT NULL THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'PENDING_EXTRA_SIGNER',
        'extra_step_id', v_extra.id,
        'extra_assignee_id', v_extra.assignee_id,
        'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
      );
    END IF;

    approve_status := CASE p_type WHEN 'expense' THEN '已核銷' ELSE '已核准' END;
    reject_status  := '已退回';

    IF v_chain_id IS NOT NULL THEN
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_cur_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
      END IF;
      IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_app_emp_id) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;

      SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
      v_is_last := (v_cur_step + 1 >= v_total_steps);

      IF p_action = 'reject' THEN
        EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approved_by=$3 WHERE id=$4', v_table_name)
          USING reject_status, reject_val, emp.name, p_id;
        IF p_type = 'correction' THEN
          EXECUTE format('UPDATE %I SET status=$1 WHERE id=$2', v_table_name) USING '已駁回', p_id;
        END IF;
        RETURN json_build_object('ok', true, 'status', reject_status, 'event','rejected',
          'rejected_at_step', v_cur_step,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;

      IF v_is_last THEN
        EXECUTE format('UPDATE %I SET status=$1, approved_by=$2 WHERE id=$3', v_table_name)
          USING approve_status, emp.name, p_id;
        IF p_type = 'correction' AND p_action = 'approve' THEN
          NULL;
        END IF;
        RETURN json_build_object('ok', true, 'status', approve_status, 'event','approved', 'is_last_step', true,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      ELSE
        EXECUTE format('UPDATE %I SET current_step=current_step+1 WHERE id=$1', v_table_name) USING p_id;
        SELECT * INTO v_next_step FROM approval_chain_steps
         WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;
        SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
         WHERE e.status='在職' AND e.organization_id = v_app_org
           AND public._employee_matches_chain_step(e.id, v_next_step.id, v_app_emp_id);
        SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
          FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
        RETURN json_build_object('ok', true, 'status','簽核中', 'event','advanced',
          'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
          'next_approvers', COALESCE(v_next_approvers, '[]'::json),
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;
    END IF;

    -- 沒掛 chain → fallback 組織圖（保留原本邏輯）
    SELECT public._employee_is_eligible_approver(emp.id, v_app_emp_id, v_app_org)
      INTO v_eligible;
    IF NOT v_eligible THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;
    IF p_action = 'reject' THEN
      EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approved_by=$3 WHERE id=$4', v_table_name)
        USING reject_status, reject_val, emp.name, p_id;
      RETURN json_build_object('ok', true, 'status', reject_status, 'event','rejected',
        'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
    ELSE
      EXECUTE format('UPDATE %I SET status=$1, approved_by=$2 WHERE id=$3', v_table_name)
        USING approve_status, emp.name, p_id;
      RETURN json_build_object('ok', true, 'status', approve_status, 'event','approved',
        'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
    END IF;
  END IF;

  -- ════ expense_request 走 chain ════
  IF p_type = 'expense_request' THEN
    SELECT * INTO v_er FROM expense_requests WHERE id = p_id;
    IF v_er.id IS NULL OR v_er.status <> '申請中' THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.organization_id IS NOT NULL AND v_er.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;
    IF v_er.approval_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;

    -- ★ P3f 加簽 guard
    v_extra := public.get_pending_extra_step('expense_requests', p_id, COALESCE(v_er.current_step, 0));
    IF v_extra.id IS NOT NULL THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'PENDING_EXTRA_SIGNER',
        'extra_step_id', v_extra.id,
        'extra_assignee_id', v_extra.assignee_id,
        'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
      );
    END IF;

    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step;
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
    END IF;
    IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_er.employee_id) THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_er.approval_chain_id;
    v_is_last := (v_er.current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      UPDATE expense_requests SET status='已退回', reject_reason=reject_val, approved_by=emp.name WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已退回', 'event','rejected',
        'rejected_at_step', v_er.current_step,
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    END IF;

    IF v_is_last THEN
      UPDATE expense_requests SET status='已核准', approved_by=emp.name, approved_at=NOW() WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已核准', 'event','approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    ELSE
      UPDATE expense_requests SET current_step=current_step+1 WHERE id=p_id;
      SELECT * INTO v_next_step FROM approval_chain_steps
       WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step + 1;
      SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
       WHERE e.status='在職' AND e.organization_id = v_er.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_er.employee_id);
      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
        FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
      RETURN json_build_object('ok', true, 'status','簽核中', 'event','advanced',
        'advanced_to_step', v_er.current_step + 1, 'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    END IF;
  END IF;

  -- ════ expense_settle（核銷）走 settle_chain — 不加 guard，settle chain 加簽未設計 ════
  IF p_type = 'expense_settle' THEN
    SELECT * INTO v_er FROM expense_requests WHERE id = p_id;
    IF v_er.id IS NULL OR v_er.status <> '待核銷' THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.organization_id IS NOT NULL AND v_er.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;
    IF v_er.settle_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;

    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_er.settle_chain_id AND step_order = v_er.settle_current_step;
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
    END IF;
    IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_er.employee_id) THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_er.settle_chain_id;
    v_is_last := (v_er.settle_current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      UPDATE expense_requests SET status='核銷已退回', settle_reject_reason=reject_val WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','核銷已退回', 'event','rejected',
        'rejected_at_step', v_er.settle_current_step,
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    END IF;

    IF v_is_last THEN
      v_amount := COALESCE(v_er.actual_amount, v_er.estimated_amount, 0);
      BEGIN
        PERFORM secure_create_journal_entry(
          CURRENT_DATE,
          '費用申請核銷 - ' || v_er.employee || ' (' || v_er.title || ')',
          json_build_array(
            json_build_object('account_code', v_er.account_code, 'account_name', v_er.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_er.id),
            json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
          )::jsonb,
          '費用申請',
          v_er.id,
          emp.name
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      UPDATE expense_requests SET
        status='已核銷',
        settle_current_step = v_total_steps,
        settled_by = emp.name,
        settled_at = NOW()
      WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已核銷', 'event','approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    ELSE
      UPDATE expense_requests SET settle_current_step = settle_current_step + 1 WHERE id=p_id;
      SELECT * INTO v_next_step FROM approval_chain_steps
       WHERE chain_id = v_er.settle_chain_id AND step_order = v_er.settle_current_step + 1;
      SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
       WHERE e.status='在職' AND e.organization_id = v_er.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_er.employee_id);
      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
        FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
      RETURN json_build_object('ok', true, 'status','核銷中', 'event','advanced',
        'advanced_to_step', v_er.settle_current_step + 1, 'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    END IF;
  END IF;

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END
$$;

GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. hr_chain_approve — 加 guard 給 HR 異動 3 表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.hr_chain_approve(
  p_table        text,
  p_id           int,
  p_approver_id  int,
  p_action       text,
  p_reason       text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table_name  text;
  v_record      record;
  v_chain_id    int;
  v_cur_step    int;
  v_total_steps int;
  v_step        record;
  v_is_last     boolean;
  v_next_step   record;
  v_next_ids    int[];
  v_next_json   json;
  v_extra       approval_extra_steps;  -- ★ P3f: 加簽 guard
BEGIN
  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TABLE');
  END IF;
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  EXECUTE format('SELECT id, approval_chain_id, current_step, status, employee_id, organization_id FROM %I WHERE id = $1', v_table_name)
    INTO v_record USING p_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  v_chain_id := v_record.approval_chain_id;
  v_cur_step := v_record.current_step;

  -- ★ P3f 加簽 guard：當前 step 若有 pending 加簽，禁止推進
  v_extra := public.get_pending_extra_step(v_table_name, p_id, COALESCE(v_cur_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
        USING '已核准', p_approver_id, p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW(), reject_reason=$3 WHERE id=$4', v_table_name)
        USING '已駁回', p_approver_id, btrim(p_reason), p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = v_cur_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  IF NOT public._employee_matches_chain_step(p_approver_id, v_step.id, v_record.employee_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
  v_is_last := (v_cur_step + 1 >= v_total_steps);

  IF p_action = 'reject' THEN
    EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approver_id=$3 WHERE id=$4', v_table_name)
      USING '已駁回', btrim(p_reason), p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected', 'rejected_at_step', v_cur_step);
  END IF;

  IF v_is_last THEN
    EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
      USING '已核准', p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    EXECUTE format('UPDATE %I SET current_step=current_step+1 WHERE id=$1', v_table_name) USING p_id;
    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;
    SELECT array_agg(e.id) INTO v_next_ids FROM employees e
     WHERE e.status='在職' AND e.organization_id = v_record.organization_id
       AND public._employee_matches_chain_step(e.id, v_next_step.id, v_record.employee_id);
    SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_json
      FROM employees WHERE id = ANY(COALESCE(v_next_ids, ARRAY[]::INT[]));
    RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
      'next_approvers', COALESCE(v_next_json, '[]'::json));
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.hr_chain_approve(text, int, int, text, text) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
