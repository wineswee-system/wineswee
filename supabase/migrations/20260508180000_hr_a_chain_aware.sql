-- ════════════════════════════════════════════════════════════
-- HR A 類 5 張表 chain-aware
--   設了 chain (form_chain_configs) → 走 chain step 多關推進
--   沒設 chain → fallback _resolve_hr_approver_ids 組織圖（過渡期相容）
--
-- 涵蓋：leave_requests / overtime_requests / business_trips /
--       clock_corrections / expenses
--
-- 仿 expense_request 的 row.current_step + chain step 模式：
--   1. schema 加 approval_chain_id + current_step
--   2. BEFORE INSERT trigger 依 form_chain_configs 自動掛 chain
--   3. _notify_hr_request_approvers / _notify_hr_request_applicant
--      → 有 chain 推 chain step 0 / 推進關 / 申請人；沒 chain fallback 組織圖
--   4. liff_approve_request 對 HR 5 類加 chain step 推進邏輯
--   5. liff_list_pending_approvals 對 HR 5 類加 chain step 過濾
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. schema：加 approval_chain_id + current_step ═══
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS approval_chain_id INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS approval_chain_id INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

ALTER TABLE public.business_trips
  ADD COLUMN IF NOT EXISTS approval_chain_id INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

ALTER TABLE public.clock_corrections
  ADD COLUMN IF NOT EXISTS approval_chain_id INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS approval_chain_id INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;


-- ═══ 2. BEFORE INSERT trigger：自動依 form_chain_configs 掛 chain ═══
CREATE OR REPLACE FUNCTION public._auto_apply_hr_form_chain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_form_type text;
  v_org_id    int;
  v_chain_id  int;
BEGIN
  -- 已指定就不動
  IF NEW.approval_chain_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_form_type := CASE TG_TABLE_NAME
    WHEN 'leave_requests'      THEN 'leave'
    WHEN 'overtime_requests'   THEN 'overtime'
    WHEN 'business_trips'      THEN 'trip'
    WHEN 'clock_corrections'   THEN 'correction'
    WHEN 'expenses'            THEN 'expense'
    ELSE NULL
  END;
  IF v_form_type IS NULL THEN RETURN NEW; END IF;

  v_org_id := NEW.organization_id;

  -- 精準 org 優先，全域 NULL 也接受
  SELECT chain_id INTO v_chain_id
    FROM public.form_chain_configs
   WHERE form_type = v_form_type
     AND COALESCE(is_active, true) = true
     AND (organization_id = v_org_id OR organization_id IS NULL)
   ORDER BY (organization_id = v_org_id) DESC NULLS LAST
   LIMIT 1;

  IF v_chain_id IS NOT NULL THEN
    NEW.approval_chain_id := v_chain_id;
    NEW.current_step      := 0;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_apply_chain_leave ON public.leave_requests;
CREATE TRIGGER trg_auto_apply_chain_leave BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._auto_apply_hr_form_chain();

DROP TRIGGER IF EXISTS trg_auto_apply_chain_overtime ON public.overtime_requests;
CREATE TRIGGER trg_auto_apply_chain_overtime BEFORE INSERT ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public._auto_apply_hr_form_chain();

DROP TRIGGER IF EXISTS trg_auto_apply_chain_trip ON public.business_trips;
CREATE TRIGGER trg_auto_apply_chain_trip BEFORE INSERT ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public._auto_apply_hr_form_chain();

DROP TRIGGER IF EXISTS trg_auto_apply_chain_correction ON public.clock_corrections;
CREATE TRIGGER trg_auto_apply_chain_correction BEFORE INSERT ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._auto_apply_hr_form_chain();

DROP TRIGGER IF EXISTS trg_auto_apply_chain_expense ON public.expenses;
CREATE TRIGGER trg_auto_apply_chain_expense BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._auto_apply_hr_form_chain();


