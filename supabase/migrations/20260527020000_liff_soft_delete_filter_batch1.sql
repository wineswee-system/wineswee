-- ============================================================================
-- LIFF / Web RPC 補上 soft-delete filter (deleted_at IS NULL) — Batch 1
-- ============================================================================
--
-- 9 個有 deleted_at 欄位的表：
--   business_trips / clock_corrections / expense_requests / form_submissions
--   headcount_requests / leave_requests / off_requests / overtime_requests
--   shift_swaps
--
-- Audit 結果：65/66 LIFF RPC + 2/2 web pending RPC 都沒 deleted_at filter
--   → 用戶按「刪除」(soft delete) 後，審核人/列表畫面還看得到 → 必須補
--
-- 這個 migration 修 11 個 RPC（list + approve 類）。
-- 後續 batch 處理：
--   - web_list_my_pending_approval_ids / web_list_my_signed_approvals
--   - liff_list_my_signed_approvals (內部 helper _list_my_signed_approvals)
--   - liff_get_expense_request_chain_status / _settle_chain_status
-- ============================================================================


-- ── 1. liff_list_leave_requests ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_leave_requests(p_line_user_id text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(lr.*) ORDER BY lr.start_date DESC), '[]'::json)
  FROM public.leave_requests lr
  WHERE lr.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
    AND lr.deleted_at IS NULL
$$;


-- ── 2. liff_list_overtime_requests ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_overtime_requests(p_line_user_id text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.date DESC), '[]'::json)
  FROM public.overtime_requests o
  WHERE o.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
    AND o.deleted_at IS NULL
$$;


-- ── 3. liff_list_business_trips ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_business_trips(p_line_user_id text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(b.*) ORDER BY b.start_date DESC), '[]'::json)
  FROM public.business_trips b
  WHERE b.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
    AND b.deleted_at IS NULL
$$;


-- ── 4. liff_list_clock_corrections ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_clock_corrections(p_line_user_id text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.date DESC), '[]'::json)
  FROM public.clock_corrections c
  WHERE c.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
    AND c.deleted_at IS NULL
$$;


-- ── 5. liff_list_off_requests ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_off_requests(
  p_line_user_id text, p_from date DEFAULT NULL, p_to date DEFAULT NULL
)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH e AS (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
  SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.date), '[]'::json)
  FROM public.off_requests o, e
  WHERE o.employee_id = e.id
    AND o.deleted_at IS NULL
    AND (p_from IS NULL OR o.date >= p_from)
    AND (p_to   IS NULL OR o.date <= p_to)
$$;


-- ── 6. liff_list_my_shift_swaps ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_my_shift_swaps(p_line_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC)
    FROM public.shift_swaps ss
   WHERE (ss.requester_id = emp.id OR ss.target_id = emp.id)
     AND ss.organization_id = emp.organization_id
     AND ss.deleted_at IS NULL
  ), '[]'::jsonb);
END
$$;


-- ── 7. liff_list_my_submissions ──────────────────────────────────────────────
-- 8 個 sub-query 內 6 個對應 soft-delete 表（expenses 沒 deleted_at 跳過）
CREATE OR REPLACE FUNCTION public.liff_list_my_submissions(p_line_user_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
        AND l.deleted_at IS NULL
      LIMIT 50
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE (o.employee_id = emp.id OR o.employee = emp.name)
        AND o.deleted_at IS NULL
      LIMIT 50
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.employee = emp.name
        AND t.deleted_at IS NULL
      LIMIT 50
    ),
    'expenses', (
      -- expenses 表沒 deleted_at 欄位（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.created_at DESC), '[]'::json)
      FROM public.expenses e
      WHERE e.employee = emp.name
      LIMIT 50
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      WHERE c.employee = emp.name
        AND c.deleted_at IS NULL
      LIMIT 50
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      WHERE er.employee = emp.name
        AND er.deleted_at IS NULL
      LIMIT 50
    ),
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
        AND s.deleted_at IS NULL
      LIMIT 50
    )
  );
END
$$;


