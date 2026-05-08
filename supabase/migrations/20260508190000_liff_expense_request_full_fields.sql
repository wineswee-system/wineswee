-- ════════════════════════════════════════════════════════════
-- 修 expense_request 兩個 bug：
--   1. liff_insert_expense_request RPC INSERT 沒寫 supplier + items
--      → DB 永遠 supplier=NULL, items=NULL → 詳情顯示不出來
--   2. liff_list_pending_approvals SELECT 沒拿 supplier + items
--      → 即使 DB 有，LIFF 也拿不到
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 改 liff_insert_expense_request 加 items + supplier ═══
CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp                 employees;
  v_amount            numeric;
  v_chain_id          int;
  v_chain_step_count  int := 0;
  v_supervisor_id     int;
  v_is_owner          boolean := false;
  v_status            text := '申請中';
  new_id              int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'employee not found' USING ERRCODE = 'P0002';
  END IF;

  v_amount := COALESCE((p_payload->>'estimated_amount')::numeric, 0);

  -- 找符合金額的 approval_chain
  SELECT id INTO v_chain_id
    FROM public.approval_chains
   WHERE category = '費用申請'
     AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
     AND v_amount >= COALESCE(min_amount, 0)
     AND (max_amount IS NULL OR v_amount <= max_amount)
   ORDER BY COALESCE(min_amount, 0) DESC
   LIMIT 1;

  IF v_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_chain_step_count
      FROM public.approval_chain_steps WHERE chain_id = v_chain_id;
    IF v_chain_step_count = 0 THEN v_chain_id := NULL; END IF;
  END IF;

  v_supervisor_id := public._resolve_single_approver(emp.id);
  v_is_owner := (v_supervisor_id IS NULL AND NOT public._is_store_manager(emp.id));

  IF v_is_owner THEN v_status := '已核准'; END IF;

  IF NOT v_is_owner AND v_chain_id IS NULL THEN
    RAISE EXCEPTION '尚未設定符合金額 NT$% 的「費用申請」簽核鏈，請聯絡管理員', v_amount
      USING ERRCODE = 'P0001', HINT = '請到「組織 > 簽核設定」新增 category=費用申請 的 approval_chain';
  END IF;

  -- ★ 加 supplier + items 欄位
  INSERT INTO public.expense_requests (
    employee, employee_id, department,
    account_code, account_name,
    title, description, estimated_amount,
    supplier,
    items,
    store, status, organization_id,
    approval_chain_id, current_step
  )
  VALUES (
    emp.name, emp.id, emp.dept,
    p_payload->>'account_code',
    p_payload->>'account_name',
    p_payload->>'title',
    p_payload->>'description',
    v_amount,
    p_payload->>'supplier',
    COALESCE((p_payload->'items'), '[]'::jsonb),
    COALESCE(p_payload->>'store', emp.store),
    v_status,
    emp.organization_id,
    v_chain_id,
    0
  )
  RETURNING id INTO new_id;

  RETURN json_build_object(
    'id', new_id,
    'status', v_status,
    'approval_chain_id', v_chain_id,
    'auto_approved', v_is_owner
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_expense_request(text, json) TO anon, authenticated;


-- ═══ 2. 改 liff_list_pending_approvals 對 expense_requests 加 supplier + items ═══
-- 整個 RPC 重寫（其他段落沿用 20260508180000 的版本）
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
          (l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
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
    -- ★ expense_requests 加 supplier + items
    'expense_requests', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department,
        'title', er.title, 'description', er.description,
        'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store,
        'supplier', er.supplier,
        'items', er.items,
        'status', er.status,
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
