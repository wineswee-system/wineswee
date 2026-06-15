-- ⚠️ 自動產生，請勿手改 —— npm run db:drift
-- 此檔是「關鍵 DB 函式」在 live DB 的定義快照。
-- git diff 此檔有變 = 有人在 DB 改了函式（可能是 Studio hotfix 沒回填 migration）。

-- ═══════════ _employee_matches_chain_step(p_emp_id integer, p_step_id integer, p_applicant_emp_id integer) ═══════════
CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(p_emp_id integer, p_step_id integer, p_applicant_emp_id integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step approval_chain_steps;
  v_emp  employees;
  v_app  employees;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_step_id;
  IF v_step.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  IF v_step.target_type = 'fixed_emp' THEN
    RETURN v_step.target_emp_id = p_emp_id;
  ELSIF v_step.target_type = 'fixed_role' THEN
    RETURN v_step.target_role_id = v_emp.role_id;
  ELSIF v_step.target_type = 'fixed_dept' THEN
    RETURN v_step.target_dept_id = v_emp.department_id;
  END IF;

  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  IF v_step.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  IF v_step.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  ELSIF v_step.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    -- ★ 加 self-fallback：門市課別督導 = 我，或（課別解不出督導 AND 我是申請人本人 AND 我本身是某課督導）
    RETURN (
      EXISTS (SELECT 1 FROM stores s
                JOIN department_sections ds ON ds.id = s.section_id
               WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id)
      OR (
        p_emp_id = v_app.id
        AND NOT EXISTS (SELECT 1 FROM stores s
                          JOIN department_sections ds ON ds.id = s.section_id
                         WHERE s.id = v_app.store_id AND ds.supervisor_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id)
      )
    );
  END IF;

  IF v_step.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_step.target_dept_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_step.target_store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM department_sections ds
                    WHERE ds.id = v_step.target_section_id AND ds.supervisor_id = p_emp_id);
  END IF;

  RETURN FALSE;
END $function$
;

-- ═══════════ _employee_matches_snapshot_step(p_emp_id integer, p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer) ═══════════
CREATE OR REPLACE FUNCTION public._employee_matches_snapshot_step(p_emp_id integer, p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snap  public.request_chain_snapshots;
  v_emp   employees;
  v_app   employees;
BEGIN
  SELECT * INTO v_snap
    FROM public.request_chain_snapshots
   WHERE request_type = p_request_type
     AND request_id   = p_request_id
     AND step_order   = p_step_order;
  IF v_snap.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  IF v_snap.target_type = 'fixed_emp'  THEN RETURN v_snap.target_emp_id  = p_emp_id; END IF;
  IF v_snap.target_type = 'fixed_role' THEN RETURN v_snap.target_role_id = v_emp.role_id; END IF;
  IF v_snap.target_type = 'fixed_dept' THEN RETURN v_snap.target_dept_id = v_emp.department_id; END IF;

  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  END IF;

  IF v_snap.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    -- ★ 加 self-fallback（與 resolve_snapshot_step_approvers 一致）
    RETURN (
      EXISTS (SELECT 1 FROM stores s
                JOIN department_sections ds ON ds.id = s.section_id
               WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id)
      OR (
        p_emp_id = v_app.id
        AND NOT EXISTS (SELECT 1 FROM stores s
                          JOIN department_sections ds ON ds.id = s.section_id
                         WHERE s.id = v_app.store_id AND ds.supervisor_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id)
      )
    );
  END IF;

  IF v_snap.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_snap.target_dept_id AND d.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_snap.target_store_id AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM department_sections ds
                    WHERE ds.id = v_snap.target_section_id AND ds.supervisor_id = p_emp_id);
  END IF;

  RETURN FALSE;
END $function$
;

-- ═══════════ classify_overtime_category_v2(p_date date, p_employee_id integer) ═══════════
CREATE OR REPLACE FUNCTION public.classify_overtime_category_v2(p_date date, p_employee_id integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_is_holiday BOOLEAN;
  v_shift      TEXT;
  v_dow        INT;
BEGIN
  IF p_date IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. 國定假日優先（不論其他）
  SELECT EXISTS (
    SELECT 1 FROM public.holidays
    WHERE date = p_date AND COALESCE(is_workday, false) = false
  ) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN 'holiday';
  END IF;

  -- 2. 看員工該日排班 shift（明確標示優先）
  IF p_employee_id IS NOT NULL THEN
    SELECT s.shift INTO v_shift
      FROM public.schedules s
      JOIN public.employees e ON e.name = s.employee
     WHERE e.id = p_employee_id
       AND s.date = p_date
     LIMIT 1;

    IF v_shift = '例假' THEN
      RETURN 'weekly_off';
    ELSIF v_shift IN ('休', '休息') THEN
      RETURN 'restday';
    END IF;
  END IF;

  -- 3. fallback 依 DOW
  v_dow := EXTRACT(DOW FROM p_date)::INT;
  IF v_dow = 0 THEN
    RETURN 'weekly_off';
  ELSIF v_dow = 6 THEN
    RETURN 'restday';
  ELSE
    RETURN 'weekday';
  END IF;
END $function$
;

-- ═══════════ expense_request_step_advance(p_id integer, p_action text, p_reason text) ═══════════
CREATE OR REPLACE FUNCTION public.expense_request_step_advance(p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_req          expense_requests;
  v_total_steps  INT;
  v_matches      boolean;
  v_extra        approval_extra_steps;
  v_has_snapshot boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_req.status NOT IN ('申請中', '待審') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING', 'current_status', v_req.status);
  END IF;

  -- 加簽 guard
  v_extra := public.get_pending_extra_step('expense_requests', p_id, COALESCE(v_req.current_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  -- 沒綁 chain → 舊行為
  IF v_req.approval_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE expense_requests SET
        status = '已核准', approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true);
    ELSE
      UPDATE expense_requests SET
        status = '已駁回', reject_reason = p_reason,
        approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回');
    END IF;
  END IF;

  -- ── 讀快照（優先）or live chain（fallback）──
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    -- 確認 current step 在快照裡存在
    IF NOT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = 'expense_request' AND request_id = p_id
         AND step_order = v_req.current_step
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND',
        'current_step', v_req.current_step, 'source', 'snapshot');
    END IF;

    -- 比對：此人是否為當前關的 approver
    SELECT public._employee_matches_snapshot_step(
      v_emp.id, 'expense_request', p_id, v_req.current_step, v_req.employee_id
    ) INTO v_matches;

    -- step 總數（從快照算）
    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_id;

  ELSE
    -- fallback：live chain（舊單）
    DECLARE v_step approval_chain_steps; BEGIN
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_req.approval_chain_id AND step_order = v_req.current_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND',
          'current_step', v_req.current_step, 'source', 'live_chain');
      END IF;
      SELECT public._employee_matches_chain_step(v_emp.id, v_step.id, v_req.employee_id)
        INTO v_matches;
    END;
    SELECT COUNT(*) INTO v_total_steps
      FROM approval_chain_steps WHERE chain_id = v_req.approval_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object(
      'ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
      'current_step', v_req.current_step
    );
  END IF;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET
      status = '已駁回', reject_reason = p_reason,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'rejected_at_step', v_req.current_step);
  END IF;

  -- approve：最後一關 → 核准；其他 → 推進
  IF v_req.current_step + 1 >= v_total_steps THEN
    UPDATE expense_requests SET
      status = '已核准', current_step = v_total_steps,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET
      current_step = current_step + 1,
      approved_by = v_emp.name
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'fully_approved', false,
                             'advanced_to_step', v_req.current_step + 1);
  END IF;
