-- ════════════════════════════════════════════════════════════════════════════
-- HR A chain advance LINE 通知補洞
-- 2026-06-01
--
-- 背景：
--   HR A（leave/overtime/trip/correction/expense）原本設計是「申請人主管」
--   單關簽核 — INSERT trigger 廣播給組織圖所有可能簽的人，UPDATE trigger 只在
--   status 終態通知申請人。中間 current_step 推進**不推 LINE** 給下一關 approver。
--
--   HR B（resignation/loa/transfer/headcount）原生 chain 設計 — 有 _notify_hr_b_step
--   helper + UPDATE trigger 偵測 current_step 推進就推下關。
--
--   這個 migration 把 HR A 補齊。
--
-- 改動：
--   1. 新增 `_notify_hr_a_step(p_rt, p_id, p_step_order)` helper — snapshot 優先
--   2. 修 5 個 HR A 的 UPDATE trigger function — 偵測 current_step 推進 → 呼 helper
--
-- 保留：
--   - HR A INSERT trigger 維持「廣播所有 org-chart 主管」行為（沒切到「只推第 1 關」
--     避免對沒設 chain 的舊流程造成行為變動）。如果未來想精準推第 1 關 approver
--     再開另一個 migration 切。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. _notify_hr_a_step：HR A chain step LINE 通知 helper（snapshot 優先）
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_hr_a_step(
  p_rt          text,    -- 'leave' | 'overtime' | 'trip' | 'correction' | 'expense'
  p_id          int,
  p_step_order  int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table_name        text;
  v_snap_request_type text;
  v_chain_id          int;
  v_emp_id            int;
  v_step              approval_chain_steps;
  v_has_snapshot      boolean;
  v_count             int := 0;
  v_line              record;
BEGIN
  v_table_name := CASE p_rt
    WHEN 'leave'      THEN 'leave_requests'
    WHEN 'overtime'   THEN 'overtime_requests'
    WHEN 'trip'       THEN 'business_trips'
    WHEN 'correction' THEN 'clock_corrections'
    WHEN 'expense'    THEN 'expenses'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN RETURN 0; END IF;

  v_snap_request_type := CASE p_rt
    WHEN 'leave'      THEN 'leave_request'
    WHEN 'overtime'   THEN 'overtime_request'
    WHEN 'trip'       THEN 'trip'
    WHEN 'correction' THEN 'correction'
    ELSE NULL  -- expense 沒 snapshot trigger
  END;

  -- 抓 chain_id + applicant_emp_id
  IF p_rt IN ('leave','overtime') THEN
    EXECUTE format('SELECT approval_chain_id, employee_id FROM %I WHERE id = $1', v_table_name)
      INTO v_chain_id, v_emp_id USING p_id;
  ELSE
    -- trip / correction / expense：沒 employee_id，從 employee TEXT 反查
    DECLARE v_emp_name text; v_org_id int;
    BEGIN
      EXECUTE format('SELECT approval_chain_id, employee, organization_id FROM %I WHERE id = $1', v_table_name)
        INTO v_chain_id, v_emp_name, v_org_id USING p_id;
      SELECT id INTO v_emp_id FROM employees
       WHERE name = v_emp_name AND (organization_id = v_org_id OR v_org_id IS NULL) LIMIT 1;
    END;
  END IF;

  IF v_chain_id IS NULL THEN RETURN 0; END IF;

  -- snapshot 優先
  IF v_snap_request_type IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = v_snap_request_type AND request_id = p_id
    ) INTO v_has_snapshot;
  ELSE
    v_has_snapshot := FALSE;
  END IF;

  IF v_has_snapshot THEN
    FOR v_line IN
      SELECT DISTINCT v.line_user_id, v.liff_id
        FROM public.resolve_snapshot_step_approvers(
               v_snap_request_type, p_id, p_step_order, v_emp_id
             ) a
        JOIN public.v_employee_line_resolved v
          ON v.employee_id = a.emp_id AND v.line_user_id = a.line_user_id
       WHERE v.line_user_id IS NOT NULL
    LOOP
      IF p_rt = 'leave' THEN
        PERFORM public._push_leave_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      ELSIF p_rt = 'overtime' THEN
        PERFORM public._push_overtime_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      ELSIF p_rt = 'trip' THEN
        PERFORM public._push_trip_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      ELSIF p_rt = 'correction' THEN
        PERFORM public._push_correction_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      ELSIF p_rt = 'expense' THEN
        PERFORM public._push_expense_report_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      END IF;
      v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
  END IF;

  -- fallback live chain
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM public.resolve_chain_step_approvers(v_step.id, v_emp_id) a
      JOIN public.v_employee_line_resolved v
        ON v.employee_id = a.emp_id AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
  LOOP
    IF p_rt = 'leave' THEN
      PERFORM public._push_leave_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_rt = 'overtime' THEN
      PERFORM public._push_overtime_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_rt = 'trip' THEN
      PERFORM public._push_trip_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_rt = 'correction' THEN
      PERFORM public._push_correction_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_rt = 'expense' THEN
      PERFORM public._push_expense_report_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_hr_a_step(text, int, int) TO authenticated, service_role;

COMMENT ON FUNCTION public._notify_hr_a_step(text, int, int) IS
  'HR A chain step LINE 通知 — snapshot 優先（2026-06-01）';


-- ══════════════════════════════════════════════════════════════════════════
-- 2. 修 5 個 UPDATE trigger function — 加 current_step 推進 → 推下關
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trg_notify_leave_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 終態通知申請人
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM _notify_hr_request_applicant('leave', NEW.id, 'request_approved', NEW.employee_id);
    RETURN NEW;
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('leave', NEW.id, 'request_rejected', NEW.employee_id);
    RETURN NEW;
  END IF;

  -- ★ chain 推進 → 推下關 approver
  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status = '待審核'
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_a_step('leave', NEW.id, NEW.current_step);
  END IF;

  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION public._trg_notify_overtime_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM _notify_hr_request_applicant('overtime', NEW.id, 'request_approved', NEW.employee_id);
    RETURN NEW;
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('overtime', NEW.id, 'request_rejected', NEW.employee_id);
    RETURN NEW;
  END IF;

  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status = '待審核'
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_a_step('overtime', NEW.id, NEW.current_step);
  END IF;

  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION public._trg_notify_trip_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;

  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM _notify_hr_request_applicant('trip', NEW.id, 'request_approved', v_emp_id);
    RETURN NEW;
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('trip', NEW.id, 'request_rejected', v_emp_id);
    RETURN NEW;
  END IF;

  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status = '待審核'
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_a_step('trip', NEW.id, NEW.current_step);
  END IF;

  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION public._trg_notify_correction_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;

  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM _notify_hr_request_applicant('correction', NEW.id, 'request_approved', v_emp_id);
    RETURN NEW;
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('correction', NEW.id, 'request_rejected', v_emp_id);
    RETURN NEW;
  END IF;

  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status = '待審核'
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_a_step('correction', NEW.id, NEW.current_step);
  END IF;

  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION public._trg_notify_expense_report_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;

  IF NEW.status = '已核銷' AND OLD.status IS DISTINCT FROM '已核銷' THEN
    PERFORM _notify_hr_request_applicant('expense', NEW.id, 'request_approved', v_emp_id);
    RETURN NEW;
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('expense', NEW.id, 'request_rejected', v_emp_id);
    RETURN NEW;
  END IF;

  -- expense 沒 snapshot 但仍可推（_notify_hr_a_step 內部 fallback live chain）
  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status = '待審核'
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_a_step('expense', NEW.id, NEW.current_step);
  END IF;

  RETURN NEW;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
