-- LIFF 門市稽核可見性對齊 Web 矩陣 + 入口對看得到的人開 — 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════
-- 續 20260723130000(Web RLS)。LIFF 這端:liff_list_store_audits 只回 view_all(全狀態)/
-- 稽核員自己/當班/待簽,沒有「店長/督導看自己店已核准」;入口(HRHub)只吃 liff.store_audit
-- 填寫權限→店長沒填寫權限=沒入口。對齊矩陣:
--   A. _can_see_store_for_emp(emp,store):emp.id 版門市可見(LIFF anon 無 auth,can_see_store 失效)
--   B. liff_list_store_audits:加「已核准+可見店(店長/督導/營運view_all)」;view_all 收斂成只已核准;
--      草稿只給 admin/稽核室(view_draft)/該單稽核員。當班/待簽保留。
--   C. liff_get_employee_by_line_user:加 can_view_store_audit(填寫OR view_all OR 稽核室 OR admin
--      OR 店長 OR 督導)→ 前端入口對看得到的人開(前端另改)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── A. emp.id 版門市可見(比照 can_see_store 但參數化,不靠 auth) ──
CREATE OR REPLACE FUNCTION public._can_see_store_for_emp(p_emp_id bigint, p_store_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p_emp_id IS NOT NULL AND p_store_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_emp_id AND e.store_id = p_store_id)
    OR EXISTS (SELECT 1 FROM public.stores s WHERE s.id = p_store_id AND s.manager_id = p_emp_id)
    OR EXISTS (SELECT 1 FROM public.user_stores us WHERE us.employee_id = p_emp_id AND us.store_id = p_store_id)
    OR EXISTS (SELECT 1 FROM public.stores st JOIN public.department_sections ds ON ds.id = st.section_id
                WHERE st.id = p_store_id AND ds.supervisor_id = p_emp_id)
  );
$function$;

-- ── B. liff_list_store_audits:加矩陣(其餘與 live 逐字一致) ──
CREATE OR REPLACE FUNCTION public.liff_list_store_audits(p_line_user_id text, p_limit integer DEFAULT 50)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees; v_can_see_all boolean := FALSE; v_draft_access boolean := FALSE; v_list json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT public.liff_employee_has_permission(emp.id, 'liff.store_audit.view_all') INTO v_can_see_all;
  -- 全狀態(含草稿):admin 以上 / 稽核室(view_draft)
  SELECT (EXISTS (SELECT 1 FROM roles r WHERE r.id = emp.role_id AND r.name IN ('admin','super_admin'))
          OR public.liff_employee_has_permission(emp.id, 'store_audit.view_draft'))
    INTO v_draft_access;

  SELECT json_agg(row_to_json(t) ORDER BY t.audit_date DESC, t.id DESC) INTO v_list
  FROM (
    SELECT DISTINCT
      sa.id, sa.store_name, sa.audit_date, sa.shift, sa.status,
      sa.auditor_name, sa.total_deducted, sa.total_max_score, sa.avg_score,
      sa.approval_chain_id, sa.current_step,
      CASE
        WHEN sa.auditor_id = emp.id THEN 'auditor'
        WHEN EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id) THEN 'on_duty'
        ELSE 'approver'
      END AS my_role,
      (sa.status = '申請中' AND sa.approval_chain_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM approval_chain_steps acs
          WHERE acs.chain_id = sa.approval_chain_id AND acs.step_order = sa.current_step
            AND public._employee_matches_chain_step(emp.id::int, acs.id::int, sa.auditor_id::int, FALSE))) AS need_my_approve
    FROM store_audits sa
    WHERE sa.organization_id = emp.organization_id
      AND (
        v_draft_access                                          -- admin/稽核室 → 全狀態
        OR sa.auditor_id = emp.id                               -- 該單稽核員 → 全狀態(自己的)
        OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id)  -- 當班人
        OR (sa.status = '申請中' AND sa.approval_chain_id IS NOT NULL   -- 待我簽核
            AND EXISTS (SELECT 1 FROM approval_chain_steps acs
               WHERE acs.chain_id = sa.approval_chain_id AND acs.step_order = sa.current_step
                 AND public._employee_matches_chain_step(emp.id::int, acs.id::int, sa.auditor_id::int, FALSE)))
        OR (sa.status = '已核准'                                 -- 已核准 + 可見店:店長/督導/營運部經理
            AND (v_can_see_all OR public._can_see_store_for_emp(emp.id::bigint, sa.store_id::bigint)))
      )
    ORDER BY sa.audit_date DESC, sa.id DESC
    LIMIT p_limit
  ) t;

  RETURN json_build_object('ok', true, 'list', COALESCE(v_list, '[]'::json));
END $function$;

-- ── C. liff_get_employee_by_line_user:加 can_view_store_audit(給前端入口判斷) ──
CREATE OR REPLACE FUNCTION public.liff_get_employee_by_line_user(p_line_user_id text)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (
    row_to_json(e.*)::jsonb
    || jsonb_build_object(
         'can_store_audit',
         public.liff_employee_has_permission(e.id, 'liff.store_audit'),
         'can_view_store_audit',
         (public.liff_employee_has_permission(e.id, 'liff.store_audit')
          OR public.liff_employee_has_permission(e.id, 'liff.store_audit.view_all')
          OR public.liff_employee_has_permission(e.id, 'store_audit.view_draft')
          OR EXISTS (SELECT 1 FROM roles r WHERE r.id = e.role_id AND r.name IN ('admin','super_admin'))
          OR EXISTS (SELECT 1 FROM stores s WHERE s.manager_id = e.id)
          OR EXISTS (SELECT 1 FROM department_sections ds WHERE ds.supervisor_id = e.id))
       )
  )::json
  FROM employees e
  JOIN employee_line_accounts ela ON ela.employee_id = e.id
  WHERE ela.line_user_id = p_line_user_id
    AND e.status = '在職'
  ORDER BY ela.is_primary DESC, ela.id ASC
  LIMIT 1
$function$;

GRANT EXECUTE ON FUNCTION public._can_see_store_for_emp(bigint, bigint) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
