-- ================================================
-- LIFF RPC — 審核中心（Approve.jsx 用）
--
-- 1. liff_employee_has_permission(emp_id, perm_code)
--    接主系統 role_permissions；super_admin 永遠 true。
--
-- 2. liff_list_pending_approvals(p_line_user_id)
--    回傳同 organization 內，當前使用者依 RBAC 有權審核的五種單據。
--
-- 3. liff_approve_request(p_line_user_id, p_type, p_id, p_action, p_reason)
--    五種單據統一入口。p_type: leave/overtime/trip/expense/correction
--    p_action: approve/reject
--
-- 權限對照：
--   leave/overtime/trip/correction → 'leave.approve'
--   expense                         → 'finance.edit'
--
-- 所有 RPC：SECURITY DEFINER + GRANT anon, authenticated
-- ================================================

-- ── 1. Permission helper (接主系統 RBAC) ────────────────────
CREATE OR REPLACE FUNCTION public.liff_employee_has_permission(
  p_emp_id  int,
  p_perm_code text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    -- super_admin 一律放行（保險絲；reseed 有給全部權限，這邊只是多一道防線）
    SELECT 1 FROM employees e
    JOIN roles r ON r.id = e.role_id
    WHERE e.id = p_emp_id AND r.name = 'super_admin'
  )
  OR EXISTS (
    SELECT 1 FROM employees e
    JOIN role_permissions rp ON rp.role_id = e.role_id
    JOIN permissions p        ON p.id = rp.permission_id
    WHERE e.id = p_emp_id AND p.code = p_perm_code
  );
$$;

-- ── 2. 列出可審核清單 ────────────────────────────────────────
-- 只回傳同 organization 內的單據；前端 tab 自己分桶。
-- expenses 沒 organization_id → 改用 employee.name → employee.org 解同 org。
CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  can_hr   boolean;
  can_fin  boolean;
  result   json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json
    );
  END IF;

  can_hr  := public.liff_employee_has_permission(emp.id, 'leave.approve');
  can_fin := public.liff_employee_has_permission(emp.id, 'finance.edit');

  SELECT json_build_object(
    'leaves', CASE WHEN can_hr THEN (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      WHERE l.organization_id = emp.organization_id
    ) ELSE '[]'::json END,
    'overtimes', CASE WHEN can_hr THEN (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE o.organization_id = emp.organization_id
    ) ELSE '[]'::json END,
    'trips', CASE WHEN can_hr THEN (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.organization_id = emp.organization_id
    ) ELSE '[]'::json END,
    'expenses', CASE WHEN can_fin THEN (
      SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.created_at DESC), '[]'::json)
      FROM public.expenses e
      WHERE EXISTS (
        SELECT 1 FROM public.employees e2
        WHERE e2.name = e.employee AND e2.organization_id = emp.organization_id
      )
    ) ELSE '[]'::json END,
    'corrections', CASE WHEN can_hr THEN (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      WHERE EXISTS (
        SELECT 1 FROM public.employees e2
        WHERE e2.name = c.employee AND e2.organization_id = emp.organization_id
      )
    ) ELSE '[]'::json END,
    'can', json_build_object('hr', can_hr, 'finance', can_fin)
  ) INTO result;

  RETURN result;
END $$;

-- ── 3. 核准/駁回 統一入口 ────────────────────────────────────
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
  emp         employees;
  perm_code   text;
  new_status  text;
  reject_val  text;
  n           int;
  correction  record;
  existing_att record;
  new_in      time;
  new_out     time;
BEGIN
  -- ── 解身分 ──
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- ── 基本參數驗證 ──
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  -- ── 依類型決定權限代碼 / 最終 status ──
  CASE p_type
    WHEN 'leave'      THEN perm_code := 'leave.approve';
                           new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    WHEN 'overtime'   THEN perm_code := 'leave.approve';
                           new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    WHEN 'trip'       THEN perm_code := 'leave.approve';
                           new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已駁回' END;
    WHEN 'expense'    THEN perm_code := 'finance.edit';
                           new_status := CASE p_action WHEN 'approve' THEN '已核銷' ELSE '已駁回' END;
    WHEN 'correction' THEN perm_code := 'leave.approve';
                           new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    ELSE
      RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
  END CASE;

  -- ── 權限檢查（接主系統 RBAC）──
  IF NOT public.liff_employee_has_permission(emp.id, perm_code) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  reject_val := CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END;

  -- ── 分派 ──
  IF p_type = 'leave' THEN
    UPDATE public.leave_requests
       SET status = new_status,
           approver = emp.name,
           reject_reason = reject_val
     WHERE id = p_id
       AND status = '待審核'
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_type = 'overtime' THEN
    UPDATE public.overtime_requests
       SET status = new_status,
           approver = emp.name,
           reject_reason = reject_val
     WHERE id = p_id
       AND status = '待審核'
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_type = 'trip' THEN
    UPDATE public.business_trips
       SET status = new_status,
           approver = emp.name,
           reject_reason = reject_val
     WHERE id = p_id
       AND status = '待審核'
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_type = 'expense' THEN
    -- expenses 沒 organization_id → 以申請人 name 對應 org
    UPDATE public.expenses
       SET status = new_status,
           approver = emp.name,
           reject_reason = reject_val
     WHERE id = p_id
       AND status = '待審核'
       AND EXISTS (
         SELECT 1 FROM public.employees e2
         WHERE e2.name = public.expenses.employee
           AND e2.organization_id = emp.organization_id
       );
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_type = 'correction' THEN
    -- 先抓資料（要用來回寫 attendance_records）
    SELECT c.* INTO correction
      FROM public.clock_corrections c
     WHERE c.id = p_id
       AND c.status = '待審核'
       AND EXISTS (
         SELECT 1 FROM public.employees e2
         WHERE e2.name = c.employee
           AND e2.organization_id = emp.organization_id
       );
    IF NOT FOUND THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;

    UPDATE public.clock_corrections
       SET status = new_status,
           approver = emp.name,
           reject_reason = reject_val
     WHERE id = p_id;
    GET DIAGNOSTICS n = ROW_COUNT;

    -- 核准時把 correction_time 回填 attendance_records
    IF p_action = 'approve' AND correction.correction_time IS NOT NULL THEN
      new_in  := CASE WHEN correction.type = '上班打卡' THEN correction.correction_time END;
      new_out := CASE WHEN correction.type = '下班打卡' THEN correction.correction_time END;

      SELECT * INTO existing_att FROM public.attendance_records
       WHERE employee = correction.employee AND date = correction.date
       LIMIT 1;

      IF FOUND THEN
        UPDATE public.attendance_records
           SET clock_in  = COALESCE(new_in,  clock_in),
               clock_out = COALESCE(new_out, clock_out)
         WHERE id = existing_att.id;
      ELSE
        INSERT INTO public.attendance_records (employee, date, clock_in, clock_out, status)
        VALUES (correction.employee, correction.date, new_in, new_out, '補登');
      END IF;
    END IF;
  END IF;

  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
  END IF;

  RETURN json_build_object('ok', true, 'status', new_status);
END $$;

-- ── GRANTs ──────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.liff_employee_has_permission(int, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO anon, authenticated;
