-- LIFF 稽核明細 RPC 可見性對齊矩陣 — 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════
-- 續 20260723150000(list+入口)。liff_get_store_audit_detail 的 gate 只放行
-- view_all/auditor/on_duty/approver → 店長/督導點進明細會 FORBIDDEN。加:
--   - v_draft_access(admin/稽核室 view_draft) → 全狀態
--   - 已核准 + 可見店(_can_see_store_for_emp) → 店長/督導
--   - view_all 收斂成只已核准(移進已核准分支)
-- 其餘 body 與 live 逐字一致。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_get_store_audit_detail(p_line_user_id text, p_audit_id integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees; v_audit store_audits; v_items json; v_on_duty json;
  v_step approval_chain_steps;
  v_can_see_all boolean := false; v_can_confirm boolean := false;
  v_can_approve boolean := false; v_is_related boolean := false;
  v_draft_access boolean := false;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT public.liff_employee_has_permission(emp.id, 'liff.store_audit.view_all') INTO v_can_see_all;
  SELECT (EXISTS (SELECT 1 FROM roles r WHERE r.id = emp.role_id AND r.name IN ('admin','super_admin'))
          OR public.liff_employee_has_permission(emp.id, 'store_audit.view_draft'))
    INTO v_draft_access;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id AND organization_id = emp.organization_id;
  IF v_audit.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND'); END IF;

  -- 可見性矩陣:全狀態(admin/稽核室) / 自己發起 / 當班 / 待我簽(申請中) / 已核准+可見店(店長/督導/營運view_all)
  SELECT (
    v_draft_access
    OR v_audit.auditor_id = emp.id
    OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = v_audit.id AND od.employee_id = emp.id)
    OR (v_audit.status = '申請中' AND v_audit.approval_chain_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM approval_chain_steps acs
           WHERE acs.chain_id = v_audit.approval_chain_id AND acs.step_order = v_audit.current_step
             AND public._employee_matches_chain_step(emp.id::int, acs.id::int, v_audit.auditor_id::int, FALSE)))
    OR (v_audit.status = '已核准'
        AND (v_can_see_all OR public._can_see_store_for_emp(emp.id::bigint, v_audit.store_id::bigint)))
  ) INTO v_is_related;
  IF NOT v_is_related THEN RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;

  SELECT json_agg(json_build_object(
    'id', id, 'category_code', category_code, 'category_name', category_name,
    'relation_group', relation_group, 'group_allot', group_allot,
    'is_star', is_star, 'input_type', input_type, 'group_note', group_note,
    'item_no', item_no, 'item_text', item_text, 'deduct_score', deduct_score,
    'passed', passed, 'remark', remark
  ) ORDER BY
    CASE category_code WHEN '一' THEN 1 WHEN '二' THEN 2 WHEN '三' THEN 3
      WHEN '四' THEN 4 WHEN '五' THEN 5 WHEN '六' THEN 6 ELSE 99 END,
    item_no
  ) INTO v_items FROM store_audit_items WHERE audit_id = p_audit_id;

  SELECT json_agg(json_build_object(
    'employee_id', employee_id, 'employee_name', employee_name,
    'confirmed', confirmed, 'confirmed_at', confirmed_at,
    'signature_data_url', signature_data_url
  ) ORDER BY sort_order) INTO v_on_duty
  FROM store_audit_on_duty WHERE audit_id = p_audit_id;

  IF v_audit.status = '申請中' AND v_audit.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
    IF v_step.id IS NOT NULL THEN
      v_can_approve := public._employee_matches_chain_step(emp.id::int, v_step.id::int, v_audit.auditor_id::int, FALSE);
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'audit', row_to_json(v_audit),
    'items', COALESCE(v_items, '[]'::json), 'on_duty', COALESCE(v_on_duty, '[]'::json),
    'can_confirm', v_can_confirm, 'can_approve', v_can_approve);
END $function$;

NOTIFY pgrst, 'reload schema';
