-- ════════════════════════════════════════════════════════════
-- liff_list_pending_approvals 為每個 row 注入 store + department
--
-- LIFF 簽核中心 row 要顯示「申請人 · 門市/部門」，但有些 form 表
-- 本身沒這欄（leave_requests / business_trips / expenses），需要
-- LEFT JOIN employees + departments + stores 解出來再 merge 回 row。
--
-- 用 to_jsonb(t.*) || jsonb_build_object('store', ..., 'department', ...)
-- 不動 base row 結構，只是補欄位。
-- ════════════════════════════════════════════════════════════

BEGIN;

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
      SELECT COALESCE(json_agg(
        to_jsonb(l.*) || jsonb_build_object(
          'store', COALESCE(e.store, s.name),
          'department', COALESCE(e.dept, d.name)
        )
        ORDER BY l.created_at DESC
      ), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.employees e ON e.id = l.employee_id
      LEFT JOIN public.departments d ON d.id = e.department_id
      LEFT JOIN public.stores s ON s.id = e.store_id
      WHERE l.organization_id = emp.organization_id
        AND l.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(
        to_jsonb(o.*) || jsonb_build_object(
          'store', COALESCE(o.store, e.store, s.name),
          'department', COALESCE(e.dept, d.name)
        )
        ORDER BY o.created_at DESC
      ), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.employees e ON e.id = o.employee_id
      LEFT JOIN public.departments d ON d.id = e.department_id
      LEFT JOIN public.stores s ON s.id = e.store_id
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(
        to_jsonb(t.*) || jsonb_build_object(
          'store', COALESCE(e.store, s.name),
          'department', COALESCE(e.dept, d.name)
        )
        ORDER BY t.created_at DESC
      ), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.employees e ON e.name = t.employee AND e.organization_id = t.organization_id
      LEFT JOIN public.departments d ON d.id = e.department_id
      LEFT JOIN public.stores s ON s.id = e.store_id
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
      SELECT COALESCE(json_agg(
        to_jsonb(c.*) || jsonb_build_object(
          'store', COALESCE(c.store, e_app.store, s.name),
          'department', COALESCE(e_app.dept, d.name)
        )
        ORDER BY c.created_at DESC
      ), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app
        ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.departments d ON d.id = e_app.department_id
      LEFT JOIN public.stores s ON s.id = e_app.store_id
      WHERE c.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg(
        to_jsonb(ex.*) || jsonb_build_object(
          'store', COALESCE(e_app.store, s.name),
          'department', COALESCE(e_app.dept, d.name)
        )
        ORDER BY ex.created_at DESC
      ), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app
        ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.departments d ON d.id = e_app.department_id
      LEFT JOIN public.stores s ON s.id = e_app.store_id
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
        AND public._employee_matches_chain_step(emp.id, cur_step.id)
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(
        to_jsonb(ss.*) || jsonb_build_object(
          'store', COALESCE(ss.store, e_req.store, s.name),
          'department', COALESCE(e_req.dept, d.name)
        )
        ORDER BY ss.created_at DESC
      ), '[]'::json)
      FROM public.shift_swaps ss
      LEFT JOIN public.employees e_req ON e_req.id = ss.requester_id
      LEFT JOIN public.departments d ON d.id = e_req.department_id
      LEFT JOIN public.stores s ON s.id = e_req.store_id
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待對方同意'
        AND ss.target_id = emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(
        to_jsonb(ss.*) || jsonb_build_object(
          'store', COALESCE(ss.store, e_req.store, s.name),
          'department', COALESCE(e_req.dept, d.name)
        )
        ORDER BY ss.created_at DESC
      ), '[]'::json)
      FROM public.shift_swaps ss
      LEFT JOIN public.employees e_req ON e_req.id = ss.requester_id
      LEFT JOIN public.departments d ON d.id = e_req.department_id
      LEFT JOIN public.stores s ON s.id = e_req.store_id
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待主管核准'
        AND (
          EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
          OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
        )
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(
        to_jsonb(ofr.*) || jsonb_build_object(
          'store', COALESCE(ofr.store, e.store, s.name),
          'department', COALESCE(e.dept, d.name)
        )
        ORDER BY ofr.created_at DESC
      ), '[]'::json)
      FROM public.off_requests ofr
      LEFT JOIN public.employees e ON e.id = ofr.employee_id
      LEFT JOIN public.departments d ON d.id = e.department_id
      LEFT JOIN public.stores s ON s.id = e.store_id
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

COMMIT;

NOTIFY pgrst, 'reload schema';
