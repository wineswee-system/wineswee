-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核系統 — LIFF / LINE 整合
-- ────────────────────────────────────────────────────────────────────────────
-- 1. _notify_store_audit_event() helper：依事件類型推 LINE 給相關人
-- 2. AFTER INSERT/UPDATE trigger 偵測狀態變化自動推
-- 3. liff_approve_request 加 store_audit 分支
-- 4. liff_get_store_audit_detail RPC（LIFF 詳情頁用）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 推 LINE helper ──────────────────────────────────────────────────────
-- p_event:
--   'on_duty_confirm'  → 推給所有當班人員（要求確認）
--   'chain_step'       → 推給當前簽核關卡的審核人
--   'approved'         → 推給稽核員
--   'rejected'         → 推給稽核員 + 當班人員
CREATE OR REPLACE FUNCTION public._notify_store_audit_event(
  p_audit_id INT,
  p_event    TEXT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url       CONSTANT TEXT := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon      CONSTANT TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_audit     store_audits;
  v_step      approval_chain_steps;
  v_total     INT;
  v_count     INT := 0;
  r_target    RECORD;
  v_payload   JSONB;
  v_failed    INT;
  v_step_label TEXT;
  v_step_idx  INT;
BEGIN
  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN RETURN 0; END IF;

  -- 統計不合格項目（提供 LINE 卡顯示用）
  SELECT COUNT(*) INTO v_failed FROM store_audit_items WHERE audit_id = p_audit_id AND passed = FALSE;

  -- 簽核關卡資訊
  IF p_event = 'chain_step' AND v_audit.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
    SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id;
    v_step_label := COALESCE(v_step.label, v_step.role_name, '第' || (v_audit.current_step + 1) || '關');
    v_step_idx   := v_audit.current_step;
  END IF;

  -- ── 推給當班人員（on_duty_confirm / rejected）──
  IF p_event IN ('on_duty_confirm', 'rejected') THEN
    FOR r_target IN
      SELECT od.employee_id, v.line_user_id, v.liff_id
        FROM store_audit_on_duty od
        JOIN v_employee_line_resolved v ON v.employee_id = od.employee_id
       WHERE od.audit_id = p_audit_id AND od.employee_id IS NOT NULL
         AND v.line_user_id IS NOT NULL
         AND (p_event = 'rejected' OR od.confirmed = FALSE)
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', r_target.employee_id,
        'type', CASE WHEN p_event = 'on_duty_confirm' THEN 'store_audit_on_duty_assigned' ELSE 'store_audit_rejected' END,
        'details', jsonb_build_object(
          'audit_id', p_audit_id,
          'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift,
          'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed,
          'total_deducted', v_audit.total_deducted,
          'reject_reason', v_audit.reject_reason,
          'liff_url', CASE
            WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
            ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id
          END
        )
      );
      PERFORM net.http_post(
        url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
        timeout_milliseconds := 5000
      );
      v_count := v_count + 1;
    END LOOP;
  END IF;

  -- ── 推給當前簽核關審核人（chain_step）──
  IF p_event = 'chain_step' AND v_step.id IS NOT NULL THEN
    FOR r_target IN
      SELECT a.emp_id, v.line_user_id, v.liff_id
        FROM resolve_chain_step_approvers(v_step.id, v_audit.auditor_id) a
        JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
       WHERE v.line_user_id IS NOT NULL
         AND a.emp_id IS DISTINCT FROM v_audit.auditor_id
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', r_target.emp_id,
        'type', 'store_audit_step_assigned',
        'details', jsonb_build_object(
          'audit_id', p_audit_id,
          'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift,
          'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed,
          'total_deducted', v_audit.total_deducted,
          'current_step_label', v_step_label,
          'current_step_index', v_step_idx,
          'total_steps', v_total,
          'liff_url', CASE
            WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
            ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id
          END
        )
      );
      PERFORM net.http_post(
        url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
        timeout_milliseconds := 5000
      );
      v_count := v_count + 1;
    END LOOP;
  END IF;

  -- ── 推給稽核員（approved / rejected）──
  IF p_event IN ('approved', 'rejected') AND v_audit.auditor_id IS NOT NULL THEN
    FOR r_target IN
      SELECT v.line_user_id, v.liff_id
        FROM v_employee_line_resolved v
       WHERE v.employee_id = v_audit.auditor_id AND v.line_user_id IS NOT NULL
       LIMIT 1
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', v_audit.auditor_id,
        'type', CASE WHEN p_event = 'approved' THEN 'store_audit_approved' ELSE 'store_audit_rejected' END,
        'details', jsonb_build_object(
          'audit_id', p_audit_id,
          'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift,
          'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed,
          'total_deducted', v_audit.total_deducted,
          'reject_reason', v_audit.reject_reason,
          'approver', v_audit.approver,
          'liff_url', CASE
            WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
            ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id
          END
        )
      );
      PERFORM net.http_post(
        url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
        timeout_milliseconds := 5000
      );
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END $$;


