-- ============================================================
-- 把 expense_requests 納入 LIFF 審核中心 + 代辦項目的簽核 tab
--
-- 原本 liff_list_pending_approvals 只回 leave/overtime/trip/
-- expense(flat)/correction 五種。現在加入第六種 expense_requests。
--
-- MVP 策略：finance.edit 權限者看到同 org 所有「申請中」的費用申請。
-- 審了直接改 status='已核准'/'已駁回'（不跑多關簽核鏈；後續版本再做）。
-- ============================================================

-- ═══ 1. 擴充 liff_list_pending_approvals ═══
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
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
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
    'expense_requests', CASE WHEN can_fin THEN (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                er.id,
        'employee',          er.employee,
        'department',        er.department,
        'title',             er.title,
        'description',       er.description,
        'estimated_amount',  er.estimated_amount,
        'account_code',      er.account_code,
        'account_name',      er.account_name,
        'store',             er.store,
        'status',            er.status,
        'reject_reason',     er.reject_reason,
        'approval_chain_id', er.approval_chain_id,
        'chain_name',        (SELECT name FROM public.approval_chains WHERE id = er.approval_chain_id),
        'chain_steps',       (SELECT string_agg(role_name, ' → ' ORDER BY step_order)
                              FROM public.approval_chain_steps
                              WHERE chain_id = er.approval_chain_id),
        'created_at',        er.created_at
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      WHERE er.organization_id = emp.organization_id
    ) ELSE '[]'::json END,
    'can', json_build_object('hr', can_hr, 'finance', can_fin)
  ) INTO result;

  RETURN result;
END $$;

-- ═══ 2. 擴充 liff_approve_request 支援 expense_request 類型 ═══
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

  CASE p_type
    WHEN 'leave'            THEN perm_code := 'leave.approve';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    WHEN 'overtime'         THEN perm_code := 'leave.approve';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    WHEN 'trip'             THEN perm_code := 'leave.approve';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已駁回' END;
    WHEN 'expense'          THEN perm_code := 'finance.edit';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核銷' ELSE '已駁回' END;
    WHEN 'correction'       THEN perm_code := 'leave.approve';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    WHEN 'expense_request'  THEN perm_code := 'finance.edit';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已駁回' END;
    ELSE
      RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
  END CASE;

  IF NOT public.liff_employee_has_permission(emp.id, perm_code) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  reject_val := CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END;

  IF p_type = 'leave' THEN
    UPDATE public.leave_requests
       SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id AND status = '待審核' AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_type = 'overtime' THEN
    UPDATE public.overtime_requests
       SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id AND status = '待審核' AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_type = 'trip' THEN
    UPDATE public.business_trips
       SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id AND status = '待審核' AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_type = 'expense' THEN
    UPDATE public.expenses
       SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id AND status = '待審核'
       AND EXISTS (SELECT 1 FROM public.employees e2
                   WHERE e2.name = public.expenses.employee
                     AND e2.organization_id = emp.organization_id);
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_type = 'correction' THEN
    SELECT c.* INTO correction
      FROM public.clock_corrections c
     WHERE c.id = p_id AND c.status = '待審核'
       AND EXISTS (SELECT 1 FROM public.employees e2
                   WHERE e2.name = c.employee AND e2.organization_id = emp.organization_id);
    IF NOT FOUND THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;

    UPDATE public.clock_corrections
       SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id;
    GET DIAGNOSTICS n = ROW_COUNT;

    IF p_action = 'approve' AND correction.correction_time IS NOT NULL THEN
      new_in  := CASE WHEN correction.type = '上班打卡' THEN correction.correction_time END;
      new_out := CASE WHEN correction.type = '下班打卡' THEN correction.correction_time END;
      SELECT * INTO existing_att FROM public.attendance_records
       WHERE employee = correction.employee AND date = correction.date LIMIT 1;
      IF FOUND THEN
        UPDATE public.attendance_records
           SET clock_in  = COALESCE(new_in, clock_in),
               clock_out = COALESCE(new_out, clock_out)
         WHERE id = existing_att.id;
      ELSE
        INSERT INTO public.attendance_records (employee, date, clock_in, clock_out, status)
        VALUES (correction.employee, correction.date, new_in, new_out, '補登');
      END IF;
    END IF;

  ELSIF p_type = 'expense_request' THEN
    -- MVP：flat approve（不跑多關鏈）；approved_by 記簽核人
    UPDATE public.expense_requests
       SET status = new_status,
           approved_by = emp.name,
           approved_at = CASE WHEN p_action = 'approve' THEN now() ELSE NULL END,
           reject_reason = reject_val
     WHERE id = p_id
       AND status = '申請中'
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
  END IF;

  RETURN json_build_object('ok', true, 'status', new_status);
END $$;

-- ═══ 3. GRANTs（已 grant 過，CREATE OR REPLACE 不需要重 grant 但保險起見）═══
GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO anon, authenticated;
