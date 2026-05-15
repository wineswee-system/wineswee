-- ════════════════════════════════════════════════════════════
-- liff_list_pending_approvals: can.finance 改用新權限
-- 2026-05-15
--
-- 問題：下午 RBAC 重組（20260515100000）把 finance.edit 設成
--   未交付（is_active=false）且從 admin role 刪除。
--   但 LIFF Approve.jsx 用 data.can.finance 判斷能不能看經費分頁，
--   其值來自 RPC 的 liff_employee_has_permission(emp, 'finance.edit')。
--   → admin / manager 全部失去經費分頁入口。
--
-- 修法：can.finance 改用任一個新 perm
--   expense.approve（審核費用申請）OR expense.settle（核銷費用）
--   只要有任一個就視為「會用到經費分頁」
--
-- 其他段落不變，只改最後 RETURN 那兩行。
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
    -- ★ 修：can.finance 改用新 perm（expense.approve OR expense.settle）
    -- 任一個有就放行進「經費」分頁，實際能簽哪個 tab 看資料是否出現
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
