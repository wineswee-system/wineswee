-- ════════════════════════════════════════════════════════════════════════════
-- 稽核全覽權限拆分
--
-- liff.store_audit      = 功能入口（能用稽核功能）
-- liff.store_audit.view_all = 看全部門市稽核單（admin/super_admin + 劉雅玲）
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 新增權限碼 ─────────────────────────────────────────────────────────
INSERT INTO public.permissions (code, name, module, is_active)
VALUES ('liff.store_audit.view_all', 'LIFF：門市稽核全覽', 'LIFF', true)
ON CONFLICT (code) DO NOTHING;

-- ── 2. role_permissions：super_admin(1) + admin(2) ─────────────────────────
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM (VALUES (1), (2)) AS rp(role_id)
CROSS JOIN public.permissions p
WHERE p.code = 'liff.store_audit.view_all'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
     WHERE x.role_id = rp.role_id AND x.permission_id = p.id
  );

-- ── 3. employee_permissions：劉雅玲 個別 grant ────────────────────────────
INSERT INTO public.employee_permissions (employee_id, permission_id, mode)
SELECT e.id, p.id, 'grant'
FROM public.employees e
CROSS JOIN public.permissions p
WHERE e.name = '劉雅玲'
  AND e.organization_id = 1
  AND e.status = '在職'
  AND p.code = 'liff.store_audit.view_all'
ON CONFLICT (employee_id, permission_id) DO NOTHING;

-- ── 4. liff_list_store_audits：v_can_see_all 改查 view_all ─────────────────
CREATE OR REPLACE FUNCTION public.liff_list_store_audits(
  p_line_user_id text,
  p_limit        int DEFAULT 50
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_can_see_all boolean := FALSE;
  v_list        json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT public.liff_employee_has_permission(emp.id, 'liff.store_audit.view_all')
    INTO v_can_see_all;

  SELECT json_agg(row_to_json(t) ORDER BY t.audit_date DESC, t.id DESC) INTO v_list
  FROM (
    SELECT DISTINCT
      sa.id, sa.store_name, sa.audit_date, sa.shift, sa.status,
      sa.auditor_name, sa.total_deducted, sa.total_max_score,
      sa.approval_chain_id, sa.current_step,
      CASE
        WHEN sa.auditor_id = emp.id THEN 'auditor'
        WHEN EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id) THEN 'on_duty'
        ELSE 'approver'
      END AS my_role,
      (sa.status = '申請中'
       AND sa.approval_chain_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM approval_chain_steps acs
          WHERE acs.chain_id = sa.approval_chain_id
            AND acs.step_order = sa.current_step
            AND public._employee_matches_chain_step(emp.id::int, acs.id::int, sa.auditor_id::int, FALSE)
       )) AS need_my_approve
    FROM store_audits sa
    WHERE sa.organization_id = emp.organization_id
      AND (
        v_can_see_all
        OR sa.auditor_id = emp.id
        OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id)
        OR (sa.status = '申請中'
            AND sa.approval_chain_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM approval_chain_steps acs
               WHERE acs.chain_id = sa.approval_chain_id
                 AND acs.step_order = sa.current_step
                 AND public._employee_matches_chain_step(emp.id::int, acs.id::int, sa.auditor_id::int, FALSE)
            ))
      )
    ORDER BY sa.audit_date DESC, sa.id DESC
    LIMIT p_limit
  ) t;

  RETURN json_build_object('ok', true, 'list', COALESCE(v_list, '[]'::json));
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_store_audits(text, int) TO authenticated, anon;

-- ── 5. liff_get_store_audit_detail：v_can_see_all gate ─────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_store_audit_detail(
  p_line_user_id text,
  p_audit_id     int
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_audit       store_audits;
  v_items       json;
  v_on_duty     json;
  v_step        approval_chain_steps;
  v_can_see_all boolean := false;
  v_can_confirm boolean := false;
  v_can_approve boolean := false;
  v_is_related  boolean := false;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT public.liff_employee_has_permission(emp.id, 'liff.store_audit.view_all')
    INTO v_can_see_all;

  SELECT * INTO v_audit FROM store_audits
   WHERE id = p_audit_id AND organization_id = emp.organization_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;

  -- 非全覽身份 → 確認是否有關係（稽核員 / 當班 / 簽核人）
  IF NOT v_can_see_all THEN
    SELECT (
      v_audit.auditor_id = emp.id
      OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = v_audit.id AND od.employee_id = emp.id)
      OR (v_audit.status = '申請中' AND v_audit.approval_chain_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM approval_chain_steps acs
             WHERE acs.chain_id = v_audit.approval_chain_id
               AND acs.step_order = v_audit.current_step
               AND public._employee_matches_chain_step(emp.id::int, acs.id::int, v_audit.auditor_id::int, FALSE)
          ))
    ) INTO v_is_related;
    IF NOT v_is_related THEN
      RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  SELECT json_agg(json_build_object(
    'id', id, 'category_code', category_code, 'category_name', category_name,
    'item_no', item_no, 'item_text', item_text, 'deduct_score', deduct_score,
    'passed', passed,
    'responsible_employee_id', responsible_employee_id,
    'responsible_employee_name', responsible_employee_name,
    'remark', remark,
    'attachments', COALESCE(attachments, '[]'::jsonb)
  ) ORDER BY
    CASE category_code
      WHEN '一' THEN 1 WHEN '二' THEN 2 WHEN '三' THEN 3
      WHEN '四' THEN 4 WHEN '五' THEN 5 WHEN '六' THEN 6
      ELSE 99
    END,
    item_no
  ) INTO v_items
  FROM store_audit_items WHERE audit_id = p_audit_id;

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
      v_can_approve := public._employee_matches_chain_step(
        emp.id::int, v_step.id::int, v_audit.auditor_id::int, FALSE
      );
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'audit', row_to_json(v_audit),
    'items', COALESCE(v_items, '[]'::json),
    'on_duty', COALESCE(v_on_duty, '[]'::json),
    'can_confirm', v_can_confirm,
    'can_approve', v_can_approve
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_store_audit_detail(text, int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