-- ── 8. liff_list_pending_approvals — 大 RPC，多 sub-query 都加 ────────────────
CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    'leaves', (
      SELECT COALESCE(json_agg(
        (to_jsonb(l.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_requests', l.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', l.employee_id = emp.id
        ))::json ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND l.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(
        (to_jsonb(o.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('overtime_requests', o.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', o.employee_id = emp.id
        ))::json ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND o.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(
        (to_jsonb(t.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('business_trips', t.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND t.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),
    'corrections', (
      SELECT COALESCE(json_agg(
        (to_jsonb(c.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('clock_corrections', c.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND c.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),
    'expenses', (
      -- expenses 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(
        (to_jsonb(ex.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('expenses', ex.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
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
        'my_step_label', cur_step.label,
        'my_approver_role', CASE
          WHEN er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id) THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('expense_requests', er.id, emp.id) THEN 'extra_signer'
          ELSE NULL
        END,
        'is_self_approve', er.employee_id = emp.id
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(
        (to_jsonb(er.*) || jsonb_build_object(
          'my_step_label', cur_step.label,
          'my_approver_role', cur_step.target_type,
          'is_self_approve', er.employee_id = emp.id
        ))::json ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      -- resignation_requests 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('resignation_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(h.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('headcount_requests', h.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', h.employee_id = emp.id
        ))::json ORDER BY h.created_at DESC), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
        AND h.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id))
          OR public._has_pending_extra_for_me('headcount_requests', h.id, emp.id))
    ),
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', s.id, 'template_id', s.template_id, 'template_name', t.name,
        'template_fields', t.fields,
        'applicant_id', s.applicant_id, 'applicant_name', e_app.name,
        'data', s.data, 'status', s.status, 'created_at', s.created_at,
        'current_step', s.current_step,
        'chain_id', t.approval_chain_id,
        'my_step_label', cur_step.label,
        'my_approver_role', CASE
          WHEN t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id) THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('form_submissions', s.id, emp.id) THEN 'extra_signer'
          ELSE NULL
        END,
        'is_self_approve', s.applicant_id = emp.id,
        'attachments', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', a.id, 'file_name', a.file_name,
            'storage_bucket', a.storage_bucket, 'storage_path', a.storage_path,
            'mime_type', a.mime_type, 'file_size', a.file_size
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
      WHERE s.organization_id = emp.organization_id AND s.status = '申請中'
        AND s.deleted_at IS NULL  -- ★ soft-delete filter
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
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ss.target_id = emp.id AND ss.requester_id <> emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json) FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND ofr.deleted_at IS NULL  -- ★ soft-delete filter
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
        AND COALESCE(ofr.employee_id, -1) <> emp.id
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (public.liff_employee_has_permission(emp.id, 'expense.approve') OR public.liff_employee_has_permission(emp.id, 'expense.settle'))
    )
  ) INTO result;
  RETURN result;
END
$$;


-- ── 9. liff_approve_request — EXECUTE dynamic SQL 內加 deleted_at ─────────────
-- HR 類 (leave/overtime/trip/correction) 跟 expense_request 走 chain，dynamic format()
-- 內的 WHERE 加 deleted_at IS NULL
CREATE OR REPLACE FUNCTION public.liff_approve_request(
  p_line_user_id text, p_type text, p_id integer,
  p_action text, p_reason text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp           employees;
  v_app_emp_id  INT;
  v_app_name    TEXT;
  v_app_org     INT;
  v_eligible    BOOLEAN;
  reject_val    text;
  approve_status text;
  reject_status  text;
  result_status  text;
  v_chain_id    int;
  v_cur_step    int;
  v_step        approval_chain_steps;
  v_total_steps int;
  v_is_last     boolean;
  v_table_name  text;
  v_table_has_soft_delete boolean;
  v_er          record;
  v_next_step   approval_chain_steps;
  v_next_approver_ids INT[];
  v_next_approvers JSON;
  v_fs_result   json;
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

  reject_val := CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END;

  -- ════ HR 類 (leave/overtime/trip/correction/expense) ════
  IF p_type IN ('leave','overtime','trip','correction','expense') THEN
    v_table_name := CASE p_type
      WHEN 'leave'      THEN 'leave_requests'
      WHEN 'overtime'   THEN 'overtime_requests'
      WHEN 'trip'       THEN 'business_trips'
      WHEN 'correction' THEN 'clock_corrections'
      WHEN 'expense'    THEN 'expenses'
    END;
    -- expenses 表沒 deleted_at，其他都有
    v_table_has_soft_delete := (p_type <> 'expense');

    IF p_type IN ('leave','overtime') THEN
      EXECUTE format(
        'SELECT employee_id, employee, organization_id, approval_chain_id, current_step '
        'FROM %I WHERE id = $1 AND status = ''待審核'' %s',
        v_table_name,
        CASE WHEN v_table_has_soft_delete THEN 'AND deleted_at IS NULL' ELSE '' END
      ) INTO v_app_emp_id, v_app_name, v_app_org, v_chain_id, v_cur_step USING p_id;
    ELSE
      EXECUTE format(
        'SELECT NULL::INT, employee, organization_id, approval_chain_id, current_step '
        'FROM %I WHERE id = $1 AND status = ''待審核'' %s',
        v_table_name,
        CASE WHEN v_table_has_soft_delete THEN 'AND deleted_at IS NULL' ELSE '' END
      ) INTO v_app_emp_id, v_app_name, v_app_org, v_chain_id, v_cur_step USING p_id;
    END IF;

    IF v_app_name IS NULL THEN
      -- ★ row 不存在 / 已處理 / 已刪 → 統一回 NOT_FOUND_OR_ALREADY_PROCESSED
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;

    IF v_app_emp_id IS NULL THEN
      SELECT id INTO v_app_emp_id FROM employees
       WHERE name = v_app_name AND organization_id = COALESCE(v_app_org, emp.organization_id)
       LIMIT 1;
    END IF;
    IF v_app_emp_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'APPLICANT_NOT_FOUND');
    END IF;

    IF v_app_org IS NOT NULL AND v_app_org <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;

    approve_status := CASE p_type WHEN 'expense' THEN '已核銷' ELSE '已核准' END;
    reject_status  := '已退回';

    -- ── 有 chain → 走 chain step ──
    IF v_chain_id IS NOT NULL THEN
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_cur_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
      END IF;

      IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_app_emp_id) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;

      SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
      v_is_last := (v_cur_step + 1 >= v_total_steps);

      IF p_action = 'reject' THEN
        EXECUTE format('UPDATE %I SET status=$1, approver=$2, reject_reason=$3 WHERE id=$4', v_table_name)
          USING reject_status, emp.name, reject_val, p_id;
        RETURN json_build_object('ok', true, 'status', reject_status, 'event', 'rejected',
          'rejected_at_step', v_cur_step,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;

      IF v_is_last THEN
        EXECUTE format('UPDATE %I SET status=$1, approver=$2, current_step=$3 WHERE id=$4', v_table_name)
          USING approve_status, emp.name, v_total_steps, p_id;

        IF p_type = 'correction' THEN
          DECLARE c record; new_in time; new_out time; existing record;
          BEGIN
            SELECT * INTO c FROM clock_corrections WHERE id = p_id;
            IF c.correction_time IS NOT NULL THEN
              new_in  := CASE WHEN c.type = '上班打卡' THEN c.correction_time END;
              new_out := CASE WHEN c.type = '下班打卡' THEN c.correction_time END;
              SELECT * INTO existing FROM attendance_records WHERE employee = c.employee AND date = c.date LIMIT 1;
              IF FOUND THEN
                UPDATE attendance_records SET clock_in = COALESCE(new_in, clock_in), clock_out = COALESCE(new_out, clock_out) WHERE id = existing.id;
              ELSE
                INSERT INTO attendance_records (employee, date, clock_in, clock_out, status) VALUES (c.employee, c.date, new_in, new_out, '補登');
              END IF;
            END IF;
          END;
        END IF;

        RETURN json_build_object('ok', true, 'status', approve_status, 'event', 'approved', 'is_last_step', true,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      ELSE
        EXECUTE format('UPDATE %I SET current_step = current_step + 1 WHERE id=$1', v_table_name) USING p_id;

        SELECT * INTO v_next_step FROM approval_chain_steps
         WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;

        SELECT array_agg(e.id) INTO v_next_approver_ids
          FROM employees e
         WHERE e.status = '在職'
           AND e.organization_id = emp.organization_id
           AND public._employee_matches_chain_step(e.id, v_next_step.id, v_app_emp_id);

        SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
          FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));

        RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
          'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
          'next_approvers', COALESCE(v_next_approvers, '[]'::json),
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;
    END IF;

    -- ── 沒 chain → fallback 組織圖 ──
    SELECT EXISTS (
      SELECT 1 FROM public._resolve_hr_approver_ids(v_app_emp_id) WHERE _resolve_hr_approver_ids = emp.id
    ) INTO v_eligible;
    IF NOT v_eligible THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    result_status := CASE p_action WHEN 'approve' THEN approve_status ELSE reject_status END;

    EXECUTE format('UPDATE %I SET status=$1, approver=$2, reject_reason=$3 WHERE id=$4', v_table_name)
      USING result_status, emp.name, reject_val, p_id;

    IF p_type = 'correction' AND p_action = 'approve' THEN
      DECLARE c record; new_in time; new_out time; existing record;
      BEGIN
        SELECT * INTO c FROM clock_corrections WHERE id = p_id;
        IF c.correction_time IS NOT NULL THEN
          new_in  := CASE WHEN c.type = '上班打卡' THEN c.correction_time END;
          new_out := CASE WHEN c.type = '下班打卡' THEN c.correction_time END;
          SELECT * INTO existing FROM attendance_records WHERE employee = c.employee AND date = c.date LIMIT 1;
          IF FOUND THEN
            UPDATE attendance_records SET clock_in = COALESCE(new_in, clock_in), clock_out = COALESCE(new_out, clock_out) WHERE id = existing.id;
          ELSE
            INSERT INTO attendance_records (employee, date, clock_in, clock_out, status) VALUES (c.employee, c.date, new_in, new_out, '補登');
          END IF;
        END IF;
      END;
    END IF;

    RETURN json_build_object('ok', true, 'status', result_status,
      'event', CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
  END IF;

  -- ════ expense_request 走 chain ════
  IF p_type = 'expense_request' THEN
    SELECT * INTO v_er FROM expense_requests WHERE id = p_id AND deleted_at IS NULL;  -- ★ soft-delete filter
    IF v_er.id IS NULL OR v_er.status <> '申請中' THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.organization_id IS NOT NULL AND v_er.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;
    IF v_er.approval_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;

    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step;
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
    END IF;
    IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_er.employee_id) THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_er.approval_chain_id;
    v_is_last := (v_er.current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      UPDATE expense_requests SET status='已退回', reject_reason=reject_val, approved_by=emp.name WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已退回', 'event','rejected',
        'rejected_at_step', v_er.current_step,
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    END IF;

    IF v_is_last THEN
      UPDATE expense_requests SET status='已核准', approved_by=emp.name, approved_at=NOW() WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已核准', 'event','approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    ELSE
      UPDATE expense_requests SET current_step=current_step+1 WHERE id=p_id;
      SELECT * INTO v_next_step FROM approval_chain_steps
       WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step + 1;
      SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
       WHERE e.status='在職' AND e.organization_id = v_er.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_er.employee_id);
      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
        FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
      RETURN json_build_object('ok', true, 'status','簽核中', 'event','advanced',
        'advanced_to_step', v_er.current_step + 1, 'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    END IF;
  END IF;

  -- ════ form_submission 委派給已有 chain-advance 邏輯的 RPC ════
  -- form_submission_chain_approve 內部已驗 status，但建議該函數也加 deleted_at filter
  IF p_type = 'form_submission' THEN
    v_fs_result := public.form_submission_chain_approve(
      p_id, emp.id, p_action, p_reason, '[]'::jsonb
    );
    RETURN v_fs_result;
  END IF;

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END
$$;


-- ── 10. liff_approve_off_request — off_requests 加 deleted_at ────────────────
CREATE OR REPLACE FUNCTION public.liff_approve_off_request(
  p_line_user_id text, p_id integer, p_action text, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp        employees;
  v_req      record;
  v_eligible BOOLEAN;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_req FROM public.off_requests
   WHERE id = p_id AND deleted_at IS NULL;  -- ★ soft-delete filter
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_req.status <> '待審核' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  IF v_req.organization_id IS DISTINCT FROM emp.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORG_MISMATCH');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public._resolve_hr_approver_ids(v_req.employee_id)
    WHERE _resolve_hr_approver_ids = emp.id
  ) INTO v_eligible;

  IF NOT v_eligible THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.off_requests SET
      status = '已核准',
      approver_id = emp.id,
      approver_name = emp.name,
      approved_at = now()
     WHERE id = p_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'approved',
      'applicant_emp_id', v_req.employee_id,
      'date', v_req.date
    );
  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
    END IF;

    UPDATE public.off_requests SET
      status = '已駁回',
      approver_id = emp.id,
      approver_name = emp.name,
      approved_at = now(),
      reject_reason = btrim(p_reason)
     WHERE id = p_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'rejected',
      'applicant_emp_id', v_req.employee_id,
      'date', v_req.date,
      'reason', btrim(p_reason)
    );
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
END
$$;


-- ── 11. liff_approve_shift_swap_manager — shift_swaps 加 deleted_at ─────────
CREATE OR REPLACE FUNCTION public.liff_approve_shift_swap_manager(
  p_line_user_id text, p_swap_id integer, p_action text, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp        employees;
  v_swap     record;
  v_a_sched  record;
  v_b_sched  record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_swap FROM public.shift_swaps
   WHERE id = p_swap_id AND deleted_at IS NULL;  -- ★ soft-delete filter
  IF v_swap.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_swap.status <> '待主管核准' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AT_MANAGER_STAGE');
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.stores WHERE id = v_swap.store_id AND manager_id = emp.id)
    OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  IF p_action = 'approve' THEN
    SELECT shift, actual_start, actual_end, actual_hours INTO v_a_sched
      FROM public.schedules
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.requester_id OR employee = v_swap.requester)
     LIMIT 1;
    SELECT shift, actual_start, actual_end, actual_hours INTO v_b_sched
      FROM public.schedules
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.target_id OR employee = v_swap.target)
     LIMIT 1;

    IF v_a_sched.shift IS NULL OR v_b_sched.shift IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SCHEDULE_MISSING');
    END IF;

    UPDATE public.schedules
       SET shift = v_b_sched.shift,
           actual_start = v_b_sched.actual_start,
           actual_end = v_b_sched.actual_end,
           actual_hours = v_b_sched.actual_hours
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.requester_id OR employee = v_swap.requester);

    UPDATE public.schedules
       SET shift = v_a_sched.shift,
           actual_start = v_a_sched.actual_start,
           actual_end = v_a_sched.actual_end,
           actual_hours = v_a_sched.actual_hours
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.target_id OR employee = v_swap.target);

    UPDATE public.shift_swaps
       SET status = '已核准',
           approver_id = emp.id,
           approver_name = emp.name,
           approved_at = now()
     WHERE id = p_swap_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'approved',
      'requester_emp_id', v_swap.requester_id,
      'target_emp_id', v_swap.target_id
    );
  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
    END IF;

    UPDATE public.shift_swaps
       SET status = '已駁回',
           approver_id = emp.id,
           approver_name = emp.name,
           approved_at = now(),
           reject_reason = btrim(p_reason)
     WHERE id = p_swap_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'rejected_by_manager',
      'requester_emp_id', v_swap.requester_id,
      'target_emp_id', v_swap.target_id,
      'reason', btrim(p_reason)
    );
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
END
$$;


COMMENT ON FUNCTION public.liff_list_pending_approvals IS
  '審核中心列表 (LIFF) — 對 9 個 soft-delete 表加 deleted_at IS NULL filter';
COMMENT ON FUNCTION public.liff_list_my_submissions IS
  '我的申請列表 (LIFF) — 對 6 個 soft-delete 表加 deleted_at IS NULL filter';
