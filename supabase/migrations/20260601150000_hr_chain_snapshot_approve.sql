-- ════════════════════════════════════════════════════════════════════════════
-- HR 8 表 chain snapshot 化 — Backend RPC + Guard
-- 2026-06-01
--
-- 接續 form_submission 切快照（20260601130000 / 20260601140000），把 HR 全套切完。
--
-- 這個 migration 處理：
--   1. liff_approve_request — HR A (leave/overtime/trip/correction) chain 分支
--      加 snapshot 優先；expense_request 分支保留 20260528200000 已切的快照邏輯；
--      expense（HR 報帳）保留 live（該表沒 snapshot trigger）
--   2. hr_chain_approve — HR B (resignation/loa/transfer/headcount) 加 snapshot 優先
--   3. _guard_chain_steps_in_flight — 全 8 表 + expense_requests + form_submissions
--      都改成「有快照就放行」
--
-- 不在這個 migration 處理（另一個 migration 接手）：
--   - HR A/B 的 LINE notify trigger function（_notify_*）改快照優先
--
-- 鐵則對齊：
--   - feedback_migration_partial_overwrite_disaster — 以 20260512100000 為 base 推 HR A
--     chain 邏輯（20260528200000 的 partial overwrite 已驗證會洗掉 chain branch）
--   - feedback_trigger_security_invoker_rls — guard 已是 SECURITY DEFINER
--   - feedback_signoff_must_use_db_trigger — chain 推進仍在 RPC / trigger 完成
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. liff_approve_request — 重推 chain-aware 完整版 + HR A snapshot 優先
--
--    Base：20260512100000_relock 的 chain-aware 完整版
--    HR A chain 分支（有 chain）：snapshot 優先，沒快照 fallback live
--    HR A fallback（無 chain）：保留組織圖 _resolve_hr_approver_ids 模式
--    expense_request 分支：保留 20260528200000 的 snapshot 邏輯
-- ══════════════════════════════════════════════════════════════════════════
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
  emp                 employees;
  v_app_emp_id        INT;
  v_app_name          TEXT;
  v_app_org           INT;
  v_eligible          BOOLEAN;
  reject_val          TEXT;
  approve_status      TEXT;
  reject_status       TEXT;
  result_status       TEXT;
  v_chain_id          INT;
  v_cur_step          INT;
  v_step              approval_chain_steps;
  v_total_steps       INT;
  v_is_last           BOOLEAN;
  v_table_name        TEXT;
  v_er                RECORD;
  v_next_step         approval_chain_steps;
  v_next_approver_ids INT[];
  v_next_approvers    JSON;
  v_has_snapshot      BOOLEAN;
  v_snap_request_type TEXT;  -- HR A 對應的 request_chain_snapshots.request_type
  v_matches           BOOLEAN;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  reject_val := CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END;

  -- ════════════════════════════════════════════════════════════════════════
  -- HR A 類（leave/overtime/trip/correction/expense）
  -- ════════════════════════════════════════════════════════════════════════
  IF p_type IN ('leave','overtime','trip','correction','expense') THEN
    v_table_name := CASE p_type
      WHEN 'leave'      THEN 'leave_requests'
      WHEN 'overtime'   THEN 'overtime_requests'
      WHEN 'trip'       THEN 'business_trips'
      WHEN 'correction' THEN 'clock_corrections'
      WHEN 'expense'    THEN 'expenses'
    END;

    -- snapshot request_type 對應（expense 沒對應，會走 NULL → 一律 live）
    v_snap_request_type := CASE p_type
      WHEN 'leave'      THEN 'leave_request'
      WHEN 'overtime'   THEN 'overtime_request'
      WHEN 'trip'       THEN 'trip'
      WHEN 'correction' THEN 'correction'
      ELSE NULL
    END;

    -- 讀 row：leave/overtime 有 employee_id；其他用 employee text 查
    IF p_type IN ('leave','overtime') THEN
      EXECUTE format(
        'SELECT employee_id, employee, organization_id, approval_chain_id, current_step '
        'FROM %I WHERE id = $1 AND status = ''待審核''', v_table_name
      ) INTO v_app_emp_id, v_app_name, v_app_org, v_chain_id, v_cur_step USING p_id;
    ELSE
      EXECUTE format(
        'SELECT NULL::INT, employee, organization_id, approval_chain_id, current_step '
        'FROM %I WHERE id = $1 AND status = ''待審核''', v_table_name
      ) INTO v_app_emp_id, v_app_name, v_app_org, v_chain_id, v_cur_step USING p_id;
    END IF;

    IF v_app_name IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;

    IF v_app_emp_id IS NULL THEN
      SELECT id INTO v_app_emp_id FROM employees
       WHERE name = v_app_name AND organization_id = COALESCE(v_app_org, emp.organization_id)
       LIMIT 1;
    END IF;
    IF v_app_emp_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'APPLICANT_NOT_FOUND');
    END IF;

    IF v_app_org IS NOT NULL AND v_app_org <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;

    approve_status := CASE p_type WHEN 'expense' THEN '已核銷' ELSE '已核准' END;
    reject_status  := '已退回';

    -- ────────────────────────────────────────────────────────────────────
    -- HR A 有 chain → 走 chain step（snapshot 優先）
    -- ────────────────────────────────────────────────────────────────────
    IF v_chain_id IS NOT NULL THEN

      -- 判斷有沒有 snapshot
      IF v_snap_request_type IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.request_chain_snapshots
           WHERE request_type = v_snap_request_type AND request_id = p_id
        ) INTO v_has_snapshot;
      ELSE
        v_has_snapshot := FALSE;  -- expense 沒 snapshot trigger
      END IF;

      -- ── 比對當前關 approver ──
      IF v_has_snapshot THEN
        -- 用快照算
        IF NOT EXISTS (
          SELECT 1 FROM public.request_chain_snapshots
           WHERE request_type = v_snap_request_type AND request_id = p_id
             AND step_order = v_cur_step
        ) THEN
          RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND',
            'source', 'snapshot', 'current_step', v_cur_step);
        END IF;

        SELECT public._employee_matches_snapshot_step(
          emp.id, v_snap_request_type, p_id, v_cur_step, v_app_emp_id
        ) INTO v_matches;

        SELECT COUNT(*) INTO v_total_steps
          FROM public.request_chain_snapshots
         WHERE request_type = v_snap_request_type AND request_id = p_id;
      ELSE
        -- live chain（舊單 / expense）
        SELECT * INTO v_step FROM approval_chain_steps
         WHERE chain_id = v_chain_id AND step_order = v_cur_step;
        IF v_step.id IS NULL THEN
          RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND',
            'source', 'live_chain', 'current_step', v_cur_step);
        END IF;

        SELECT public._employee_matches_chain_step(emp.id, v_step.id, v_app_emp_id)
          INTO v_matches;

        SELECT COUNT(*) INTO v_total_steps
          FROM approval_chain_steps WHERE chain_id = v_chain_id;
      END IF;

      IF NOT v_matches THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;

      v_is_last := (v_cur_step + 1 >= v_total_steps);

      -- reject
      IF p_action = 'reject' THEN
        EXECUTE format('UPDATE %I SET status=$1, approver=$2, reject_reason=$3 WHERE id=$4', v_table_name)
          USING reject_status, emp.name, reject_val, p_id;
        RETURN json_build_object('ok', true, 'status', reject_status, 'event', 'rejected',
          'rejected_at_step', v_cur_step,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;

      -- approve last step
      IF v_is_last THEN
        EXECUTE format('UPDATE %I SET status=$1, approver=$2, current_step=$3 WHERE id=$4', v_table_name)
          USING approve_status, emp.name, v_total_steps, p_id;

        -- 補打卡：核准時寫 attendance_records
        IF p_type = 'correction' THEN
          DECLARE c record; new_in time; new_out time; existing record;
          BEGIN
            SELECT * INTO c FROM clock_corrections WHERE id = p_id;
            IF c.correction_time IS NOT NULL THEN
              new_in  := CASE WHEN c.type = '上班打卡' THEN c.correction_time END;
              new_out := CASE WHEN c.type = '下班打卡' THEN c.correction_time END;
              SELECT * INTO existing FROM attendance_records WHERE employee = c.employee AND date = c.date LIMIT 1;
              IF FOUND THEN
                UPDATE attendance_records SET clock_in = COALESCE(new_in, clock_in), clock_out = COALESCE(new_out, clock_out) WHERE id = existing.id;
              ELSE
                INSERT INTO attendance_records (employee, date, clock_in, clock_out, status) VALUES (c.employee, c.date, new_in, new_out, '補登');
              END IF;
            END IF;
          END;
        END IF;

        RETURN json_build_object('ok', true, 'status', approve_status, 'event', 'approved', 'is_last_step', true,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));

      -- approve advance
      ELSE
        EXECUTE format('UPDATE %I SET current_step = current_step + 1 WHERE id=$1', v_table_name) USING p_id;

        -- 解下關 approver（snapshot 優先）
        IF v_has_snapshot THEN
          SELECT json_agg(json_build_object('emp_id', a.emp_id, 'name', a.emp_name))
            INTO v_next_approvers
            FROM public.resolve_snapshot_step_approvers(
              v_snap_request_type, p_id, v_cur_step + 1, v_app_emp_id
            ) a;
        ELSE
          SELECT * INTO v_next_step FROM approval_chain_steps
           WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;
          SELECT array_agg(e.id) INTO v_next_approver_ids
            FROM employees e
           WHERE e.status = '在職'
             AND e.organization_id = emp.organization_id
             AND public._employee_matches_chain_step(e.id, v_next_step.id, v_app_emp_id);
          SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
            FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
        END IF;

        RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
          'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
          'next_approvers', COALESCE(v_next_approvers, '[]'::json),
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;
    END IF;

    -- ────────────────────────────────────────────────────────────────────
    -- HR A 沒 chain → 組織圖 fallback（向下相容）
    -- ────────────────────────────────────────────────────────────────────
    SELECT EXISTS (
      SELECT 1 FROM public._resolve_hr_approver_ids(v_app_emp_id) WHERE _resolve_hr_approver_ids = emp.id
    ) INTO v_eligible;
    IF NOT v_eligible THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    result_status := CASE p_action WHEN 'approve' THEN approve_status ELSE reject_status END;

    EXECUTE format('UPDATE %I SET status=$1, approver=$2, reject_reason=$3 WHERE id=$4', v_table_name)
      USING result_status, emp.name, reject_val, p_id;

    IF p_type = 'correction' AND p_action = 'approve' THEN
      DECLARE c record; new_in time; new_out time; existing record;
      BEGIN
        SELECT * INTO c FROM clock_corrections WHERE id = p_id;
        IF c.correction_time IS NOT NULL THEN
          new_in  := CASE WHEN c.type = '上班打卡' THEN c.correction_time END;
          new_out := CASE WHEN c.type = '下班打卡' THEN c.correction_time END;
          SELECT * INTO existing FROM attendance_records WHERE employee = c.employee AND date = c.date LIMIT 1;
          IF FOUND THEN
            UPDATE attendance_records SET clock_in = COALESCE(new_in, clock_in), clock_out = COALESCE(new_out, clock_out) WHERE id = existing.id;
          ELSE
            INSERT INTO attendance_records (employee, date, clock_in, clock_out, status) VALUES (c.employee, c.date, new_in, new_out, '補登');
          END IF;
        END IF;
      END;
    END IF;

    RETURN json_build_object('ok', true, 'status', result_status,
      'event', CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- expense_request 走 chain（snapshot 優先 — 20260528200000 已切，保留邏輯）
  -- ════════════════════════════════════════════════════════════════════════
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

    SELECT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = 'expense_request' AND request_id = p_id
    ) INTO v_has_snapshot;

    IF v_has_snapshot THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.request_chain_snapshots
         WHERE request_type = 'expense_request' AND request_id = p_id
           AND step_order = v_er.current_step
      ) THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'snapshot');
      END IF;

      IF NOT public._employee_matches_snapshot_step(
        emp.id, 'expense_request', p_id, v_er.current_step, v_er.employee_id
      ) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;

      SELECT COUNT(*) INTO v_total_steps
        FROM public.request_chain_snapshots
       WHERE request_type = 'expense_request' AND request_id = p_id;
    ELSE
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'live_chain');
      END IF;
      IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_er.employee_id) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;
      SELECT COUNT(*) INTO v_total_steps
        FROM approval_chain_steps WHERE chain_id = v_er.approval_chain_id;
    END IF;

    v_is_last := (v_er.current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      UPDATE expense_requests SET status='已退回', reject_reason=reject_val, approved_by=emp.name WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已退回', 'event','rejected',
        'rejected_at_step', v_er.current_step,
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    END IF;

    IF v_is_last THEN
      UPDATE expense_requests SET status='已核准', approved_by=emp.name, approved_at=NOW() WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已核准', 'event','approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    ELSE
      UPDATE expense_requests SET current_step=current_step+1 WHERE id=p_id;

      IF v_has_snapshot THEN
        SELECT json_agg(json_build_object('emp_id', a.emp_id, 'name', a.emp_name))
          INTO v_next_approvers
          FROM public.resolve_snapshot_step_approvers(
            'expense_request', p_id, v_er.current_step + 1, v_er.employee_id
          ) a;
      ELSE
        SELECT * INTO v_next_step FROM approval_chain_steps
         WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step + 1;
        SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
         WHERE e.status='在職' AND e.organization_id = v_er.organization_id
           AND public._employee_matches_chain_step(e.id, v_next_step.id, v_er.employee_id);
        SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
          FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
      END IF;

      RETURN json_build_object('ok', true, 'status','簽核中', 'event','advanced',
        'advanced_to_step', v_er.current_step + 1, 'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    END IF;
  END IF;

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO authenticated, anon;

COMMENT ON FUNCTION public.liff_approve_request(text, text, int, text, text) IS
  'LIFF 簽核 — HR A chain 分支 + expense_request 都 snapshot 優先（2026-06-01）';


-- ══════════════════════════════════════════════════════════════════════════
-- 2. hr_chain_approve — HR B (resignation/loa/transfer/headcount) snapshot 優先
-- ══════════════════════════════════════════════════════════════════════════
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
  v_table_name        TEXT;
  v_snap_request_type TEXT;
  v_record            RECORD;
  v_chain_id          INT;
  v_cur_step          INT;
  v_total_steps       INT;
  v_step              approval_chain_steps;
  v_is_last           BOOLEAN;
  v_next_step         approval_chain_steps;
  v_next_ids          INT[];
  v_next_json         JSON;
  v_extra             approval_extra_steps;
  v_has_snapshot      BOOLEAN;
  v_matches           BOOLEAN;
BEGIN
  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    WHEN 'headcount'   THEN 'headcount_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TABLE');
  END IF;

  -- snapshot request_type
  v_snap_request_type := p_table;  -- 'resignation' / 'loa' / 'transfer' / 'headcount' 對齊

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

  -- 加簽 guard
  v_extra := public.get_pending_extra_step(v_table_name, p_id, COALESCE(v_cur_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id, 'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  -- 沒 chain → 舊行為
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

  -- snapshot 優先
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = v_snap_request_type AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = v_snap_request_type AND request_id = p_id AND step_order = v_cur_step
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'snapshot');
    END IF;

    SELECT public._employee_matches_snapshot_step(
      p_approver_id, v_snap_request_type, p_id, v_cur_step, v_record.employee_id
    ) INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = v_snap_request_type AND request_id = p_id;
  ELSE
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_cur_step;
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'live_chain');
    END IF;
    SELECT public._employee_matches_chain_step(p_approver_id, v_step.id, v_record.employee_id)
      INTO v_matches;
    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

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

    -- 下關 approver（snapshot 優先）
    IF v_has_snapshot THEN
      SELECT json_agg(json_build_object('emp_id', a.emp_id, 'name', a.emp_name))
        INTO v_next_json
        FROM public.resolve_snapshot_step_approvers(
          v_snap_request_type, p_id, v_cur_step + 1, v_record.employee_id
        ) a;
    ELSE
      SELECT * INTO v_next_step FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;
      SELECT array_agg(e.id) INTO v_next_ids FROM employees e
       WHERE e.status='在職' AND e.organization_id = v_record.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_record.employee_id);
      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_json
        FROM employees WHERE id = ANY(COALESCE(v_next_ids, ARRAY[]::INT[]));
    END IF;

    RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
      'next_approvers', COALESCE(v_next_json, '[]'::json));
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.hr_chain_approve(text, int, int, text, text) TO authenticated, anon;