-- ═══ 3. helper：對「特定 HR row 的特定 chain step」推 LINE ═══
-- 解 approver list（用 resolve_chain_step_approvers，9 種 target_type 都吃）
-- → 對每個 approver 呼對應的 _push_xxx_flex
CREATE OR REPLACE FUNCTION public._notify_hr_chain_step(
  p_rt          text,
  p_id          int,
  p_chain_id    int,
  p_step_order  int,
  p_applicant_id int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step approval_chain_steps;
  v_count int := 0;
  v_line record;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = p_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM resolve_chain_step_approvers(v_step.id, p_applicant_id) a
      JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
                                     AND v.line_user_id = a.line_user_id
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


-- ═══ 4. 改 _notify_hr_request_approvers 變 chain-aware ═══
-- 有 chain → 推 chain step 0 approvers
-- 沒 chain → fallback _resolve_hr_approver_ids 組織圖
CREATE OR REPLACE FUNCTION public._notify_hr_request_approvers(
  p_rt          text,
  p_id          int,
  p_applicant_id int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_chain_id int;
  v_count int := 0;
  v_line  record;
  v_table_name text;
BEGIN
  IF p_applicant_id IS NULL THEN RETURN 0; END IF;

  v_table_name := CASE p_rt
    WHEN 'leave' THEN 'leave_requests'
    WHEN 'overtime' THEN 'overtime_requests'
    WHEN 'trip' THEN 'business_trips'
    WHEN 'correction' THEN 'clock_corrections'
    WHEN 'expense' THEN 'expenses'
  END;

  EXECUTE format('SELECT approval_chain_id FROM %I WHERE id = $1', v_table_name)
    INTO v_chain_id USING p_id;

  -- 有 chain → 走 chain step 0
  IF v_chain_id IS NOT NULL THEN
    RETURN public._notify_hr_chain_step(p_rt, p_id, v_chain_id, 0, p_applicant_id);
  END IF;

  -- fallback：沒設 chain → 用組織圖
  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM _resolve_hr_approver_ids(p_applicant_id) ap_id
      JOIN v_employee_line_resolved v ON v.employee_id = ap_id
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


-- ═══ 5. 加 UPDATE trigger 對 current_step ↑ 推下一關 ═══
-- (既有 INSERT/UPDATE trigger from 20260508170000 已存在；要再加 current_step 推進)
CREATE OR REPLACE FUNCTION public._trg_notify_hr_step_advanced()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rt text;
  v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.current_step IS NOT DISTINCT FROM OLD.current_step THEN RETURN NEW; END IF;
  IF NEW.current_step <= COALESCE(OLD.current_step, 0) THEN RETURN NEW; END IF;
  -- 只有「申請中/待審核」狀態才推下一關
  IF NEW.status NOT IN ('待審核', '申請中') THEN RETURN NEW; END IF;

  v_rt := CASE TG_TABLE_NAME
    WHEN 'leave_requests'    THEN 'leave'
    WHEN 'overtime_requests' THEN 'overtime'
    WHEN 'business_trips'    THEN 'trip'
    WHEN 'clock_corrections' THEN 'correction'
    WHEN 'expenses'          THEN 'expense'
  END;

  -- applicant_id：leave/overtime 直接用 employee_id；其他從 employee TEXT 反查
  IF v_rt IN ('leave','overtime') THEN
    v_emp_id := NEW.employee_id;
  ELSE
    SELECT id INTO v_emp_id FROM employees
     WHERE name = NEW.employee
       AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL)
     LIMIT 1;
  END IF;

  PERFORM public._notify_hr_chain_step(v_rt, NEW.id, NEW.approval_chain_id, NEW.current_step, v_emp_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_hr_step_advanced_leave ON public.leave_requests;
CREATE TRIGGER trg_notify_hr_step_advanced_leave AFTER UPDATE OF current_step ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_hr_step_advanced();

DROP TRIGGER IF EXISTS trg_notify_hr_step_advanced_overtime ON public.overtime_requests;
CREATE TRIGGER trg_notify_hr_step_advanced_overtime AFTER UPDATE OF current_step ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_hr_step_advanced();

DROP TRIGGER IF EXISTS trg_notify_hr_step_advanced_trip ON public.business_trips;
CREATE TRIGGER trg_notify_hr_step_advanced_trip AFTER UPDATE OF current_step ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_hr_step_advanced();

DROP TRIGGER IF EXISTS trg_notify_hr_step_advanced_correction ON public.clock_corrections;
CREATE TRIGGER trg_notify_hr_step_advanced_correction AFTER UPDATE OF current_step ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_hr_step_advanced();

DROP TRIGGER IF EXISTS trg_notify_hr_step_advanced_expense ON public.expenses;
CREATE TRIGGER trg_notify_hr_step_advanced_expense AFTER UPDATE OF current_step ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_hr_step_advanced();


-- ═══ 6. 改 liff_approve_request：HR 類有 chain 走 chain step 推進；沒 chain 走舊單關 ═══
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

    -- 取申請人 + chain 資訊
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

    -- ── 有 chain → 走 chain step 推進 ──
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
        EXECUTE format(
          'UPDATE %I SET status=$1, approver=$2, reject_reason=$3 WHERE id=$4', v_table_name
        ) USING reject_status, emp.name, reject_val, p_id;
        RETURN json_build_object(
          'ok', true, 'status', reject_status, 'event', 'rejected',
          'rejected_at_step', v_cur_step,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name)
        );
      END IF;

      -- approve
      IF v_is_last THEN
        EXECUTE format(
          'UPDATE %I SET status=$1, approver=$2, current_step=$3 WHERE id=$4', v_table_name
        ) USING approve_status, emp.name, v_total_steps, p_id;

        -- 補打卡核准 → 寫 attendance_records (沿用舊邏輯)
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

        RETURN json_build_object(
          'ok', true, 'status', approve_status, 'event', 'approved', 'is_last_step', true,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name)
        );
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

        RETURN json_build_object(
          'ok', true, 'status', '簽核中', 'event', 'advanced',
          'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
          'next_approvers', COALESCE(v_next_approvers, '[]'::json),
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name)
        );
      END IF;
    END IF;

    -- ── 沒 chain → fallback 舊單關（_resolve_hr_approver_ids） ──
    SELECT EXISTS (
      SELECT 1 FROM public._resolve_hr_approver_ids(v_app_emp_id) WHERE _resolve_hr_approver_ids = emp.id
    ) INTO v_eligible;
    IF NOT v_eligible THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    result_status := CASE p_action WHEN 'approve' THEN approve_status ELSE reject_status END;

    EXECUTE format(
      'UPDATE %I SET status=$1, approver=$2, reject_reason=$3 WHERE id=$4', v_table_name
    ) USING result_status, emp.name, reject_val, p_id;

    -- 補打卡 fallback 路徑也要寫 attendance_records
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

    RETURN json_build_object(
      'ok', true, 'status', result_status,
      'event', CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name)
    );
  END IF;

  -- ════ expense_request 走 chain (沿用舊邏輯) ════
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