END $function$
;

-- ═══════════ expense_settle_step_advance(p_id integer, p_action text, p_reason text) ═══════════
CREATE OR REPLACE FUNCTION public.expense_settle_step_advance(p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_emp           employees;
  v_req           expense_requests;
  v_total_steps   INT;
  v_step          approval_chain_steps;
  v_matches       boolean;
  v_amount        NUMERIC;
  v_pending_extra INT;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_req.status <> '待核銷' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_SETTLE', 'current_status', v_req.status);
  END IF;

  v_amount := COALESCE(v_req.actual_amount, v_req.estimated_amount, 0);

  -- 有 pending 加簽時不允許推進
  SELECT id INTO v_pending_extra
  FROM approval_extra_steps
  WHERE source_table = 'expense_settles'
    AND source_id = p_id
    AND insert_before_step = v_req.settle_current_step
    AND status = 'pending'
  LIMIT 1;
  IF v_pending_extra IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_STEP', 'extra_step_id', v_pending_extra);
  END IF;

  -- 沒掛 settle chain → fallback：admin 一鍵 confirm
  IF v_req.settle_chain_id IS NULL THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請', v_req.id, v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET status = '已核銷', settled_by = v_emp.name, settled_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true, 'fallback', true);
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id AND step_order = v_req.settle_current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.settle_current_step);
  END IF;

  SELECT _employee_matches_chain_step(v_emp.id, v_step.id) INTO v_matches;
  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
                             'current_step', v_req.settle_current_step);
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET status = '核銷已退回', settle_reject_reason = p_reason WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷已退回', 'rejected_at_step', v_req.settle_current_step);
  END IF;

  IF v_req.settle_current_step + 1 >= v_total_steps THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請', v_req.id, v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET status = '已核銷', settle_current_step = v_total_steps,
      settled_by = v_emp.name, settled_at = NOW() WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET settle_current_step = settle_current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷中', 'fully_settled', false,
                             'advanced_to_step', v_req.settle_current_step + 1);
  END IF;
END $function$
;

-- ═══════════ form_submission_chain_approve(p_id integer, p_approver_id integer, p_action text, p_reason text, p_reject_attachments jsonb) ═══════════
CREATE OR REPLACE FUNCTION public.form_submission_chain_approve(p_id integer, p_approver_id integer, p_action text, p_reason text DEFAULT NULL::text, p_reject_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub             form_submissions;
  v_template        form_templates;
  v_chain_id        INT;
  v_has_snapshot    BOOLEAN;
  v_snap            request_chain_snapshots;
  v_step            approval_chain_steps;
  v_matches         BOOLEAN;
  v_total_steps     INT;
  v_is_last         BOOLEAN;
  v_next_label      TEXT;
  v_new_current     INT;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_sub FROM form_submissions
   WHERE id = p_id AND deleted_at IS NULL;
  IF v_sub.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_sub.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;
  v_chain_id := v_template.approval_chain_id;

  -- 沒綁 chain → 維持舊行為（直接核准/駁回）
  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE form_submissions
         SET status = '已核准', approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      UPDATE form_submissions
         SET status = '已駁回',
             reject_reason = btrim(p_reason),
             reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
             approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  -- ── 加簽 guard（不分快照/live，獨立檢查）──
  IF EXISTS (
    SELECT 1 FROM approval_extra_steps
     WHERE source_table = 'form_submissions'
       AND source_id = p_id
       AND insert_before_step = COALESCE(v_sub.current_step, 0)
       AND status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核');
  END IF;

  -- ── 快照優先 ──
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    SELECT * INTO v_snap
      FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission'
       AND request_id   = p_id
       AND step_order   = COALESCE(v_sub.current_step, 0);
    IF v_snap.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND',
        'source', 'snapshot', 'current_step', v_sub.current_step);
    END IF;

    SELECT public._employee_matches_snapshot_step(
      p_approver_id, 'form_submission', p_id,
      COALESCE(v_sub.current_step, 0), v_sub.applicant_id
    ) INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_id;

  ELSE
    -- fallback：live chain（舊單沒快照）
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = COALESCE(v_sub.current_step, 0);
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND',
        'source', 'live_chain', 'current_step', v_sub.current_step);
    END IF;

    SELECT public._employee_matches_chain_step(p_approver_id, v_step.id, v_sub.applicant_id)
      INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM approval_chain_steps WHERE chain_id = v_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- ── reject ──
  IF p_action = 'reject' THEN
    UPDATE form_submissions
       SET status = '已駁回',
           reject_reason = btrim(p_reason),
           reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
           approver_id = p_approver_id, approved_at = NOW()
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected',
      'rejected_at_step', v_sub.current_step);
  END IF;

  -- ── approve ──
  v_new_current := COALESCE(v_sub.current_step, 0) + 1;
  v_is_last     := (v_new_current >= v_total_steps);

  IF v_is_last THEN
    UPDATE form_submissions
       SET status = '已核准', approver_id = p_approver_id, approved_at = NOW(),
           current_step = v_total_steps - 1
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    UPDATE form_submissions SET current_step = v_new_current WHERE id = p_id;

    -- 下一關 label（快照優先）
    IF v_has_snapshot THEN
      SELECT COALESCE(label, role_name) INTO v_next_label
        FROM public.request_chain_snapshots
       WHERE request_type = 'form_submission' AND request_id = p_id
         AND step_order = v_new_current;
    ELSE
      SELECT COALESCE(label, role_name) INTO v_next_label
        FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_new_current;
    END IF;

    RETURN json_build_object(
      'ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_new_current, 'is_last_step', false,
      'next_step_label', v_next_label
    );
  END IF;
