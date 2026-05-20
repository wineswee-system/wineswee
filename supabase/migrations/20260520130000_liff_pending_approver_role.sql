-- ════════════════════════════════════════════════════════════════════════════
-- liff_list_pending_approvals：每筆待審單加上審核人身分欄位
-- 2026-05-20
--
-- 新增欄位（所有有 chain 的區段）：
--   my_step_label    TEXT   — approval_chain_steps.label（chain 設定的步驟名稱）
--   my_approver_role TEXT   — 'extra_signer' | 'direct_manager' | target_type
--
-- target_type 值域（由 LIFF 前端翻譯）：
--   fixed_emp                → 指定審核人
--   applicant_dept_manager   → 部門主管
--   applicant_store_manager  → 門市主管
--   applicant_supervisor     → 直屬主管
--   applicant_section_supervisor → 區域督導
--   specific_dept_manager    → 指定部門主管
--   specific_store_manager   → 指定門市主管
--   specific_section_supervisor → 指定區域督導
--   fixed_role               → 指定角色
--   fixed_dept               → 部門審核
--   extra_signer             → 加簽審核人
--   direct_manager           → 直屬主管（非 chain 路徑）
--
-- shift_swaps / off_requests 不加（無 chain 設定）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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

    -- ── 請假 ────────────────────────────────────────────────────────────────
    'leaves', (
      SELECT COALESCE(json_agg(
        (row_to_json(l.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_requests', l.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND COALESCE(l.employee_id, -1) <> emp.id
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL
              AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),

    -- ── 加班 ────────────────────────────────────────────────────────────────
    'overtimes', (
      SELECT COALESCE(json_agg(
        (row_to_json(o.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('overtime_requests', o.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND COALESCE(o.employee_id, -1) <> emp.id
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL
              AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),

    -- ── 出差 ────────────────────────────────────────────────────────────────
    'trips', (
      SELECT COALESCE(json_agg(
        (row_to_json(t.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('business_trips', t.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (
        SELECT id FROM employees
         WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1
      ) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND COALESCE(e_app.id, -1) <> emp.id
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL
              AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),

    -- ── 打卡校正 ────────────────────────────────────────────────────────────
    'corrections', (
      SELECT COALESCE(json_agg(
        (row_to_json(c.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('clock_corrections', c.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app
        ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核' AND e_app.id <> emp.id
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL
              AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),

    -- ── 費用報帳（HR 舊式）────────────────────────────────────────────────
    'expenses', (
      SELECT COALESCE(json_agg(
        (row_to_json(ex.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('expenses', ex.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app
        ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核' AND e_app.id <> emp.id
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL
              AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('expenses', ex.id, emp.id))
    ),

    -- ── 費用申請（Finance 模組）─────────────────────────────────────────────
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
        'my_step_label',    cur_step.label,
        'my_approver_role', CASE
          WHEN cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
            THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('expense_requests', er.id, emp.id)
            THEN 'extra_signer'
          ELSE cur_step.target_type
        END
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND COALESCE(er.employee_id, -1) <> emp.id
        AND ((er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),

    -- ── 費用核銷 ────────────────────────────────────────────────────────────
    'expense_settles', (
      SELECT COALESCE(json_agg(
        (row_to_json(er.*)::jsonb || jsonb_build_object(
          'my_step_label',       cur_step.label,
          'my_approver_role',    cur_step.target_type,
          'settle_chain_name',   ac.name,
          'settle_total_steps',  (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.settle_chain_id)
        ))::json
      ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.settle_chain_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND COALESCE(er.employee_id, -1) <> emp.id
        AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),

    -- ── HR B 類：離職 ───────────────────────────────────────────────────────
    'resignation_requests', (
      SELECT COALESCE(json_agg(
        (row_to_json(r.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('resignation_requests', r.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY r.created_at DESC), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),

    -- ── HR B 類：留職停薪 ────────────────────────────────────────────────────
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(
        (row_to_json(r.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY r.created_at DESC), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),

    -- ── HR B 類：人事調動 ────────────────────────────────────────────────────
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(
        (row_to_json(r.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY r.created_at DESC), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),

    -- ── HR B 類：人力需求 ────────────────────────────────────────────────────
    'headcount_requests', (
      SELECT COALESCE(json_agg(
        (row_to_json(h.*)::jsonb || jsonb_build_object(
          'my_step_label',    cs.label,
          'my_approver_role', CASE
            WHEN h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id)
              THEN cs.target_type
            WHEN public._has_pending_extra_for_me('headcount_requests', h.id, emp.id)
              THEN 'extra_signer'
            ELSE 'direct_manager'
          END
        ))::json
      ORDER BY h.created_at DESC), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
        AND COALESCE(h.employee_id, -1) <> emp.id
        AND ((h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id))
          OR public._has_pending_extra_for_me('headcount_requests', h.id, emp.id))
    ),

    -- ── 表單申請 ────────────────────────────────────────────────────────────
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', s.id, 'template_id', s.template_id, 'template_name', t.name,
        'applicant_id', s.applicant_id, 'applicant_name', e_app.name,
        'data', s.data, 'status', s.status, 'created_at', s.created_at,
        'current_step', s.current_step,
        'chain_id', t.approval_chain_id,
        'my_step_label',    cur_step.label,
        'my_approver_role', CASE
          WHEN cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id)
            THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('form_submissions', s.id, emp.id)
            THEN 'extra_signer'
          ELSE cur_step.target_type
        END
      ) ORDER BY s.created_at DESC), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.employees e_app ON e_app.id = s.applicant_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = t.approval_chain_id AND cur_step.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id
        AND s.status = '申請中'
        AND COALESCE(s.applicant_id, -1) <> emp.id
        AND (
          (t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id))
          OR public._has_pending_extra_for_me('form_submissions', s.id, emp.id)
        )
    ),

    'task_confirmations', '[]'::json,

    -- ── 換班（無 chain，不加 role 欄位）────────────────────────────────────
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待對方同意'
        AND ss.target_id = emp.id AND ss.requester_id <> emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),

    -- ── 休假申請（無 chain）────────────────────────────────────────────────
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json)
      FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND COALESCE(ofr.employee_id, -1) <> emp.id
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
    ),

    'can', json_build_object(
      'hr',      public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (public.liff_employee_has_permission(emp.id, 'expense.approve')
                  OR public.liff_employee_has_permission(emp.id, 'expense.settle'))
    )

  ) INTO result;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
