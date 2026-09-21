-- ════════════════════════════════════════════════════════════
-- 修嚴重 bug：_employee_matches_chain_step 還在用舊 enum
--
-- 症狀：簽核中心 (LIFF Approve) 看不到 expense_request 待審；
--       expense_request_step_advance 永遠 NOT_AUTHORIZED_FOR_STEP；
--       hr_chain_approve 永遠 NOT_YOUR_TURN
--       → 任何 chain step 簽核者都看不到 / 不能簽 expense_request 跟 B 類 HR forms
--
-- Root cause：
--   _employee_matches_chain_step (20260426010000) 用舊 enum 判斷：
--     target_type IN ('employee', 'department', 'role')
--   但 20260508060000_form_chain_complete.sql 已把所有 chain step backfill 成新 enum：
--     ('fixed_emp','fixed_role','fixed_dept',
--      'applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
--      'specific_dept_manager','specific_store_manager','specific_section_supervisor')
--   舊值不存在 → OR 條件永遠 false → 函式永遠回 false
--
-- 修法：
--   1. 重寫 _employee_matches_chain_step 對齊 9 種新 target_type
--      新加 p_applicant_emp_id 參數（DEFAULT NULL），給 applicant_xxx 類用來解動態目標
--      既有兩參數呼叫不影響（applicant_xxx 類沒 applicant 會回 false，但 fixed_xxx 類仍 work）
--   2. 更新關鍵 caller 傳 applicant_emp_id：
--      - liff_list_pending_approvals (expense_request 那段)
--      - expense_request_step_advance
--      - hr_chain_approve (B 類)
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 重寫 _employee_matches_chain_step ═══
CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(
  p_emp_id            INT,
  p_step_id           INT,
  p_applicant_emp_id  INT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step approval_chain_steps;
  v_emp  employees;
  v_app  employees;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_step_id;
  IF v_step.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  -- ── 寫死指定（fixed_*） ──
  IF v_step.target_type = 'fixed_emp' THEN
    RETURN v_step.target_emp_id = p_emp_id;
  ELSIF v_step.target_type = 'fixed_role' THEN
    RETURN v_step.target_role_id = v_emp.role_id;
  ELSIF v_step.target_type = 'fixed_dept' THEN
    RETURN v_step.target_dept_id = v_emp.department_id;
  END IF;

  -- 以下類型需要 applicant context
  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  -- ── 申請人連動（applicant_*） ──
  IF v_step.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM departments d
       WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id
    );
  ELSIF v_step.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM stores s
       WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id
    );
  ELSIF v_step.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM stores s
       JOIN department_sections ds ON ds.id = s.section_id
       WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id
    );
  END IF;

  -- ── 特定單位主管（specific_*）：不需 applicant ──
  IF v_step.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (
      SELECT 1 FROM departments d
       WHERE d.id = v_step.target_dept_id AND d.manager_id = p_emp_id
    );
  ELSIF v_step.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (
      SELECT 1 FROM stores s
       WHERE s.id = v_step.target_store_id AND s.manager_id = p_emp_id
    );
  ELSIF v_step.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (
      SELECT 1 FROM department_sections ds
       WHERE ds.id = v_step.target_section_id AND ds.supervisor_id = p_emp_id
    );
  END IF;

  RETURN FALSE;
END $$;

GRANT EXECUTE ON FUNCTION public._employee_matches_chain_step(INT, INT, INT)
  TO authenticated, anon, service_role;


-- ═══ 2. 更新 liff_list_pending_approvals 的 expense_request 那段傳 applicant ═══
-- 全函式重寫（其他段落不變）
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
      WHERE l.organization_id = emp.organization_id
        AND l.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.organization_id = emp.organization_id
        AND t.status = '待審核'
        AND emp.id IN (
          SELECT public._resolve_hr_approver_ids(
            COALESCE(
              (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1),
              -1
            )
          )
        )
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app
        ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      WHERE c.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(ex.*) ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app
        ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      WHERE ex.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id))
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
        ON cur_step.chain_id = er.approval_chain_id
       AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '申請中'
        AND er.approval_chain_id IS NOT NULL
        AND cur_step.id IS NOT NULL
        -- ★ 傳 applicant_emp_id 給 _employee_matches_chain_step 解動態目標
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待對方同意'
        AND ss.target_id = emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待主管核准'
        AND (
          EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
          OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
        )
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json)
      FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id
        AND ofr.status = '待審核'
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