END $function$
;

-- ═══════════ generate_payroll(p_pay_period character, p_created_by integer) ═══════════
CREATE OR REPLACE FUNCTION public.generate_payroll(p_pay_period character, p_created_by integer DEFAULT NULL::integer)
 RETURNS TABLE(payroll_run_id integer, records_created integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_run_id      INT;
  v_count       INT := 0;
  v_year        INT;
  v_month       INT;
  v_month_start DATE;
  v_month_end   DATE;
  v_work_days   INT;
  rec           RECORD;
BEGIN
  v_year        := SPLIT_PART(p_pay_period, '-', 1)::INT;
  v_month       := SPLIT_PART(p_pay_period, '-', 2)::INT;
  v_month_start := MAKE_DATE(v_year, v_month, 1);
  v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  v_work_days := (v_month_end - v_month_start + 1)::INT;
  IF v_work_days < 1 THEN v_work_days := 1; END IF;

  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (p_pay_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  FOR rec IN
    SELECT
      e.id                                        AS employee_id,
      e.name,
      e.status,
      e.join_date,
      e.resign_date,
      e.organization_id,
      COALESCE(ss.base_salary,          0)        AS base_salary,
      COALESCE(ss.role_allowance,       0)        AS role_allowance,
      COALESCE(ss.meal_allowance,       0)        AS meal_allowance,
      COALESCE(ss.transport_allowance,  0)        AS transport_allowance,
      COALESCE(ss.attendance_bonus,     0)        AS attendance_bonus,
      COALESCE(ss.salary_type, 'monthly')         AS salary_type,
      COALESCE(ss.hourly_rate,          0)        AS hourly_rate,
      COALESCE(ss.health_ins_dependents,0)        AS health_ins_dependents,
      COALESCE(ss.custom_allowances, '[]'::jsonb) AS custom_allowances,
      e.labor_ins_grade,
      e.health_ins_grade,
      COALESCE(e.labor_insurance, false)          AS labor_insurance_enrolled,
      COALESCE(e.health_insurance, false)         AS health_insurance_enrolled,
      COALESCE(e.labor_pension_self_rate, 0)      AS pension_self_rate,
      (ss.id IS NULL)                             AS no_salary_structure
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE (e.join_date IS NULL OR e.join_date <= v_month_end)
      AND (
        e.status = '在職'
        OR (e.status = '離職'
            AND e.resign_date IS NOT NULL
            AND e.resign_date >= v_month_start
            AND e.resign_date <= v_month_end)
      )
  LOOP
    DECLARE
      v_base             NUMERIC(10,2) := rec.base_salary;
      v_role_allow       NUMERIC(10,2) := rec.role_allowance;
      v_meal             NUMERIC(10,2) := rec.meal_allowance;
      v_transport        NUMERIC(10,2) := rec.transport_allowance;
      v_attendance_bonus NUMERIC(10,2) := rec.attendance_bonus;
      v_custom_total     NUMERIC(10,2) := 0;
      v_custom_breakdown JSONB         := '[]'::jsonb;

      -- 4 桶分類
      v_ot_hours_wd  NUMERIC(5,2)  := 0;  -- weekday
      v_ot_hours_rd  NUMERIC(5,2)  := 0;  -- restday
      v_ot_hours_wo  NUMERIC(5,2)  := 0;  -- weekly_off
      v_ot_hours_ho  NUMERIC(5,2)  := 0;  -- holiday
      v_ot_pay       NUMERIC(10,2) := 0;
      v_comp_settled NUMERIC(10,2) := 0;

      v_swap_hd_hours NUMERIC(5,2) := 0;

      v_gross         NUMERIC(10,2);
      v_income_tax    NUMERIC(10,2) := 0;

      v_leave_deduction NUMERIC(10,2) := 0;
      v_leave_days      NUMERIC(4,1)  := 0;
      v_unpaid_days     NUMERIC(4,1)  := 0;
      v_unpaid_hours    NUMERIC(5,2)  := 0;
      v_half_days       NUMERIC(4,1)  := 0;
      v_half_hours      NUMERIC(5,2)  := 0;
      v_late_deduction  NUMERIC(10,2) := 0;
      v_late_mins       INT           := 0;

      v_labor_emp  NUMERIC(10,2) := 0;
      v_labor_er   NUMERIC(10,2) := 0;
      v_health_emp NUMERIC(10,2) := 0;
      v_health_er  NUMERIC(10,2) := 0;
      v_pension_emp NUMERIC(10,2) := 0;
      v_pension_er  NUMERIC(10,2) := 0;

      v_nhi_supp        NUMERIC(10,2) := 0;
      v_nhi_breakdown   JSONB         := '[]'::jsonb;
      v_insured_salary  NUMERIC(10,2) := 0;
      v_nhi_threshold   NUMERIC(12,2) := 0;

      v_unused_leave_days   NUMERIC(5,1) := 0;
      v_unused_leave_payout NUMERIC(10,2) := 0;
      v_is_final_settlement BOOLEAN := false;

      v_total_deductions NUMERIC(10,2);
      v_net_before_legal NUMERIC(10,2);
      v_legal_total      NUMERIC(10,2) := 0;
      v_legal_breakdown  JSONB         := '[]'::jsonb;
      v_net              NUMERIC(10,2);
      v_hours_worked     NUMERIC(6,2)  := 0;

      v_daily_rate  NUMERIC(10,2);
      v_hourly_rate NUMERIC(10,2);
      v_legal_rec   RECORD;
      v_legal_remaining NUMERIC(10,2);
      v_legal_to_deduct NUMERIC(10,2);
      v_legal_avail     NUMERIC(10,2);
      v_ca  JSONB;
      v_record_id INT;

      v_effective_start  DATE;
      v_effective_end    DATE;
      v_actual_work_days INT          := 0;
      v_prorate_ratio    NUMERIC(6,4) := 1;
    BEGIN
      IF rec.no_salary_structure AND rec.base_salary = 0 THEN
        RAISE NOTICE 'Employee % (%) has no salary structure, skipping', rec.employee_id, rec.name;
        CONTINUE;
      END IF;

      v_is_final_settlement := (rec.status = '離職');

      SELECT COALESCE(SUM(total_hours), 0) INTO v_hours_worked
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end;

      IF rec.salary_type = 'hourly' THEN
        v_hourly_rate      := rec.hourly_rate;
        v_base             := v_hourly_rate * v_hours_worked;
        v_daily_rate       := v_hourly_rate * 8;
        v_actual_work_days := v_work_days;
        v_prorate_ratio    := 1;
      ELSE
        v_daily_rate  := rec.base_salary / v_work_days;
        v_hourly_rate := v_daily_rate / 8;

        v_effective_start := GREATEST(COALESCE(rec.join_date, v_month_start), v_month_start);
        v_effective_end   := CASE
          WHEN rec.resign_date IS NOT NULL AND rec.resign_date <= v_month_end
          THEN rec.resign_date
          ELSE v_month_end
        END;

        IF v_effective_start > v_month_start OR v_effective_end < v_month_end THEN
          v_actual_work_days := (v_effective_end - v_effective_start + 1)::INT;
          IF v_actual_work_days < 1 THEN v_actual_work_days := 1; END IF;

          v_prorate_ratio := v_actual_work_days::NUMERIC / NULLIF(v_work_days, 0)::NUMERIC;

          v_base             := CEIL(rec.base_salary           * v_prorate_ratio);
          v_role_allow       := CEIL(rec.role_allowance        * v_prorate_ratio);
          v_meal             := CEIL(rec.meal_allowance        * v_prorate_ratio);
          v_transport        := CEIL(rec.transport_allowance   * v_prorate_ratio);
          v_attendance_bonus := CEIL(rec.attendance_bonus      * v_prorate_ratio);
        ELSE
          v_actual_work_days := v_work_days;
          v_prorate_ratio    := 1;
        END IF;
      END IF;

      IF jsonb_typeof(rec.custom_allowances) = 'array' THEN
        FOR v_ca IN SELECT * FROM jsonb_array_elements(rec.custom_allowances)
        LOOP
          v_custom_total := v_custom_total + COALESCE((v_ca->>'amount')::numeric, 0);
        END LOOP;
        v_custom_breakdown := rec.custom_allowances;
      END IF;
      IF rec.salary_type = 'monthly' AND v_prorate_ratio < 1 THEN
        v_custom_total := CEIL(v_custom_total * v_prorate_ratio);
      END IF;

      -- ── Overtime（依 ot_category 4 桶分類）──
      SELECT
        COALESCE(SUM(CASE WHEN ot_category = 'weekday'    THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ot_category = 'restday'    THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ot_category = 'weekly_off' THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ot_category = 'holiday'    THEN ot_hours ELSE 0 END), 0)
      INTO v_ot_hours_wd, v_ot_hours_rd, v_ot_hours_wo, v_ot_hours_ho
      FROM overtime_requests
      WHERE employee_id = rec.employee_id
        AND request_date >= v_month_start AND request_date <= v_month_end
        AND status = '已核准'
        AND (ot_type IS NULL OR ot_type = 'pay');

      -- shift_swap 換班落在休息/例假/國定假日 → 補進 restday 桶（保守處理）
      SELECT COALESCE(SUM(ar.total_hours), 0)
        INTO v_swap_hd_hours
        FROM attendance_records ar
       WHERE ar.employee_id = rec.employee_id
         AND ar.date >= v_month_start AND ar.date <= v_month_end
         AND ar.clock_in_mode = 'shift_swap'
         AND (
           EXTRACT(DOW FROM ar.date) IN (0, 6)
           OR EXISTS (
             SELECT 1 FROM holidays h
             WHERE h.date = ar.date AND h.is_workday = false
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM overtime_requests ot
            WHERE ot.employee_id = rec.employee_id
              AND ot.request_date = ar.date
              AND ot.status = '已核准'
         );

      v_ot_hours_rd := v_ot_hours_rd + COALESCE(v_swap_hd_hours, 0);

      -- 4 桶分開算 OT pay（依 salary_type 走 FT/PT 規則）
      v_ot_pay :=
          public._compute_ot_pay(v_ot_hours_wd, v_hourly_rate, 'weekday',    rec.salary_type)
        + public._compute_ot_pay(v_ot_hours_rd, v_hourly_rate, 'restday',    rec.salary_type)
        + public._compute_ot_pay(v_ot_hours_wo, v_hourly_rate, 'weekly_off', rec.salary_type)
        + public._compute_ot_pay(v_ot_hours_ho, v_hourly_rate, 'holiday',    rec.salary_type);

      -- ── 過期補休自動兌現 ──
      v_comp_settled := COALESCE(
        public._settle_expired_comp_time(rec.employee_id, v_run_id, v_month_end),
        0
      );
      v_ot_pay := v_ot_pay + v_comp_settled;

      -- ── Leave deduction ──
      SELECT
        COALESCE(SUM(CASE
          WHEN COALESCE(unit, 'day') = 'hour' THEN 0
          ELSE LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1
        END), 0),
        COALESCE(SUM(CASE
          WHEN COALESCE(unit, 'day') = 'hour' THEN COALESCE(hours, 0)
          ELSE 0
        END), 0)
      INTO v_unpaid_days, v_unpaid_hours
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准'
        AND type IN ('事假', '事', 'personal', '無薪假', 'unpaid');

      SELECT
        COALESCE(SUM(CASE
          WHEN COALESCE(unit, 'day') = 'hour' THEN 0
          ELSE LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1
        END), 0),
        COALESCE(SUM(CASE
          WHEN COALESCE(unit, 'day') = 'hour' THEN COALESCE(hours, 0)
          ELSE 0
        END), 0)
      INTO v_half_days, v_half_hours
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准'
        AND type IN ('病假', '病', 'sick', '生理假', '生', 'menstrual');

      v_leave_days := v_unpaid_days + v_half_days
                    + (v_unpaid_hours + v_half_hours) / 8.0;

      IF rec.salary_type = 'monthly' THEN
        v_leave_deduction := FLOOR(
          (v_unpaid_days  * v_daily_rate)
          + (v_unpaid_hours * v_hourly_rate)
          + (v_half_days  * v_daily_rate * 0.5)
          + (v_half_hours * v_hourly_rate * 0.5)
        );
      END IF;

      SELECT COALESCE(SUM(late_minutes), 0) INTO v_late_mins
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end
        AND is_late = true
        AND COALESCE(clock_in_mode, 'normal') = 'normal';

      v_late_deduction := FLOOR(FLOOR(v_late_mins / 30.0) * v_hourly_rate * 0.5);

      IF v_late_mins > 0 OR v_leave_days > 0 THEN
        v_attendance_bonus := 0;
      END IF;

      -- ── 離職結算未休特休折現 ──
      IF v_is_final_settlement THEN
        SELECT COALESCE(SUM(GREATEST(total_days + carry_over_days - used_days, 0)), 0)
          INTO v_unused_leave_days
        FROM leave_balances
        WHERE employee_id = rec.employee_id
          AND year = v_year
          AND leave_type IN ('特休', 'annual', '特別休假');

        IF rec.salary_type = 'monthly' THEN
          v_unused_leave_payout := CEIL(v_unused_leave_days * (rec.base_salary / v_work_days));
        ELSE
          v_unused_leave_payout := CEIL(v_unused_leave_days * v_hourly_rate * 8);
        END IF;
      END IF;

      v_gross := v_base + v_role_allow + v_meal + v_transport
               + v_attendance_bonus + v_ot_pay + v_custom_total
               + v_unused_leave_payout;

      -- ── 二代健保補充保費 ──
      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT insured_salary INTO v_insured_salary
        FROM health_ins_brackets
        WHERE year = v_year AND grade = rec.health_ins_grade;

        v_nhi_threshold := COALESCE(v_insured_salary, 0);

        IF v_ot_pay > v_nhi_threshold AND v_nhi_threshold > 0 THEN
          DECLARE
            v_ot_excess  NUMERIC(12,2) := v_ot_pay - v_nhi_threshold;
            v_ot_premium NUMERIC(10,2) := FLOOR(v_ot_excess * 0.0211);
          BEGIN
            v_nhi_supp := v_nhi_supp + v_ot_premium;
            v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
              'category', '加班費超額',
              'income', v_ot_pay,
              'exempt', v_nhi_threshold,
              'taxable', v_ot_excess,
              'rate', 0.0211,
              'premium', v_ot_premium
            );
          END;
        END IF;

        IF v_nhi_threshold > 0 THEN
          DECLARE
            v_bonus_this_month   NUMERIC(12,2) := 0;
            v_threshold_4x       NUMERIC(12,2) := v_nhi_threshold * 4;
            v_prev_cumul         NUMERIC(12,2) := 0;
            v_new_cumul          NUMERIC(12,2);
            v_taxable_this_month NUMERIC(12,2) := 0;
            v_bonus_premium      NUMERIC(10,2);
          BEGIN
            v_bonus_this_month := v_attendance_bonus;

            IF v_bonus_this_month > 0 THEN
              SELECT cumulative_bonus INTO v_prev_cumul
                FROM annual_bonus_tracker
               WHERE employee_id = rec.employee_id AND year = v_year;
              v_prev_cumul := COALESCE(v_prev_cumul, 0);
              v_new_cumul  := v_prev_cumul + v_bonus_this_month;

              IF v_new_cumul > v_threshold_4x AND v_prev_cumul < v_threshold_4x THEN
                v_taxable_this_month := v_new_cumul - v_threshold_4x;
              ELSIF v_prev_cumul >= v_threshold_4x THEN
                v_taxable_this_month := v_bonus_this_month;
              END IF;

              IF v_taxable_this_month > 0 THEN
                v_bonus_premium := FLOOR(v_taxable_this_month * 0.0211);
                v_nhi_supp := v_nhi_supp + v_bonus_premium;
                v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
                  'category', '高額獎金累計',
                  'income', v_bonus_this_month,
                  'cumulative', v_new_cumul,
                  'threshold_4x', v_threshold_4x,
                  'taxable', v_taxable_this_month,
                  'rate', 0.0211,
                  'premium', v_bonus_premium
                );
              END IF;

              INSERT INTO annual_bonus_tracker (
                employee_id, year, organization_id,
                cumulative_bonus, insured_salary, threshold,
                exceeded_at
              ) VALUES (
                rec.employee_id, v_year, rec.organization_id,
                v_new_cumul, v_nhi_threshold, v_threshold_4x,
                CASE WHEN v_new_cumul > v_threshold_4x THEN NOW() ELSE NULL END
              )
              ON CONFLICT (employee_id, year) DO UPDATE SET
                cumulative_bonus = EXCLUDED.cumulative_bonus,
                insured_salary   = EXCLUDED.insured_salary,
                threshold        = EXCLUDED.threshold,
                exceeded_at      = COALESCE(annual_bonus_tracker.exceeded_at, EXCLUDED.exceeded_at),
                updated_at       = NOW();
            END IF;
          END;
        END IF;
      END IF;

      v_income_tax := public._calc_monthly_withholding(v_gross);

      -- ── Insurance（toggle + 動態級距）──
      DECLARE
        v_base_for_insure NUMERIC(10,2) :=
          v_base + v_role_allow + v_meal + v_transport + v_attendance_bonus + v_custom_total;
      BEGIN
        -- 勞保
        IF NOT rec.labor_insurance_enrolled THEN
          v_labor_emp := 0; v_labor_er := 0;
        ELSIF rec.labor_ins_grade IS NOT NULL THEN
          SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
          FROM labor_ins_brackets
          WHERE year = v_year AND grade = rec.labor_ins_grade;
        ELSE
          SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
          FROM labor_ins_brackets
          WHERE year = v_year AND insured_salary >= v_base_for_insure
          ORDER BY insured_salary ASC LIMIT 1;
          IF v_labor_emp IS NULL THEN
            SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
            FROM labor_ins_brackets
            WHERE year = v_year
            ORDER BY insured_salary DESC LIMIT 1;
          END IF;
        END IF;

        -- 健保
        IF NOT rec.health_insurance_enrolled THEN
          v_health_emp := 0; v_health_er := 0;
        ELSIF rec.health_ins_grade IS NOT NULL THEN
          SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
          FROM health_ins_brackets
          WHERE year = v_year AND grade = rec.health_ins_grade;
          v_health_emp := v_health_emp * (1 + rec.health_ins_dependents);
        ELSE
          SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
          FROM health_ins_brackets
          WHERE year = v_year AND insured_salary >= v_base_for_insure
          ORDER BY insured_salary ASC LIMIT 1;
          IF v_health_emp IS NULL THEN
            SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
            FROM health_ins_brackets
            WHERE year = v_year
            ORDER BY insured_salary DESC LIMIT 1;
          END IF;
          v_health_emp := v_health_emp * (1 + rec.health_ins_dependents);
        END IF;
      END;

      v_pension_er  := CEIL(LEAST(v_base, 150000) * 0.06);
      v_pension_emp := FLOOR(LEAST(v_base, 150000) * (rec.pension_self_rate / 100.0));

      v_total_deductions := v_leave_deduction + v_late_deduction
                          + v_labor_emp + v_health_emp + v_pension_emp
                          + v_income_tax + v_nhi_supp;

      v_net_before_legal := v_gross - v_total_deductions;
      v_legal_avail      := GREATEST(v_net_before_legal, 0);

      FOR v_legal_rec IN
        SELECT id, title, monthly_amount, total_amount, paid_amount, paid_months
        FROM legal_deductions
        WHERE employee_id = rec.employee_id
          AND status = '進行中'
          AND started_month <= p_pay_period
        ORDER BY id
      LOOP
        v_legal_remaining := v_legal_rec.total_amount - v_legal_rec.paid_amount;
        v_legal_to_deduct := LEAST(v_legal_rec.monthly_amount, v_legal_remaining);
        v_legal_to_deduct := LEAST(v_legal_to_deduct, v_legal_avail);
        v_legal_to_deduct := GREATEST(v_legal_to_deduct, 0);

        IF v_legal_to_deduct > 0 THEN
          UPDATE legal_deductions
             SET paid_amount = paid_amount + v_legal_to_deduct,
                 paid_months = paid_months + 1,
                 status      = CASE
                                 WHEN (paid_amount + v_legal_to_deduct) >= total_amount THEN '已完成'
                                 ELSE status
                               END,
                 updated_at  = NOW()
           WHERE id = v_legal_rec.id;

          v_legal_total := v_legal_total + v_legal_to_deduct;
          v_legal_avail := v_legal_avail - v_legal_to_deduct;
        END IF;

        v_legal_breakdown := v_legal_breakdown || jsonb_build_object(
          'id',             v_legal_rec.id,
          'title',          v_legal_rec.title,
          'monthly_amount', v_legal_rec.monthly_amount,
          'amount',         v_legal_to_deduct,
          'shortfall',      v_legal_rec.monthly_amount - v_legal_to_deduct
        );

        EXIT WHEN v_legal_avail <= 0;
      END LOOP;

      v_total_deductions := v_total_deductions + v_legal_total;
      v_net              := CEIL(v_gross - v_total_deductions);

      -- ── Insert payroll_record ──
      -- ot_hours_weekday = weekday；ot_hours_holiday = restday + weekly_off + holiday 合併（顯示用）
      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        base_salary, role_allowance, meal_allowance, transport_allowance,
        attendance_bonus_earned, overtime_pay, ot_hours_weekday, ot_hours_holiday,
        custom_allowances_total, custom_allowances_breakdown,
        gross_salary,
        income_tax_withheld,
        leave_deduction, leave_days_deducted, late_deduction, late_minutes,
        labor_ins_employee, health_ins_employee, labor_pension_employee,
        nhi_supplementary, nhi_supplementary_breakdown,
        unused_leave_payout, unused_leave_days, is_final_settlement,
        legal_deduction_total, legal_deduction_breakdown,
        total_deductions,
        labor_ins_employer, health_ins_employer, labor_pension_employer,
        net_salary, hours_worked,
        prorate_ratio, actual_work_days
      ) VALUES (
        v_run_id, rec.employee_id, p_pay_period,
        v_base, v_role_allow, v_meal, v_transport,
        v_attendance_bonus, v_ot_pay, v_ot_hours_wd, (v_ot_hours_rd + v_ot_hours_wo + v_ot_hours_ho),
        v_custom_total, v_custom_breakdown,
        v_gross,
        v_income_tax,
        v_leave_deduction, v_leave_days, v_late_deduction, v_late_mins,
        v_labor_emp, v_health_emp, v_pension_emp,
        v_nhi_supp, v_nhi_breakdown,
        v_unused_leave_payout, v_unused_leave_days, v_is_final_settlement,
        v_legal_total, v_legal_breakdown,
        v_total_deductions,
        v_labor_er, v_health_er, v_pension_er,
        v_net, v_hours_worked,
        v_prorate_ratio, v_actual_work_days
      ) RETURNING id INTO v_record_id;

      IF v_nhi_supp > 0 THEN
        INSERT INTO nhi_supplementary_records (
          payroll_record_id, employee_id, pay_period, organization_id,
          income_category, income_amount, exempt_amount, taxable_amount,
          rate, premium_amount
        )
        SELECT
          v_record_id, rec.employee_id, p_pay_period, rec.organization_id,
          (item->>'category'),
          (item->>'income')::numeric,
          COALESCE((item->>'exempt')::numeric, 0),
          (item->>'taxable')::numeric,
          (item->>'rate')::numeric,
          (item->>'premium')::numeric
        FROM jsonb_array_elements(v_nhi_breakdown) AS item
        WHERE (item->>'premium')::numeric > 0;
      END IF;

      v_count := v_count + 1;
    END;
  END LOOP;

  payroll_run_id  := v_run_id;
  records_created := v_count;
  RETURN NEXT;
