-- ════════════════════════════════════════════════════════════════════════════
-- 全面拿掉「自己審自己」過濾：通知 + 待簽列表
-- ────────────────────────────────────────────────────────────────────────────
-- 規則：若 chain step 解出來的人就是申請人本人，允許自審（推 LINE + 顯示在列表）
-- 影響範圍：
--   1. _notify_store_audit_event   — 通知函式
--   2. liff_list_pending_approvals — LIFF 待簽列表（並加 current_step_label）
--   3. web_list_my_pending_approval_ids — Web 我能簽 ID 清單
--   注：shift_swap / off_request 不在此調整，業務邏輯本來就不能跟自己換班/批自己希望休
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════ 1. _notify_store_audit_event：拿掉自推過濾 ══════════════════════════
CREATE OR REPLACE FUNCTION public._notify_store_audit_event(
  p_audit_id INT,
  p_event    TEXT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url       CONSTANT TEXT := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon      CONSTANT TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_audit     store_audits;
  v_step      approval_chain_steps;
  v_total     INT;
  v_count     INT := 0;
  r_target    RECORD;
  v_payload   JSONB;
  v_failed    INT;
  v_step_label TEXT;
  v_step_idx  INT;
BEGIN
  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO v_failed FROM store_audit_items WHERE audit_id = p_audit_id AND passed = FALSE;

  IF p_event = 'chain_step' AND v_audit.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
    SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id;
    v_step_label := COALESCE(v_step.label, v_step.role_name, '第' || (v_audit.current_step + 1) || '關');
    v_step_idx   := v_audit.current_step;
  END IF;

  -- 當班人員（on_duty_confirm/rejected 用）
  IF p_event IN ('on_duty_confirm', 'rejected') THEN
    FOR r_target IN
      SELECT od.employee_id, v.line_user_id, v.liff_id
        FROM store_audit_on_duty od
        JOIN v_employee_line_resolved v ON v.employee_id = od.employee_id
       WHERE od.audit_id = p_audit_id AND od.employee_id IS NOT NULL
         AND v.line_user_id IS NOT NULL
         AND (p_event = 'rejected' OR od.confirmed = FALSE)
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', r_target.employee_id,
        'type', CASE WHEN p_event = 'on_duty_confirm' THEN 'store_audit_on_duty_assigned' ELSE 'store_audit_rejected' END,
        'details', jsonb_build_object(
          'audit_id', p_audit_id, 'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift, 'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed, 'total_deducted', v_audit.total_deducted,
          'reject_reason', v_audit.reject_reason,
          'liff_url', CASE WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
                           ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id END
        )
      );
      PERFORM net.http_post(url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
        timeout_milliseconds := 5000);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  -- ★ chain_step：不再過濾稽核員本人，自審也推
  IF p_event = 'chain_step' AND v_step.id IS NOT NULL THEN
    FOR r_target IN
      SELECT a.emp_id, v.line_user_id, v.liff_id
        FROM resolve_chain_step_approvers(v_step.id, v_audit.auditor_id) a
        JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
       WHERE v.line_user_id IS NOT NULL
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', r_target.emp_id,
        'type', 'store_audit_step_assigned',
        'details', jsonb_build_object(
          'audit_id', p_audit_id, 'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift, 'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed, 'total_deducted', v_audit.total_deducted,
          'current_step_label', v_step_label, 'current_step_index', v_step_idx, 'total_steps', v_total,
          'is_self_approve', r_target.emp_id = v_audit.auditor_id,
          'liff_url', CASE WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
                           ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id END
        )
      );
      PERFORM net.http_post(url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
        timeout_milliseconds := 5000);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  -- 稽核員（approved/rejected 用）
  IF p_event IN ('approved', 'rejected') AND v_audit.auditor_id IS NOT NULL THEN
    FOR r_target IN
      SELECT v.line_user_id, v.liff_id
        FROM v_employee_line_resolved v
       WHERE v.employee_id = v_audit.auditor_id AND v.line_user_id IS NOT NULL
       LIMIT 1
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', v_audit.auditor_id,
        'type', CASE WHEN p_event = 'approved' THEN 'store_audit_approved' ELSE 'store_audit_rejected' END,
        'details', jsonb_build_object(
          'audit_id', p_audit_id, 'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift, 'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed, 'total_deducted', v_audit.total_deducted,
          'reject_reason', v_audit.reject_reason, 'approver', v_audit.approver,
          'liff_url', CASE WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
                           ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id END
        )
      );
      PERFORM net.http_post(url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
        timeout_milliseconds := 5000);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END $$;