-- ═══ 7. 改 liff_list_pending_approvals：HR 類有 chain 用 chain step 過濾 ═══
CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'task_confirmations','[]'::json,
      'shift_swaps_for_peer','[]'::json,'shift_swaps_for_manager','[]'::json,
      'off_requests','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
    );
  END IF;

  SELECT json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id
        AND l.status = '待審核'
        AND (
          -- 有 chain → 用 chain step 過濾
          (l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          -- 沒 chain → fallback 組織圖
          OR (l.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
        )
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審核'
        AND (
          (o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
        )
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (
        SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1
      ) e_app ON true
      WHERE t.organization_id = emp.organization_id
        AND t.status = '待審核'
        AND (
          (t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
        )
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND (
          (c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
        )
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(ex.*) ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND (
          (ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
        )
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department,
        'title', er.title, 'description', er.description,
        'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store, 'status', er.status,
        'created_at', er.created_at,
        'reject_reason', er.reject_reason,
        'approval_chain_id', er.approval_chain_id,
        'current_step', er.current_step,
        'chain_name', ac.name,
        'chain_total_steps', (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.approval_chain_id),
        'current_step_label', cur_step.label,
        'current_step_target', cur_step.role_name
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '申請中'
        AND er.approval_chain_id IS NOT NULL
        AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待對方同意' AND ss.target_id = emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json)
      FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', public.liff_employee_has_permission(emp.id, 'finance.edit')
    )
  ) INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text) TO authenticated, anon;


COMMIT;

NOTIFY pgrst, 'reload schema';
