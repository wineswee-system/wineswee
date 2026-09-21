-- ════════════════════════════════════════════════════════════════════════════
-- 待簽清單 RPC：把「我是加簽人 (approval_extra_steps assignee, status=pending)」
-- 也列入待簽（兩支 RPC：web_list_my_pending_approval_ids / liff_list_pending_approvals）
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：加簽人不是 chain step 的 target，被既有「chain-aware」WHERE 過濾掉，
--      導致 Snow 在 LIFF / Web 「我的待簽」都看不到加簽過給她的單。
--
-- 修法：
--   1. 新 helper _has_pending_extra_for_me(table, id, my_emp_id) → bool
--   2. 1:1 重寫兩支 RPC，每張可加簽的表加一行：
--        OR public._has_pending_extra_for_me('xxx_table', row.id, emp.id)
--      其他段 (HR fallback / chain match / self-exclude) 完全不動
--
-- 涵蓋表（_extra_step_allowed_tables）：
--   leave_requests, overtime_requests, business_trips, clock_corrections,
--   expenses, expense_requests, resignation_requests,
--   leave_of_absence_requests, personnel_transfer_requests
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── helper ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._has_pending_extra_for_me(
  p_source_table text,
  p_source_id    integer,
  p_my_emp_id    integer
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.approval_extra_steps
     WHERE source_table = p_source_table
       AND source_id   = p_source_id
       AND assignee_id = p_my_emp_id
       AND status      = 'pending'
  );
$$;

GRANT EXECUTE ON FUNCTION public._has_pending_extra_for_me(text, integer, integer)
  TO authenticated, anon;


-- ─── Web RPC ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.web_list_my_pending_approval_ids()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  emp employees;
  result json;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN
    RETURN json_build_object('error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT json_build_object(
    'leave_requests', (
      SELECT COALESCE(json_agg(l.id), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id
        AND l.status = '待審核'
        AND COALESCE(l.employee_id, -1) <> emp.id
        AND (
          (l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id)
        )
    ),
    'overtime_requests', (
      SELECT COALESCE(json_agg(o.id), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審核'
        AND COALESCE(o.employee_id, -1) <> emp.id
        AND (
          (o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id)
        )
    ),
    'business_trips', (
      SELECT COALESCE(json_agg(t.id), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (
        SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1
      ) e_app ON true
      WHERE t.organization_id = emp.organization_id
        AND t.status = '待審核'
        AND COALESCE(e_app.id, -1) <> emp.id
        AND (
          (t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id)
        )
    ),
    'clock_corrections', (
      SELECT COALESCE(json_agg(c.id), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app
        ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND e_app.id <> emp.id
        AND (
          (c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id)
        )
    ),
    'expenses', (
      SELECT COALESCE(json_agg(ex.id), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app
        ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND e_app.id <> emp.id
        AND (
          (ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('expenses', ex.id, emp.id)
        )
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '申請中'
        AND COALESCE(er.employee_id, -1) <> emp.id
        AND (
          (er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id)
        )
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '待核銷'
        AND COALESCE(er.employee_id, -1) <> emp.id
        AND er.settle_chain_id IS NOT NULL
        AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND (
          (r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id)
        )
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND (
          (r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id)
        )
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND (
          (r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id)
        )
    ),
    'shift_swaps', (
      SELECT COALESCE(json_agg(ss.id), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND (
          (ss.status = '待對方同意' AND ss.target_id = emp.id AND ss.requester_id <> emp.id)
          OR (ss.status = '待主管核准'
              AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
                   OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
              AND ss.requester_id <> emp.id AND ss.target_id <> emp.id)
        )
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(ofr.id), '[]'::json)
      FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id
        AND ofr.status = '待審核'
        AND ofr.employee <> emp.name
        AND emp.id IN (
          SELECT public._resolve_hr_approver_ids(
            (SELECT id FROM employees WHERE name = ofr.employee AND organization_id = ofr.organization_id LIMIT 1)
          )
        )
    ),
    'task_confirmations', (
      SELECT COALESCE(json_agg(tc.id), '[]'::json)
      FROM public.task_confirmations tc
      WHERE tc.approver = emp.name
        AND tc.status = 'pending'
    )
  ) INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.web_list_my_pending_approval_ids() TO authenticated;


-- ─── LIFF RPC ───────────────────────────────────────────────────────────────
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
      'expense_settles','[]'::json,
      'resignation_requests','[]'::json,
      'leave_of_absence_requests','[]'::json,
      'personnel_transfer_requests','[]'::json,
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
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id
        AND l.status = '待審核'
        AND COALESCE(l.employee_id, -1) <> emp.id
        AND (
          (l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id)
        )
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審核'
        AND COALESCE(o.employee_id, -1) <> emp.id
        AND (
          (o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id)
        )
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (
        SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1
      ) e_app ON true
      WHERE t.organization_id = emp.organization_id
        AND t.status = '待審核'
        AND COALESCE(e_app.id, -1) <> emp.id
        AND (
          (t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id)
        )
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app
        ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND e_app.id <> emp.id
        AND (
          (c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id)
        )
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(ex.*) ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app
        ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND e_app.id <> emp.id
        AND (
          (ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('expenses', ex.id, emp.id)
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
        ON cur_step.chain_id = er.approval_chain_id
       AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '申請中'
        AND COALESCE(er.employee_id, -1) <> emp.id
        AND (
          (er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id)
        )
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '待核銷'
        AND COALESCE(er.employee_id, -1) <> emp.id
        AND er.settle_chain_id IS NOT NULL
        AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND (
          (r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id)
        )
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND (
          (r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id)
        )
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND (
          (r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id)
        )
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待對方同意'
        AND ss.target_id = emp.id
        AND ss.requester_id <> emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待主管核准'
        AND ss.requester_id <> emp.id
        AND ss.target_id <> emp.id
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
        AND COALESCE(ofr.employee_id, -1) <> emp.id
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (
        public.liff_employee_has_permission(emp.id, 'expense.approve')
        OR public.liff_employee_has_permission(emp.id, 'expense.settle')
      )
    )
  ) INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
