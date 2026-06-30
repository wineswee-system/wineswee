-- ════════════════════════════════════════════════════════════════════════════
-- skip_if_no_approver：解不到簽核人時自動跳過該步驟
--
-- 使用情境：加班申請鏈有「區督導」一步，
--   門市員工若所在門市無督導 → 該步自動跳過；
--   行政員工 store_id=NULL → 同樣自動跳過。
--
-- 修改清單（純加法 / CREATE OR REPLACE，不動 target_type / 其他欄）：
--   1. approval_chain_steps    ADD skip_if_no_approver BOOLEAN DEFAULT FALSE
--   2. request_chain_snapshots ADD auto_skipped        BOOLEAN DEFAULT FALSE
--   3. _snapshot_chain_for_request — 加 p_applicant_emp_id，預先解析 auto_skipped
--   4. _trg_snapshot_chain_generic — 傳 employee_id 給 snapshot function
--   5. liff_approve_request   — advance 後跳過 auto_skipped 步
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. 加欄位
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.approval_chain_steps
  ADD COLUMN IF NOT EXISTS skip_if_no_approver BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.request_chain_snapshots
  ADD COLUMN IF NOT EXISTS auto_skipped BOOLEAN NOT NULL DEFAULT FALSE;


-- ══════════════════════════════════════════════════════════════════════════
-- 2. _snapshot_chain_for_request — 加第 4 參數 p_applicant_emp_id
--    若步驟 skip_if_no_approver=true 且解不到任何簽核人 → auto_skipped=true
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._snapshot_chain_for_request(
  p_request_type     TEXT,
  p_request_id       INT,
  p_chain_id         INT,
  p_applicant_emp_id INT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_step        public.approval_chain_steps;
  v_approver_ct INT;
  v_auto_skip   BOOLEAN;
BEGIN
  IF p_chain_id IS NULL THEN RETURN; END IF;

  FOR v_step IN
    SELECT * FROM public.approval_chain_steps
     WHERE chain_id = p_chain_id
     ORDER BY step_order
  LOOP
    v_auto_skip := FALSE;

    -- 預先判斷：若此步勾了「找不到時自動跳過」且有申請人 id
    IF v_step.skip_if_no_approver AND p_applicant_emp_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_approver_ct
        FROM public.resolve_chain_step_approvers(v_step.id, p_applicant_emp_id);
      v_auto_skip := (v_approver_ct = 0);
    END IF;

    INSERT INTO public.request_chain_snapshots (
      request_type, request_id, chain_id, step_order,
      label, role_name, target_type,
      target_emp_id, target_role_id, target_dept_id,
      target_store_id, target_section_id,
      skip_if_no_approver, auto_skipped
    ) VALUES (
      p_request_type, p_request_id, p_chain_id, v_step.step_order,
      v_step.label, v_step.role_name, v_step.target_type,
      v_step.target_emp_id, v_step.target_role_id, v_step.target_dept_id,
      v_step.target_store_id, v_step.target_section_id,
      v_step.skip_if_no_approver, v_auto_skip
    )
    ON CONFLICT (request_type, request_id, step_order) DO NOTHING;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public._snapshot_chain_for_request(TEXT, INT, INT, INT)
  TO authenticated, service_role;


-- ══════════════════════════════════════════════════════════════════════════
-- 3. _trg_snapshot_chain_generic — 傳 employee_id（有此欄的表才有值）
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_snapshot_chain_generic()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request_type TEXT;
  v_chain_id     INT;
  v_emp_id       INT;
BEGIN
  v_request_type := TG_ARGV[0];

  v_chain_id := CASE
    WHEN TG_TABLE_NAME = 'form_submissions' THEN
      (SELECT ft.approval_chain_id FROM public.form_templates ft WHERE ft.id = NEW.template_id)
    ELSE
      (to_jsonb(NEW)->>'approval_chain_id')::int
  END;

  IF v_chain_id IS NULL THEN RETURN NEW; END IF;

  -- 嘗試取 employee_id（leave/overtime 等有此欄；expense/trip 等靠 name 無此欄）
  v_emp_id := (to_jsonb(NEW)->>'employee_id')::int;

  PERFORM public._snapshot_chain_for_request(v_request_type, NEW.id, v_chain_id, v_emp_id);
  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION public._trg_snapshot_chain_generic()
  TO authenticated, service_role;


-- ══════════════════════════════════════════════════════════════════════════
-- 4. liff_approve_request — advance 後自動跳過 auto_skipped 步
--    完整重寫（base: 20260604110000）
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
      EXECUTE format('SELECT approval_chain_id, current_step, organization_id, NULL::INT, employee, status FROM %I WHERE id=$1', v_table_name)
        INTO v_chain_id, v_cur_step, v_app_org, v_app_emp_id, v_app_name, result_status USING p_id;
    END IF;

    IF v_app_name IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
    END IF;
    IF result_status NOT IN ('申請中', '待審') THEN
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
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
