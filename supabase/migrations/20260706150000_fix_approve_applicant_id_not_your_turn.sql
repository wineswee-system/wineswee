-- 修：補打卡/出差/費用審核 NOT_YOUR_TURN（清單顯示得出、按下去卻說不是你這關）
-- 2026-07-06
-- 根因：liff_approve_request / web_advance_chain_request 抓申請單時，
--   leave/overtime 分支帶 employee_id，但 trip/correction/expense 分支寫死 NULL::INT 當申請人 id。
--   _employee_matches_snapshot_step 靠傳入的 applicant_emp_id 解申請人；收到 NULL →
--   applicant_supervisor 等動態主管類一律 false → NOT_YOUR_TURN（連正確主管都被擋）。
--   清單 liff_list_pending_approvals 傳的是正確 e_app.id，所以「顯示得出、卻簽不了」。
--   clock_corrections/business_trips/expenses 都有 employee_id → 改抓 employee_id。
-- 手法：dump live，只把該 SELECT 的 NULL::INT → employee_id，其餘不動。

-- ===== liff_approve_request =====
CREATE OR REPLACE FUNCTION public.liff_approve_request(p_line_user_id text, p_type text, p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp             employees;
  v_app_emp_id    INT;
  v_app_name      TEXT;
  v_app_org       INT;
  v_eligible      BOOLEAN;
  reject_val      text;
  approve_status  text;
  reject_status   text;
  result_status   text;
  v_chain_id      int;
  v_cur_step      int;
  v_step          approval_chain_steps;
  v_total_steps   int;
  v_is_last       boolean;
  v_table_name    text;
  v_er            record;
  v_next_step     approval_chain_steps;
  v_next_approver_ids INT[];
  v_next_approvers json;
  v_amount        NUMERIC;
  -- snapshot
  v_has_snapshot  BOOLEAN;
  v_snap_matches  BOOLEAN;
  v_snap_rt       TEXT;
  -- skip-if-no-approver
  v_effective_step INT;
  v_step_skipped   BOOLEAN;
  -- extra step
  v_pending_extra INT;
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
      EXECUTE format('SELECT approval_chain_id, current_step, organization_id, employee_id, employee, status FROM %I WHERE id=$1', v_table_name)
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

    approve_status := CASE p_type WHEN 'expense' THEN '已核銷' ELSE '已核准' END;
    reject_status  := '已退回';

    IF v_chain_id IS NOT NULL THEN
      -- snapshot 優先（leave / overtime / trip / correction）
      v_has_snapshot := FALSE;
      IF p_type IN ('leave','overtime','trip','correction') THEN
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
        END IF;
      END IF;

      IF NOT v_has_snapshot THEN
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
        RETURN json_build_object('ok', true, 'status', approve_status, 'event','approved', 'is_last_step', true,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      ELSE
        -- ── advance，自動跳過 auto_skipped 步 ──
        v_effective_step := v_cur_step + 1;

        IF v_snap_rt IS NOT NULL THEN
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
        END IF;

        -- 所有剩餘步驟都被跳過 → 直接核准
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
         WHERE e.status='在職' AND e.organization_id = v_app_org
           AND public._employee_matches_chain_step(e.id, v_next_step.id, v_app_emp_id);
        SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
          FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
        RETURN json_build_object('ok', true, 'status','簽核中', 'event','advanced',
          'advanced_to_step', v_effective_step, 'is_last_step', false,
          'next_approvers', COALESCE(v_next_approvers, '[]'::json),
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;
    END IF;

    -- 沒掛 chain → fallback 組織圖
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

  -- ════ expense_settle（核銷）走 settle_chain + snapshot ════
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

    SELECT id INTO v_pending_extra
      FROM public.approval_extra_steps
     WHERE source_table = 'expense_settles'
       AND source_id = p_id
       AND insert_before_step = v_er.settle_current_step
       AND status = 'pending'
     LIMIT 1;
    IF v_pending_extra IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_STEP', 'extra_step_id', v_pending_extra);
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = 'expense_settle' AND request_id = p_id
    ) INTO v_has_snapshot;

    IF v_has_snapshot THEN
      SELECT public._employee_matches_snapshot_step(
        emp.id, 'expense_settle', p_id, v_er.settle_current_step, v_er.employee_id
      ) INTO v_snap_matches;
      IF NOT v_snap_matches THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN',
          'source', 'snapshot', 'current_step', v_er.settle_current_step);
      END IF;
    ELSE
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_er.settle_chain_id AND step_order = v_er.settle_current_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
      END IF;
      IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_er.employee_id) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;
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
            json_build_object('account_code', v_er.account_code, 'account_name', v_er.account_name,
              'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_er.id),
            json_build_object('account_code', '1100', 'account_name', '現金',
              'debit', 0, 'credit', v_amount, 'memo', '')
          )::jsonb, '費用申請', v_er.id, emp.name
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
END $function$

;

-- ===== web_advance_chain_request =====
CREATE OR REPLACE FUNCTION public.web_advance_chain_request(p_type text, p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'SELECT approval_chain_id, current_step, organization_id, employee_id, employee, status FROM %I WHERE id=$1',
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
END $function$

;

