-- ════════════════════════════════════════════════════════════
-- 重鎖 liff_approve_request 為 chain-aware 版（HR A 類 + expense_request）
-- 2026-05-12
--
-- 慘案：上一個 fix（20260512090000_relock_liff_pending_approvals）讓 Snow 在
-- LIFF 看到 5 筆「指定員工」單，但按「核准」彈出「目前不是輪到你簽」(NOT_YOUR_TURN)。
--
-- 根因：跟 liff_list_pending_approvals 一樣的「migration 部分修法洗掉另一段」事件：
--
--   - 20260508180000_hr_a_chain_aware.sql 把 liff_approve_request 寫成 chain-aware
--     （HR A 類有 chain → 走 chain step + _employee_matches_chain_step）
--   - 20260508210000_fix_liff_approve_request_chain_step.sql 為了補 expense_request
--     的 applicant_emp_id 傳參，CREATE OR REPLACE 整個 function — 但作者在 HR A 類
--     那段卻退回成只用 _resolve_hr_approver_ids 組織圖 fallback
--   - 對「指定員工 Snow」chain，測試管理員（無組織圖主管）→ Snow not in
--     _resolve_hr_approver_ids(204) → 永遠 NOT_YOUR_TURN
--
-- 修：重推 chain-aware 完整版（從 hr_a_chain_aware.sql L269-534 取），同時涵蓋：
--   1. HR A 類 chain step 推進（leave/overtime/trip/correction/expense）
--   2. expense_request chain（含 applicant_emp_id 傳對）
--   3. 沒 chain 時 fallback 組織圖（向下相容）
-- ════════════════════════════════════════════════════════════

BEGIN;

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

  -- ════ HR 類 (leave/overtime/trip/correction/expense) ════
  IF p_type IN ('leave','overtime','trip','correction','expense') THEN
    v_table_name := CASE p_type
      WHEN 'leave'      THEN 'leave_requests'
      WHEN 'overtime'   THEN 'overtime_requests'
      WHEN 'trip'       THEN 'business_trips'
      WHEN 'correction' THEN 'clock_corrections'
      WHEN 'expense'    THEN 'expenses'
    END;

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

    -- ── 有 chain → 走 chain step ──
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
        EXECUTE format('UPDATE %I SET status=$1, approver=$2, reject_reason=$3 WHERE id=$4', v_table_name)
          USING reject_status, emp.name, reject_val, p_id;
        RETURN json_build_object('ok', true, 'status', reject_status, 'event', 'rejected',
          'rejected_at_step', v_cur_step,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;

      IF v_is_last THEN
        EXECUTE format('UPDATE %I SET status=$1, approver=$2, current_step=$3 WHERE id=$4', v_table_name)
          USING approve_status, emp.name, v_total_steps, p_id;

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
      ELSE
        EXECUTE format('UPDATE %I SET current_step = current_step + 1 WHERE id=$1', v_table_name) USING p_id;

        SELECT * INTO v_next_step FROM approval_chain_steps
         WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;

        SELECT array_agg(e.id) INTO v_next_approver_ids
          FROM employees e
         WHERE e.status = '在職'
           AND e.organization_id = emp.organization_id
           AND public._employee_matches_chain_step(e.id, v_next_step.id, v_app_emp_id);

        SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
          FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));

        RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
          'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
          'next_approvers', COALESCE(v_next_approvers, '[]'::json),
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;
    END IF;

    -- ── 沒 chain → fallback 組織圖 ──
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

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
