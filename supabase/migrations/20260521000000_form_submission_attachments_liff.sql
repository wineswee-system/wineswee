-- ════════════════════════════════════════════════════════════════════════════
-- form_submissions 附件 inline 進 LIFF 兩支 RPC
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：form_attachments 存附件（form_type='form_submissions'），但
--   liff_list_pending_approvals / liff_list_my_submissions 的 form_submissions
--   區段都沒帶回附件，LIFF 簽核人和申請人都看不到上傳的檔案（如報修照片）。
--
-- 修法：只動兩函式的 form_submissions 區段，各加一個
--   attachments subquery → json_agg from form_attachments。
--   其他區段（leave/overtime/expense 等）完全不動。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. liff_list_pending_approvals  （僅 form_submissions 區段加 attachments）
-- ─────────────────────────────────────────────────────────────────────────
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
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json) FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核' AND COALESCE(l.employee_id, -1) <> emp.id
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json) FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核' AND COALESCE(o.employee_id, -1) <> emp.id
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json) FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核' AND COALESCE(e_app.id, -1) <> emp.id
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json) FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核' AND e_app.id <> emp.id
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(ex.*) ORDER BY ex.created_at DESC), '[]'::json) FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核' AND e_app.id <> emp.id
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
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
        'current_step_label', cur_step.label,
        'current_step_target', cur_step.role_name
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中' AND COALESCE(er.employee_id, -1) <> emp.id
        AND ((er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json) FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷' AND COALESCE(er.employee_id, -1) <> emp.id
        AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json) FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json) FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json) FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(row_to_json(h.*) ORDER BY h.created_at DESC), '[]'::json) FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中' AND COALESCE(h.employee_id, -1) <> emp.id
        AND ((h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id))
          OR public._has_pending_extra_for_me('headcount_requests', h.id, emp.id))
    ),
    -- ★ form_submissions：帶 template_fields + data + attachments（2026-05-21）
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', s.id, 'template_id', s.template_id, 'template_name', t.name,
        'template_fields', t.fields,
        'applicant_id', s.applicant_id, 'applicant_name', e_app.name,
        'data', s.data, 'status', s.status, 'created_at', s.created_at,
        'current_step', s.current_step,
        'chain_id', t.approval_chain_id,
        'current_step_label', cur_step.label,
        -- ★ 附件清單
        'attachments', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', a.id,
            'file_name', a.file_name,
            'storage_bucket', a.storage_bucket,
            'storage_path', a.storage_path,
            'mime_type', a.mime_type,
            'file_size', a.file_size
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
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待對方同意'
        AND ss.target_id = emp.id AND ss.requester_id <> emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json) FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND COALESCE(ofr.employee_id, -1) <> emp.id
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (public.liff_employee_has_permission(emp.id, 'expense.approve') OR public.liff_employee_has_permission(emp.id, 'expense.settle'))
    )
  ) INTO result;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. liff_list_my_submissions  （僅 form_submissions 區段加 attachments）
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_my_submissions(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'form_submissions','[]'::json
    );
  END IF;

  RETURN json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      WHERE (l.employee_id = emp.id OR l.employee = emp.name)
      LIMIT 50
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE (o.employee_id = emp.id OR o.employee = emp.name)
      LIMIT 50
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.employee = emp.name
      LIMIT 50
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.created_at DESC), '[]'::json)
      FROM public.expenses e
      WHERE e.employee = emp.name
      LIMIT 50
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      WHERE c.employee = emp.name
      LIMIT 50
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      WHERE er.employee = emp.name
      LIMIT 50
    ),
    -- ★ 自訂表單：含申請人自己上傳的附件（2026-05-21）
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                s.id,
        'template_id',       s.template_id,
        'template_name',     t.name,
        'template_fields',   t.fields,
        'applicant_id',      s.applicant_id,
        'data',              s.data,
        'data_resolved',     public._resolve_form_submission_data(s.data, t.fields),
        'status',            s.status,
        'created_at',        s.created_at,
        'reject_reason',     s.reject_reason,
        'reject_attachments', s.reject_attachments,
        -- ★ 申請人送件時上傳的附件
        'attachments', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', a.id,
            'file_name', a.file_name,
            'storage_bucket', a.storage_bucket,
            'storage_path', a.storage_path,
            'mime_type', a.mime_type,
            'file_size', a.file_size
          ) ORDER BY a.created_at), '[]'::json)
          FROM public.form_attachments a
          WHERE a.form_type = 'form_submissions' AND a.form_id = s.id
        )
      ) ORDER BY s.created_at DESC), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      WHERE s.applicant_id = emp.id
      LIMIT 50
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_submissions(text) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
