-- ════════════════════════════════════════════════════════════
-- Fix: liff_approve_request expense_request chain-step 驗證
--
-- Bug 1 (primary — 按鈕永遠 NOT_YOUR_TURN):
--   20260426010000 中 _employee_matches_chain_step(emp.id, v_cur_step.id) 缺第三個
--   applicant_emp_id 參數，動態 target_type (applicant_supervisor 等) 永遠不 match。
--   同一問題已在 20260508150000 修了 expense_request_step_advance，此 migration 補 liff_approve_request。
--
-- Bug 2 (secondary — 駁回沒推 LINE 給申請人):
--   liff_approve_request 的 expense_request reject 寫 status='已退回'（B2 可重送），
--   但 _trg_notify_expense_request_updated 只捕捉 '已駁回' → 申請人收不到通知。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 修 liff_approve_request ─ expense_request chain step 驗證 ═══
CREATE OR REPLACE FUNCTION public.liff_approve_request(
  p_line_user_id text,
  p_type         text,
  p_id           int,
  p_action       text,
  p_reason       text DEFAULT NULL
)
RETURNS json
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
  v_er          record;
  v_cur_step    record;
  v_total_steps int;
  v_is_last     boolean;
  v_next_step   record;
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

  -- ════ HR 類（leave/overtime/trip/correction/expense）════
  IF p_type IN ('leave','overtime','trip','correction','expense') THEN
    IF p_type = 'leave' THEN
      SELECT employee_id, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM leave_requests WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'overtime' THEN
      SELECT employee_id, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM overtime_requests WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'trip' THEN
      SELECT NULL::INT, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM business_trips WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'correction' THEN
      SELECT NULL::INT, employee, NULL::INT INTO v_app_emp_id, v_app_name, v_app_org
        FROM clock_corrections WHERE id = p_id AND status = '待審核';
    ELSE  -- expense
      SELECT NULL::INT, employee, NULL::INT INTO v_app_emp_id, v_app_name, v_app_org
        FROM expenses WHERE id = p_id AND status = '待審核';
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

    SELECT EXISTS (
      SELECT 1 FROM public._resolve_hr_approver_ids(v_app_emp_id) WHERE _resolve_hr_approver_ids = emp.id
    ) INTO v_eligible;

    IF NOT v_eligible THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    approve_status := CASE p_type WHEN 'expense' THEN '已核銷' ELSE '已核准' END;
    reject_status  := '已退回';
    result_status  := CASE p_action WHEN 'approve' THEN approve_status ELSE reject_status END;

    IF p_type = 'leave' THEN
      UPDATE leave_requests SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
    ELSIF p_type = 'overtime' THEN
      UPDATE overtime_requests SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
    ELSIF p_type = 'trip' THEN
      UPDATE business_trips SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
    ELSIF p_type = 'correction' THEN
      UPDATE clock_corrections SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
      IF p_action = 'approve' THEN
        DECLARE
          c record; new_in time; new_out time; existing record;
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
    ELSE  -- expense
      UPDATE expenses SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
    END IF;

    RETURN json_build_object(
      'ok', true,
      'status', result_status,
      'event', CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name)
    );
  END IF;

  -- ════ 申請（expense_request）走 chain ════
  IF p_type = 'expense_request' THEN
    SELECT * INTO v_er FROM expense_requests WHERE id = p_id;
    IF v_er.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.status <> '申請中' THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.organization_id IS NOT NULL AND v_er.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;
    IF v_er.approval_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;

    SELECT * INTO v_cur_step
      FROM approval_chain_steps
     WHERE chain_id = v_er.approval_chain_id
       AND step_order = v_er.current_step;
    IF v_cur_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
    END IF;

    -- ★ Fix: pass v_er.employee_id as 3rd arg so applicant_* target types resolve correctly
    IF NOT public._employee_matches_chain_step(emp.id, v_cur_step.id, v_er.employee_id) THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    SELECT COUNT(*) INTO v_total_steps
      FROM approval_chain_steps WHERE chain_id = v_er.approval_chain_id;
    v_is_last := (v_er.current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      UPDATE expense_requests
         SET status = '已退回',
             reject_reason = reject_val,
             approved_by = emp.name
       WHERE id = p_id;
      RETURN json_build_object(
        'ok', true,
        'status', '已退回',
        'event', 'rejected',
        'rejected_at_step', v_er.current_step,
        'applicant', json_build_object(
          'emp_id', COALESCE(v_er.employee_id,
            (SELECT id FROM employees WHERE name = v_er.employee AND organization_id = v_er.organization_id LIMIT 1)),
          'name', v_er.employee)
      );
    END IF;

    -- approve
    IF v_is_last THEN
      UPDATE expense_requests
         SET status = '已核准', approved_by = emp.name, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object(
        'ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true,
        'applicant', json_build_object(
          'emp_id', COALESCE(v_er.employee_id,
            (SELECT id FROM employees WHERE name = v_er.employee AND organization_id = v_er.organization_id LIMIT 1)),
          'name', v_er.employee)
      );
    ELSE
      UPDATE expense_requests SET current_step = current_step + 1 WHERE id = p_id;

      SELECT * INTO v_next_step
        FROM approval_chain_steps
       WHERE chain_id = v_er.approval_chain_id
         AND step_order = v_er.current_step + 1;

      -- ★ Fix: pass v_er.employee_id for next-step candidate matching too
      SELECT array_agg(e.id) INTO v_next_approver_ids
        FROM employees e
       WHERE e.status = '在職'
         AND e.organization_id = v_er.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_er.employee_id);

      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
        FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));

      RETURN json_build_object(
        'ok', true, 'status', '簽核中', 'event', 'advanced',
        'advanced_to_step', v_er.current_step + 1,
        'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object(
          'emp_id', COALESCE(v_er.employee_id,
            (SELECT id FROM employees WHERE name = v_er.employee AND organization_id = v_er.organization_id LIMIT 1)),
          'name', v_er.employee)
      );
    END IF;
  END IF;

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO authenticated, anon;


-- ═══ 2. 修 trigger：同時捕捉 '已退回' 推申請人駁回通知 ═══
-- '已退回' = B2 可重送（由 liff_approve_request/LINE 按鈕設定）
-- '已駁回' = 終止（由 expense_request_step_advance/web 設定）
-- 兩者都要推申請人 LINE 通知。
CREATE OR REPLACE FUNCTION public._trg_notify_expense_request_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_app_line text;
  v_app_liff text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 已核准 → 推申請人
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v
     WHERE v.employee_id = NEW.employee_id
     ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
     LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_expense_request_flex(v_app_line, v_app_liff, NEW.id, 'request_approved');
    END IF;
    RETURN NEW;
  END IF;

  -- 已駁回 或 已退回 → 推申請人駁回通知
  IF NEW.status IN ('已駁回', '已退回')
     AND OLD.status NOT IN ('已駁回', '已退回') THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v
     WHERE v.employee_id = NEW.employee_id
     ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
     LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_expense_request_flex(v_app_line, v_app_liff, NEW.id, 'request_rejected');
    END IF;
    RETURN NEW;
  END IF;

  -- current_step 推進 → 推下一關 approver
  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status IN ('申請中', '待審')
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_expense_request_step(NEW.id, NEW.current_step);
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

-- Trigger function replaced in-place; the trigger binding from 20260508110000 still applies.

COMMIT;