END;
$function$
;

-- ═══════════ hr_chain_approve(p_table text, p_id integer, p_approver_id integer, p_action text, p_reason text) ═══════════
CREATE OR REPLACE FUNCTION public.hr_chain_approve(p_table text, p_id integer, p_approver_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ═══════════ liff_approve_request(p_line_user_id text, p_type text, p_id integer, p_action text, p_reason text) ═══════════
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
      -- snapshot 優先
      v_snap_matches := FALSE;
      IF p_type IN ('leave','overtime','trip','correction') THEN
        DECLARE v_snap_rt TEXT := CASE p_type
          WHEN 'leave'      THEN 'leave_request'
          WHEN 'overtime'   THEN 'overtime_request'
          WHEN 'trip'       THEN 'trip'
          WHEN 'correction' THEN 'correction'
        END;
        BEGIN
          SELECT EXISTS(
            SELECT 1 FROM public.request_chain_snapshots
             WHERE request_type = v_snap_rt AND request_id = p_id
          ) INTO v_has_snapshot;
          IF v_has_snapshot THEN
            SELECT public._employee_matches_snapshot_step(
              emp.id,
              v_snap_rt, p_id, v_cur_step, v_app_emp_id
            ) INTO v_snap_matches;
            IF NOT v_snap_matches THEN
              RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN',
                'source', 'snapshot', 'current_step', v_cur_step);
            END IF;
          END IF;
        END;
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

    -- ★ 加簽守衛（對齊 expense_settle_step_advance 的邏輯）
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

    -- ★ snapshot 優先 step 比對
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
      -- fallback live chain
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