-- ─── 2. AFTER UPDATE trigger：偵測狀態變化推 LINE ─────────────────────────
CREATE OR REPLACE FUNCTION public._trg_store_audit_line_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- '草稿' → '待確認'：通知當班人員
  IF NEW.status = '待確認' AND OLD.status IS DISTINCT FROM '待確認' THEN
    PERFORM public._notify_store_audit_event(NEW.id, 'on_duty_confirm');
    RETURN NEW;
  END IF;

  -- '待確認' → '申請中'：通知第一關審核人
  IF NEW.status = '申請中' AND OLD.status IS DISTINCT FROM '申請中' THEN
    PERFORM public._notify_store_audit_event(NEW.id, 'chain_step');
    RETURN NEW;
  END IF;

  -- 簽核中推進 current_step：通知下一關
  IF NEW.status = '申請中' AND OLD.status = '申請中' AND NEW.current_step > OLD.current_step THEN
    PERFORM public._notify_store_audit_event(NEW.id, 'chain_step');
    RETURN NEW;
  END IF;

  -- 核准
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM public._notify_store_audit_event(NEW.id, 'approved');
    RETURN NEW;
  END IF;

  -- 退回
  IF NEW.status = '已退回' AND OLD.status IS DISTINCT FROM '已退回' THEN
    PERFORM public._notify_store_audit_event(NEW.id, 'rejected');
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_audit_line_notify ON public.store_audits;
CREATE TRIGGER trg_store_audit_line_notify
  AFTER UPDATE ON public.store_audits
  FOR EACH ROW EXECUTE FUNCTION public._trg_store_audit_line_notify();


