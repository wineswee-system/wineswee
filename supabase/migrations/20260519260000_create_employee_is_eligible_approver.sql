-- ════════════════════════════════════════════════════════════════════════════
-- 補建漏掉的 _employee_is_eligible_approver(int, int, int)
-- ────────────────────────────────────────────────────────────────────────────
-- liff_approve_request 在「沒掛 chain」的 fallback 路徑會呼叫此函式（line 160 of
-- 20260517170000_extra_signer_p3f_rpc_guards.sql），但從未定義 →
-- LIFF 核准會直接撞 42883 'function ... does not exist'。
--
-- 簡化版定義（fallback 用，正規 chain 是 _employee_matches_chain_step）：
-- 同 org + (admin / super_admin / 是 manager / 是 applicant 部門主管 / 是 applicant 直屬主管) → TRUE
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._employee_is_eligible_approver(
  p_emp_id           INT,
  p_applicant_emp_id INT,
  p_org_id           INT
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp employees;
  v_app employees;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  -- 同 org 限制（org_id NULL 視為跳過檢查）
  IF p_org_id IS NOT NULL AND v_emp.organization_id IS DISTINCT FROM p_org_id THEN
    RETURN FALSE;
  END IF;

  -- admin / super_admin → 可簽
  IF v_emp.role IN ('admin', 'super_admin') THEN RETURN TRUE; END IF;

  -- is_manager → 可簽
  IF v_emp.is_manager IS TRUE THEN RETURN TRUE; END IF;

  -- 申請人的直屬主管 / 部門主管 → 可簽
  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
    IF v_app.id IS NOT NULL THEN
      IF v_app.reporting_to IS NOT NULL AND v_app.reporting_to = p_emp_id THEN
        RETURN TRUE;
      END IF;
      IF EXISTS (SELECT 1 FROM departments d
                  WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id) THEN
        RETURN TRUE;
      END IF;
    END IF;
  END IF;

  RETURN FALSE;
END $$;

GRANT EXECUTE ON FUNCTION public._employee_is_eligible_approver(INT, INT, INT)
  TO authenticated, anon, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