-- ════ 2. liff_list_pending_approvals：拿掉自審過濾 + 加 step label ═══════
-- 完整 CREATE OR REPLACE（避免 partial overwrite 災難）
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
      SELECT COALESCE(json_agg((to_jsonb(l.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
        'is_self_approve', l.employee_id = emp.id
      ))::json ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg((to_jsonb(o.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
        'is_self_approve', o.employee_id = emp.id
      ))::json ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),
    'trips', (
      SELECT COALESCE(json_agg((to_jsonb(t.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
        'is_self_approve', e_app.id = emp.id
      ))::json ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),
    'corrections', (
      SELECT COALESCE(json_agg((to_jsonb(c.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
        'is_self_approve', e_app.id = emp.id
      ))::json ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg((to_jsonb(ex.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
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
        'current_step_label', cur_step.label,
        'current_step_target', cur_step.role_name,
        'is_self_approve', er.employee_id = emp.id
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND ((er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg((to_jsonb(er.*) || jsonb_build_object(
        'current_step_label', cur_step.label, 'current_step_target', cur_step.role_name,
        'is_self_approve', er.employee_id = emp.id
      ))::json ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg((to_jsonb(r.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
        'is_self_approve', r.employee_id = emp.id
      ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg((to_jsonb(r.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
        'is_self_approve', r.employee_id = emp.id
      ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg((to_jsonb(r.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
        'is_self_approve', r.employee_id = emp.id
      ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg((to_jsonb(h.*) || jsonb_build_object(
        'current_step_label', cs.label, 'current_step_target', cs.role_name,
        'is_self_approve', h.employee_id = emp.id
      ))::json ORDER BY h.created_at DESC), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
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
        'current_step_label', cur_step.label,
        'current_step_target', cur_step.role_name,
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
      WHERE s.organization_id = emp.organization_id
        AND s.status = '申請中'
        AND (
          (t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id))
          OR public._has_pending_extra_for_me('form_submissions', s.id, emp.id)
        )
    ),
    'task_confirmations', '[]'::json,
    -- shift_swap 業務邏輯本來就不能跟自己換班，保留 requester/target 限制
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
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
        AND COALESCE(ofr.employee_id, -1) <> emp.id
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (public.liff_employee_has_permission(emp.id, 'expense.approve') OR public.liff_employee_has_permission(emp.id, 'expense.settle'))
    )
  ) INTO result;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text) TO authenticated, anon;


-- ════ 3. web_list_my_pending_approval_ids：拿掉自審過濾 ═══════════════════
CREATE OR REPLACE FUNCTION public.web_list_my_pending_approval_ids()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id))
    ),
    'overtime_requests', (
      SELECT COALESCE(json_agg(o.id), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id))
    ),
    'business_trips', (
      SELECT COALESCE(json_agg(t.id), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id))
    ),
    'clock_corrections', (
      SELECT COALESCE(json_agg(c.id), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id))
    ),
    'expenses', (
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
        AND er.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, er.employee_id)
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = er.settle_chain_id AND cs.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.settle_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, er.employee_id)
    ),
    'resignation_requests', (
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
        AND h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id)
    ),
    'form_submissions', (
      SELECT COALESCE(json_agg(s.id), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id AND s.status = '申請中'
        AND t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, s.applicant_id)
    ),
    'shift_swaps', (
      SELECT COALESCE(json_agg(ss.id), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ((ss.status = '待對方同意' AND ss.target_id = emp.id AND ss.source_id <> emp.id)
          OR (ss.status = '待主管核准'
              AND ss.source_id <> emp.id AND ss.target_id <> emp.id
              AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
                   OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))))
    )
  ) INTO result;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.web_list_my_pending_approval_ids() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