-- ═══════════ liff_list_pending_approvals(p_line_user_id text) ═══════════
CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp    employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'expense_settles','[]'::json,
      'resignation_requests','[]'::json,'leave_of_absence_requests','[]'::json,
      'personnel_transfer_requests','[]'::json,'headcount_requests','[]'::json,
      'form_submissions','[]'::json,
      'task_confirmations','[]'::json,
      'shift_swaps_for_peer','[]'::json,'shift_swaps_for_manager','[]'::json,
      'off_requests','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
    );
  END IF;

  SELECT json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(
        (to_jsonb(l.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_requests', l.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', l.employee_id = emp.id
        ))::json ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND l.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(
        (to_jsonb(o.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('overtime_requests', o.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', o.employee_id = emp.id
        ))::json ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND o.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(
        (to_jsonb(t.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('business_trips', t.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND t.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),
    'corrections', (
      SELECT COALESCE(json_agg(
        (to_jsonb(c.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('clock_corrections', c.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND c.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),
    'expenses', (
      -- expenses 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(
        (to_jsonb(ex.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('expenses', ex.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
          OR public._has_pending_extra_for_me('expenses', ex.id, emp.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department, 'title', er.title,
        'description', er.description, 'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store, 'status', er.status, 'created_at', er.created_at,
        'reject_reason', er.reject_reason,
        'approval_chain_id', er.approval_chain_id, 'current_step', er.current_step,
        'chain_name', ac.name,
        'chain_total_steps', (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.approval_chain_id),
        'my_step_label', cur_step.label,
        'my_approver_role', CASE
          WHEN er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id) THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('expense_requests', er.id, emp.id) THEN 'extra_signer'
          ELSE NULL
        END,
        'is_self_approve', er.employee_id = emp.id
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(
        (to_jsonb(er.*) || jsonb_build_object(
          'my_step_label', cur_step.label,
          'my_approver_role', cur_step.target_type,
          'is_self_approve', er.employee_id = emp.id
        ))::json ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      -- resignation_requests 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('resignation_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(h.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('headcount_requests', h.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', h.employee_id = emp.id
        ))::json ORDER BY h.created_at DESC), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
        AND h.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id))
          OR public._has_pending_extra_for_me('headcount_requests', h.id, emp.id))
    ),
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', s.id, 'template_id', s.template_id, 'template_name', t.name,
        'template_fields', t.fields,
        'applicant_id', s.applicant_id, 'applicant_name', e_app.name,
        'data', s.data, 'status', s.status, 'created_at', s.created_at,
        'current_step', s.current_step,
        'chain_id', t.approval_chain_id,
        'my_step_label', cur_step.label,
        'my_approver_role', CASE
          WHEN t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id) THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('form_submissions', s.id, emp.id) THEN 'extra_signer'
          ELSE NULL
        END,
        'is_self_approve', s.applicant_id = emp.id,
        'attachments', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', a.id, 'file_name', a.file_name,
            'storage_bucket', a.storage_bucket, 'storage_path', a.storage_path,
            'mime_type', a.mime_type, 'file_size', a.file_size
          ) ORDER BY a.created_at), '[]'::json)
          FROM public.form_attachments a
          WHERE a.form_type = 'form_submissions' AND a.form_id = s.id
        )
      ) ORDER BY s.created_at DESC), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.employees e_app ON e_app.id = s.applicant_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = t.approval_chain_id AND cur_step.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id AND s.status = '申請中'
        AND s.deleted_at IS NULL  -- ★ soft-delete filter
        AND (
          (t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id))
          OR public._has_pending_extra_for_me('form_submissions', s.id, emp.id)
        )
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待對方同意'
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ss.target_id = emp.id AND ss.requester_id <> emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json) FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND ofr.deleted_at IS NULL  -- ★ soft-delete filter
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
        AND COALESCE(ofr.employee_id, -1) <> emp.id
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (public.liff_employee_has_permission(emp.id, 'expense.approve') OR public.liff_employee_has_permission(emp.id, 'expense.settle'))
    )
  ) INTO result;
  RETURN result;
