-- ============================================================================
-- web_list_my_pending_approval_ids 補 deleted_at IS NULL filter — Batch 2
-- ============================================================================
--
-- 上一輪 batch 1 處理了 LIFF 11 個 RPC，這輪處理主系統「簽核中心」用的
-- web_list_my_pending_approval_ids。8 個 sub-query 對應 soft-delete 表
-- 都加 deleted_at IS NULL filter：
--   leave_requests / overtime_requests / business_trips / clock_corrections
--   expense_requests / headcount_requests / form_submissions / shift_swaps
--
-- 跳過（表沒 deleted_at）：
--   expenses / resignation_requests / leave_of_absence_requests
--   personnel_transfer_requests
--
-- web_list_my_signed_approvals 是 wrapper 委派給 _list_my_signed_approvals
-- helper（待 batch 3 處理 helper 內部）
-- ============================================================================

CREATE OR REPLACE FUNCTION public.web_list_my_pending_approval_ids()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  emp employees;
  result json;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN RETURN json_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT json_build_object(
    'leave_requests', (
      SELECT COALESCE(json_agg(l.id), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND l.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id))
    ),
    'overtime_requests', (
      SELECT COALESCE(json_agg(o.id), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND o.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id))
    ),
    'business_trips', (
      SELECT COALESCE(json_agg(t.id), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND t.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id))
    ),
    'clock_corrections', (
      SELECT COALESCE(json_agg(c.id), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND c.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id))
    ),
    'expenses', (
      -- expenses 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(ex.id), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = er.approval_chain_id AND cs.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND er.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, er.employee_id)
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = er.settle_chain_id AND cs.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND er.settle_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, er.employee_id)
    ),
    'resignation_requests', (
      -- resignation_requests 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(h.id), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
        AND h.deleted_at IS NULL  -- ★ soft-delete filter
        AND h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id)
    ),
    'form_submissions', (
      SELECT COALESCE(json_agg(s.id), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id AND s.status = '申請中'
        AND s.deleted_at IS NULL  -- ★ soft-delete filter
        AND t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, s.applicant_id)
    ),
    'shift_swaps', (
      SELECT COALESCE(json_agg(ss.id), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((ss.status = '待對方同意' AND ss.target_id = emp.id AND ss.requester_id <> emp.id)
          OR (ss.status = '待主管核准'
              AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
              AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
                   OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))))
    )
  ) INTO result;
  RETURN result;
END
$$;

COMMENT ON FUNCTION public.web_list_my_pending_approval_ids IS
  '主系統簽核中心待簽核 ID list — 對 8 個 soft-delete 表加 deleted_at IS NULL filter';