-- ═══ 3. 更新 expense_request_step_advance 傳 applicant ═══
CREATE OR REPLACE FUNCTION public.expense_request_step_advance(
  p_id     INT,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_req          expense_requests;
  v_total_steps  INT;
  v_step         approval_chain_steps;
  v_matches      boolean;
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

  -- 沒綁 chain → 退回到舊行為
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

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.approval_chain_id AND step_order = v_req.current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.current_step);
  END IF;

  -- ★ 傳 applicant_emp_id (v_req.employee_id) 解動態目標
  SELECT _employee_matches_chain_step(v_emp.id, v_step.id, v_req.employee_id) INTO v_matches;
  IF NOT v_matches THEN
    RETURN json_build_object(
      'ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
      'current_step', v_req.current_step, 'expected_role', v_step.role_name
    );
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_req.approval_chain_id;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET
      status = '已駁回', reject_reason = p_reason,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'rejected_at_step', v_req.current_step);
  END IF;

  IF v_req.current_step + 1 >= v_total_steps THEN
    UPDATE expense_requests SET
      status = '已核准', current_step = v_total_steps,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET current_step = current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'fully_approved', false,
                             'advanced_to_step', v_req.current_step + 1);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.expense_request_step_advance(INT, TEXT, TEXT) TO authenticated;


-- ═══ 4. 更新 hr_chain_approve 傳 applicant ═══
-- 注意：原版 hr_chain_approve 是 (text, int, int, text, text)；這裡只重寫驗證那行
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

  -- ★ 傳 applicant (v_record.employee_id) 解動態目標
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

    -- ★ 同樣傳 applicant_emp_id 給 _employee_matches_chain_step
    SELECT array_agg(e.id) INTO v_next_ids FROM employees e
     WHERE e.status = '在職'
       AND e.organization_id = v_record.organization_id
       AND public._employee_matches_chain_step(e.id, v_next_step.id, v_record.employee_id);

    SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_json
      FROM employees WHERE id = ANY(COALESCE(v_next_ids, ARRAY[]::INT[]));

    RETURN json_build_object(
      'ok', true, 'status', '申請中', 'event', 'advanced',
      'advanced_to_step', v_cur_step + 1,
      'is_last_step', false,
      'next_approvers', COALESCE(v_next_json, '[]'::json)
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.hr_chain_approve(text, int, int, text, text) TO authenticated;


-- ═══ 5. hr_chain_resolve_first_approvers 也傳 applicant ═══
CREATE OR REPLACE FUNCTION public.hr_chain_resolve_first_approvers(
  p_table     text,
  p_id        int
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table_name text;
  v_chain_id   int;
  v_cur_step   int;
  v_org_id     int;
  v_emp_id     int;
  v_step       record;
  v_ids        int[];
  v_result     json;
BEGIN
  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN RETURN '[]'::json; END IF;

  EXECUTE format('SELECT approval_chain_id, current_step, organization_id, employee_id FROM %I WHERE id=$1', v_table_name)
    INTO v_chain_id, v_cur_step, v_org_id, v_emp_id USING p_id;

  IF v_chain_id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = v_cur_step;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT array_agg(e.id) INTO v_ids FROM employees e
   WHERE e.status = '在職' AND e.organization_id = v_org_id
     AND public._employee_matches_chain_step(e.id, v_step.id, v_emp_id);

  SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_result
    FROM employees WHERE id = ANY(COALESCE(v_ids, ARRAY[]::INT[]));

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.hr_chain_resolve_first_approvers(text, int) TO authenticated;


-- ═══ 6. liff_resolve_chain_first_approvers 也傳 applicant (給 expense_request 用) ═══
CREATE OR REPLACE FUNCTION public.liff_resolve_chain_first_approvers(p_request_id INT)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_er record;
  v_step record;
  v_ids INT[];
  v_result json;
BEGIN
  SELECT * INTO v_er FROM expense_requests WHERE id = p_request_id;
  IF v_er.approval_chain_id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT * INTO v_step
    FROM approval_chain_steps
   WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  -- ★ 傳 applicant_emp_id (v_er.employee_id)
  SELECT array_agg(e.id) INTO v_ids FROM employees e
   WHERE e.status = '在職' AND e.organization_id = v_er.organization_id
     AND public._employee_matches_chain_step(e.id, v_step.id, v_er.employee_id);

  SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_result
    FROM employees WHERE id = ANY(COALESCE(v_ids, ARRAY[]::INT[]));

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_resolve_chain_first_approvers(INT) TO authenticated, anon;


COMMIT;

NOTIFY pgrst, 'reload schema';
