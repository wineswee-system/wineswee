-- ════════════════════════════════════════════════════════════════════════════
-- 稽核室全覽：liff_list_store_audits 加 can_store_audit 全覽分支
--
-- 有 liff.store_audit 權限的人（稽核室）→ 看全部
-- 其他人 → 原本邏輯（我是稽核員 / 當班 / 簽核人）
-- ════════════════════════════════════════════════════════════════════════════

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

  -- 有 liff.store_audit 權限 → 稽核室，看全部
  SELECT public.liff_employee_has_permission(emp.id, 'liff.store_audit')
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
            AND public._employee_matches_chain_step(emp.id, acs.id, sa.auditor_id)
       )) AS need_my_approve
    FROM store_audits sa
    WHERE sa.organization_id = emp.organization_id
      AND (
        -- 稽核室：看全部，不限自己的
        v_can_see_all
        -- 一般員工：只看自己相關的
        OR sa.auditor_id = emp.id
        OR EXISTS (SELECT 1 FROM store_audit_on_duty od WHERE od.audit_id = sa.id AND od.employee_id = emp.id)
        OR (sa.status = '申請中'
            AND sa.approval_chain_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM approval_chain_steps acs
               WHERE acs.chain_id = sa.approval_chain_id
                 AND acs.step_order = sa.current_step
                 AND public._employee_matches_chain_step(emp.id, acs.id, sa.auditor_id)
            ))
      )
    ORDER BY sa.audit_date DESC, sa.id DESC
    LIMIT p_limit
  ) t;

  RETURN json_build_object('ok', true, 'list', COALESCE(v_list, '[]'::json));
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_store_audits(text, int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