END
$function$
;

-- ═══════════ resolve_snapshot_step_approvers(p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer) ═══════════
CREATE OR REPLACE FUNCTION public.resolve_snapshot_step_approvers(p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer)
 RETURNS TABLE(emp_id integer, emp_name text, line_user_id text, channel_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snap          public.request_chain_snapshots;
  v_app           employees;
  v_target_emp_id INT;
  v_section_id    INT;
  v_store_id      INT;
BEGIN
  SELECT * INTO v_snap
    FROM public.request_chain_snapshots
   WHERE request_type = p_request_type
     AND request_id   = p_request_id
     AND step_order   = p_step_order;
  IF v_snap.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;

  -- ─────── fixed_* ───────
  IF v_snap.target_type = 'fixed_emp' AND v_snap.target_emp_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.id = v_snap.target_emp_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_snap.target_type = 'fixed_role' AND v_snap.target_role_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.role_id = v_snap.target_role_id AND e.status = '在職'
        AND (v_app.organization_id IS NULL OR e.organization_id = v_app.organization_id);
    RETURN;
  END IF;

  IF v_snap.target_type = 'fixed_dept' AND v_snap.target_dept_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.department_id = v_snap.target_dept_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_app.id IS NULL THEN RETURN; END IF;

  -- ─────── applicant_* ───────
  IF v_snap.target_type = 'applicant_supervisor' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_dept_manager' AND v_app.department_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_app.department_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_store_manager' AND v_app.store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.store_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e
      WHERE e.store_id = v_app.store_id
        AND e.position = '督導'
        AND e.status = '在職';
    RETURN;
  END IF;

  -- applicant_section_supervisor（含 self-fallback — 課督導/經理自己申請時回傳自己）
  IF v_snap.target_type = 'applicant_section_supervisor' THEN
    IF v_app.store_id IS NOT NULL THEN
      SELECT s.section_id INTO v_section_id FROM stores s WHERE s.id = v_app.store_id;
      IF v_section_id IS NOT NULL THEN
        SELECT ds.supervisor_id INTO v_target_emp_id
          FROM department_sections ds WHERE ds.id = v_section_id;
        IF v_target_emp_id IS NOT NULL THEN
          RETURN QUERY
            SELECT e.id, e.name,
              (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
              (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
            FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
          RETURN;
        END IF;
      END IF;
    END IF;
    -- ★ self-fallback：申請人本身是課督導 → 回傳自己
    IF EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id) THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_app.id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ─────── specific_* ───────
  IF v_snap.target_type = 'specific_dept_manager' AND v_snap.target_dept_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_snap.target_dept_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'specific_store_manager' AND v_snap.target_store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_snap.target_store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'specific_section_supervisor' AND v_snap.target_section_id IS NOT NULL THEN
    SELECT ds.supervisor_id INTO v_target_emp_id
      FROM department_sections ds WHERE ds.id = v_snap.target_section_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ─────── 商品調撥 dynamic target ───────
  IF v_snap.target_type IN ('transfer_in_store_manager', 'transfer_out_store_manager') THEN
    v_store_id := public._goods_transfer_target_store(p_request_id,
      CASE v_snap.target_type WHEN 'transfer_in_store_manager' THEN 'to' ELSE 'from' END);
    IF v_store_id IS NOT NULL THEN
      SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_store_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY
          SELECT e.id, e.name,
            (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
            (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type IN ('transfer_in_store_supervisor', 'transfer_out_store_supervisor') THEN
    v_store_id := public._goods_transfer_target_store(p_request_id,
      CASE v_snap.target_type WHEN 'transfer_in_store_supervisor' THEN 'to' ELSE 'from' END);
    IF v_store_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e
        WHERE e.store_id = v_store_id
          AND e.position = '督導'
          AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'warehouse_supervisor' THEN
    SELECT d.manager_id INTO v_target_emp_id
      FROM departments d
     WHERE d.name = '倉儲物流部'
       AND (v_app.organization_id IS NULL OR d.organization_id = v_app.organization_id)
     LIMIT 1;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  RETURN;
END $function$
;

-- ═══════════ security_health_check() ═══════════
CREATE OR REPLACE FUNCTION public.security_health_check()
 RETURNS TABLE(severity text, category text, object text, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH org_tables AS (
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
  ),
  pol AS (
    SELECT
      p.tablename, p.policyname, p.cmd, p.qual, p.with_check, p.roles,
      ('anon' = ANY(p.roles) OR 'public' = ANY(p.roles)) AS targets_anon,
      ('authenticated' = ANY(p.roles) OR 'public' = ANY(p.roles)) AS targets_auth,
      CASE p.cmd
        WHEN 'SELECT' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'SELECT')
        WHEN 'INSERT' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'INSERT')
        WHEN 'UPDATE' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'UPDATE')
        WHEN 'DELETE' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'DELETE')
        WHEN 'ALL'    THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'SELECT')
                        OR has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'INSERT')
        ELSE false
      END AS anon_has_grant,
      -- qual/with_check 是否「真的放行 anon」（true 或 null = 無過濾）
      CASE p.cmd
        WHEN 'SELECT' THEN p.qual = 'true'
        WHEN 'DELETE' THEN p.qual = 'true'
        WHEN 'UPDATE' THEN p.qual = 'true' OR p.with_check = 'true'
        WHEN 'INSERT' THEN p.with_check IS NULL OR p.with_check = 'true'
        WHEN 'ALL'    THEN p.qual = 'true' OR p.with_check = 'true'
                        OR (p.qual IS NULL AND p.with_check IS NULL)
        ELSE false
      END AS is_permissive
    FROM pg_policies p
    WHERE p.schemaname = 'public'
  )

  -- 1. 🔴 致命：anon 有 grant + 給 anon + qual/with_check 真的放行
  SELECT '🔴 致命(anon公網可達)'::text, 'anon直達'::text,
         (pol.tablename || ' / ' || pol.policyname)::text,
         ('cmd=' || pol.cmd || '  放行='
          || CASE pol.cmd WHEN 'INSERT' THEN COALESCE(left(pol.with_check,30),'NULL(無check)')
                          ELSE COALESCE(left(pol.qual,30),'NULL') END)::text
  FROM pol
  WHERE pol.targets_anon AND pol.anon_has_grant AND pol.is_permissive

  UNION ALL
  -- 2. 🟠 高：登入者跨租戶（USING(true) + authenticated 可達）
  SELECT '🟠 高(登入者跨租戶)', '完全開放USING(true)',
         (pol.tablename || ' / ' || pol.policyname),
         ('cmd=' || pol.cmd || ' — 任何登入者(不分org)全' ||
          CASE pol.cmd WHEN 'SELECT' THEN '看' ELSE '改' END)
  FROM pol
  WHERE pol.qual = 'true' AND pol.cmd IN ('SELECT', 'ALL')
    AND pol.targets_auth
    AND NOT (pol.targets_anon AND pol.anon_has_grant AND pol.is_permissive)

  UNION ALL
  -- 3. 🔴 致命：org 表沒 RLS 且 anon/authenticated 拿得到 grant（裸表）
  SELECT '🔴 致命(裸表無RLS)',
         CASE WHEN has_table_privilege('anon', ('public.'||c.relname)::regclass, 'SELECT')
              THEN '裸表-anon可讀' ELSE '裸表-登入者可讀' END,
         ('public.' || c.relname),
         '有 organization_id 但 RLS 未啟用 → 無任何過濾'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    AND c.relname IN (SELECT table_name FROM org_tables)
    AND ( has_table_privilege('anon', c.oid, 'SELECT')
       OR has_table_privilege('authenticated', c.oid, 'SELECT') )

  UNION ALL
  -- 4. 🟡 中：SECURITY DEFINER + anon 可執行 + 收 p_org_id（確認內部有 org guard）
  SELECT '🟡 中(DEFINER繞RLS)', 'DEFINER+anon+org參數',
         (n.nspname || '.' || pr.proname),
         'SECURITY DEFINER 又給 anon、又收 p_org_id — 確認內部有 org guard'
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.prosecdef
    AND pr.proargnames @> ARRAY['p_org_id']
    AND has_function_privilege('anon', pr.oid, 'EXECUTE')

  UNION ALL
  -- 5. 🔵 低：anon 有 grant 但 qual 應已過濾（人工複查，留意含 "IS NULL" 的洩漏 null-org 列）
  SELECT '🔵 低(anon有grant待複查)', 'anon-qual應已過濾',
         (pol.tablename || ' / ' || pol.policyname),
         ('cmd=' || pol.cmd || '  qual=' || COALESCE(left(pol.qual,50),'NULL')
          || CASE WHEN pol.qual ILIKE '%is null%' THEN '  ⚠️含IS NULL' ELSE '' END)
  FROM pol
  WHERE pol.targets_anon AND pol.anon_has_grant AND NOT pol.is_permissive
    AND pol.cmd IN ('SELECT', 'ALL')
$function$
;