-- ─── 3. liff_approve_request 加 store_audit 分支 ──────────────────────────
-- 完整 CREATE OR REPLACE 避免 partial overwrite 災難
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
  v_fs_result   json;
  v_audit       store_audits;
  v_pending     int;
  v_row_id      int;
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

    -- 沒 chain → fallback 組織圖
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

  -- ════ form_submission ════
  IF p_type = 'form_submission' THEN
    v_fs_result := public.form_submission_chain_approve(p_id, emp.id, p_action, p_reason, '[]'::jsonb);
    RETURN v_fs_result;
  END IF;

  -- ════ store_audit ════
  IF p_type = 'store_audit' THEN
    SELECT * INTO v_audit FROM store_audits WHERE id = p_id;
    IF v_audit.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
    END IF;
    IF v_audit.organization_id IS NOT NULL AND v_audit.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;

    -- 「待確認」階段：當班人員確認
    IF v_audit.status = '待確認' THEN
      SELECT id INTO v_row_id FROM store_audit_on_duty
       WHERE audit_id = p_id AND employee_id = emp.id AND confirmed = FALSE LIMIT 1;
      IF v_row_id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN_OR_ALREADY_CONFIRMED');
      END IF;

      IF p_action = 'reject' THEN
        UPDATE store_audit_on_duty SET reject_reason = reject_val WHERE id = v_row_id;
        UPDATE store_audits SET status = '已退回', reject_reason = reject_val WHERE id = p_id;
        RETURN json_build_object('ok', true, 'event', 'rejected_by_on_duty', 'status', '已退回');
      END IF;

      -- confirm
      UPDATE store_audit_on_duty SET confirmed = TRUE, confirmed_at = NOW() WHERE id = v_row_id;

      SELECT COUNT(*) INTO v_pending FROM store_audit_on_duty
       WHERE audit_id = p_id AND confirmed = FALSE;
      IF v_pending > 0 THEN
        RETURN json_build_object('ok', true, 'event', 'partial_confirmed', 'pending_count', v_pending);
      END IF;

      -- 全部確認完
      IF v_audit.approval_chain_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id) THEN
        UPDATE store_audits SET status = '申請中', current_step = 0 WHERE id = p_id;
        RETURN json_build_object('ok', true, 'event', 'advanced_to_chain', 'status', '申請中');
      ELSE
        UPDATE store_audits SET status = '已核准', approved_at = NOW(), approver = emp.name WHERE id = p_id;
        RETURN json_build_object('ok', true, 'event', 'auto_approved_no_chain', 'status', '已核准');
      END IF;
    END IF;

    -- 「申請中」階段：簽核鏈推進
    IF v_audit.status = '申請中' THEN
      IF v_audit.approval_chain_id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
      END IF;
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
      END IF;
      IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_audit.auditor_id) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;

      SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id;
      v_is_last := (v_audit.current_step + 1 >= v_total_steps);

      IF p_action = 'reject' THEN
        UPDATE store_audits SET status = '已退回', reject_reason = reject_val, approver = emp.name WHERE id = p_id;
        RETURN json_build_object('ok', true, 'event', 'rejected', 'rejected_at_step', v_audit.current_step);
      END IF;

      IF v_is_last THEN
        UPDATE store_audits SET status = '已核准', approver = emp.name, approved_at = NOW() WHERE id = p_id;
        RETURN json_build_object('ok', true, 'event', 'approved', 'is_last_step', true);
      ELSE
        UPDATE store_audits SET current_step = current_step + 1 WHERE id = p_id;
        RETURN json_build_object('ok', true, 'event', 'advanced', 'advanced_to_step', v_audit.current_step + 1);
      END IF;
    END IF;

    RETURN json_build_object('ok', false, 'error', 'NOT_ACTIONABLE', 'status', v_audit.status);
  END IF;

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO authenticated, anon;


-- ─── 4. liff_get_store_audit_detail — LIFF 詳情頁取資料 ────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_store_audit_detail(
  p_line_user_id text,
  p_audit_id     int
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_audit    store_audits;
  v_items    json;
  v_on_duty  json;
  v_step     approval_chain_steps;
  v_can_confirm boolean := false;
  v_can_approve boolean := false;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;

  -- 評核項目
  SELECT json_agg(json_build_object(
    'id', id, 'category_code', category_code, 'category_name', category_name,
    'item_no', item_no, 'item_text', item_text, 'deduct_score', deduct_score,
    'passed', passed,
    'responsible_employee_id', responsible_employee_id,
    'responsible_employee_name', responsible_employee_name
  ) ORDER BY category_code, item_no) INTO v_items
  FROM store_audit_items WHERE audit_id = p_audit_id;

  -- 當班人員
  SELECT json_agg(json_build_object(
    'employee_id', employee_id, 'employee_name', employee_name,
    'confirmed', confirmed, 'confirmed_at', confirmed_at, 'reject_reason', reject_reason
  ) ORDER BY sort_order) INTO v_on_duty
  FROM store_audit_on_duty WHERE audit_id = p_audit_id;

  -- 是否可確認/簽核
  IF v_audit.status = '待確認' THEN
    SELECT EXISTS (
      SELECT 1 FROM store_audit_on_duty
       WHERE audit_id = p_audit_id AND employee_id = emp.id AND confirmed = FALSE
    ) INTO v_can_confirm;
  ELSIF v_audit.status = '申請中' AND v_audit.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
    IF v_step.id IS NOT NULL THEN
      v_can_approve := public._employee_matches_chain_step(emp.id, v_step.id, v_audit.auditor_id);
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'audit', row_to_json(v_audit),
    'items', COALESCE(v_items, '[]'::json),
    'on_duty', COALESCE(v_on_duty, '[]'::json),
    'can_confirm', v_can_confirm,
    'can_approve', v_can_approve
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_store_audit_detail(text, int) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