COMMENT ON FUNCTION public.hr_chain_approve(text, int, int, text, text) IS
  'HR B chain 簽核 — snapshot 優先（resignation/loa/transfer/headcount，2026-06-01）';


-- ══════════════════════════════════════════════════════════════════════════
-- 3. _guard_chain_steps_in_flight — 全 8 表都按「有快照就放行」
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_chain_steps_in_flight()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  -- expense_requests
  SELECT COUNT(*) INTO v_count FROM public.expense_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審')
     AND NOT EXISTS (
       SELECT 1 FROM public.request_chain_snapshots rcs
        WHERE rcs.request_type = 'expense_request' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 expense_requests，請先等完成或補快照', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  -- form_submissions
  SELECT COUNT(*) INTO v_count
    FROM public.form_submissions fs
    JOIN public.form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = OLD.chain_id
     AND fs.status IN ('申請中', '待審', '待審核', 'pending')
     AND NOT EXISTS (
       SELECT 1 FROM public.request_chain_snapshots rcs
        WHERE rcs.request_type = 'form_submission' AND rcs.request_id = fs.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 form_submissions，請先等完成或補快照', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  -- HR A & B（已切 RPC 讀快照）── 8 表
  SELECT COUNT(*) INTO v_count FROM public.leave_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核')
     AND NOT EXISTS (SELECT 1 FROM public.request_chain_snapshots rcs
                      WHERE rcs.request_type = 'leave_request' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 leave_requests', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.overtime_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核')
     AND NOT EXISTS (SELECT 1 FROM public.request_chain_snapshots rcs
                      WHERE rcs.request_type = 'overtime_request' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 overtime_requests', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.business_trips T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核')
     AND NOT EXISTS (SELECT 1 FROM public.request_chain_snapshots rcs
                      WHERE rcs.request_type = 'trip' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 business_trips', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.clock_corrections T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核')
     AND NOT EXISTS (SELECT 1 FROM public.request_chain_snapshots rcs
                      WHERE rcs.request_type = 'correction' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 clock_corrections', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.resignation_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核')
     AND NOT EXISTS (SELECT 1 FROM public.request_chain_snapshots rcs
                      WHERE rcs.request_type = 'resignation' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 resignation_requests', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.leave_of_absence_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核')
     AND NOT EXISTS (SELECT 1 FROM public.request_chain_snapshots rcs
                      WHERE rcs.request_type = 'loa' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 leave_of_absence_requests', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.personnel_transfer_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核')
     AND NOT EXISTS (SELECT 1 FROM public.request_chain_snapshots rcs
                      WHERE rcs.request_type = 'transfer' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 personnel_transfer_requests', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.headcount_requests T
   WHERE T.approval_chain_id = OLD.chain_id AND T.status IN ('申請中', '待審', '待審核')
     AND NOT EXISTS (SELECT 1 FROM public.request_chain_snapshots rcs
                      WHERE rcs.request_type = 'headcount' AND rcs.request_id = T.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張無快照的在飛 headcount_requests', OLD.chain_id, v_count USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END $$;

COMMENT ON FUNCTION public._guard_chain_steps_in_flight() IS
  '改 approval_chain_steps 前 guard — 全 10 個 request type 都按「有快照就放行」（2026-06-01）';


COMMIT;
NOTIFY pgrst, 'reload schema';
