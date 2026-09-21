-- ════════════════════════════════════════════════════════════════════════════
-- 修復：_employee_matches_chain_step 3-param/4-param 衝突 → LIFF 簽核中心全鎖
-- 2026-07-01
--
-- 根因：
--   20260624190000 建了 (INT, INT, INT, BOOLEAN DEFAULT FALSE) — 含代簽邏輯
--   20260630250000 又建了 (INT, INT, INT)                      — 含 L2/L3 邏輯
--   兩個都能接受 3-int 呼叫 → PG 42725 "not unique"
--   liff_list_pending_approvals 整支 throw → data.can 退回預設 {hr:false}
--
-- 修法（incremental，不改其他消費端）：
--   1. 把 L2/L3 logic 合入 4-param (INT, INT, INT, BOOLEAN DEFAULT FALSE) 版
--   2. DROP 掉 3-param (INT, INT, INT) 版，消除歧義
--   3. BIGINT wrapper (20260624230000) 已呼叫 4-param → 不動
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 合併版 4-param：代簽 + L2/L3 + 全 target_type ────────────────────
CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(
  p_emp_id            INT,
  p_step_id           INT,
  p_applicant_emp_id  INT DEFAULT NULL,
  p_via_delegation    BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step  approval_chain_steps;
  v_emp   employees;
  v_app   employees;
  v_l1_id INT;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_step_id;
  IF v_step.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  -- ★ 代簽：若 p_emp 是某人的 active 代理人，且委託人滿足此關 → 通過。
  --   p_via_delegation=TRUE 時跳過（只展開一層，防遞迴）。
  IF NOT p_via_delegation THEN
    IF EXISTS (
      SELECT 1 FROM approval_delegation_rules dr
       WHERE dr.delegate_employee_id = p_emp_id
         AND dr.is_active
         AND CURRENT_DATE >= dr.effective_from
         AND (dr.effective_to IS NULL OR CURRENT_DATE <= dr.effective_to)
         AND public._employee_matches_chain_step(
               dr.delegator_employee_id, p_step_id, p_applicant_emp_id, TRUE
             )
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  IF v_step.target_type = 'fixed_emp' THEN
    RETURN v_step.target_emp_id = p_emp_id;
  ELSIF v_step.target_type = 'fixed_role' THEN
    RETURN v_step.target_role_id = v_emp.role_id;
  ELSIF v_step.target_type = 'fixed_dept' THEN
    RETURN v_step.target_dept_id = v_emp.department_id;
  END IF;

  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  IF v_step.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  -- ★ L2：申請人直屬主管的上級
  IF v_step.target_type = 'applicant_supervisor_l2' AND v_app.id IS NOT NULL THEN
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = COALESCE(v_app.supervisor_id, v_app.reporting_to);
    RETURN v_l1_id IS NOT NULL AND v_l1_id = p_emp_id;
  END IF;

  -- ★ L3：申請人直屬主管的上級的上級
  IF v_step.target_type = 'applicant_supervisor_l3' AND v_app.id IS NOT NULL THEN
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_l1_id IS NULL THEN RETURN FALSE; END IF;
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = v_l1_id;
    RETURN v_l1_id IS NOT NULL AND v_l1_id = p_emp_id;
  END IF;

  IF v_step.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  ELSIF v_step.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (
      EXISTS (SELECT 1 FROM stores s
                JOIN department_sections ds ON ds.id = s.section_id
               WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id)
      OR (
        p_emp_id = v_app.id
        AND NOT EXISTS (SELECT 1 FROM stores s
                          JOIN department_sections ds ON ds.id = s.section_id
                         WHERE s.id = v_app.store_id AND ds.supervisor_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id)
      )
    );
  END IF;

  IF v_step.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_step.target_dept_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_step.target_store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM department_sections ds
                    WHERE ds.id = v_step.target_section_id AND ds.supervisor_id = p_emp_id);
  END IF;

  RETURN FALSE;
END $$;

GRANT EXECUTE ON FUNCTION public._employee_matches_chain_step(INT, INT, INT, BOOLEAN)
  TO authenticated, anon, service_role;

-- ── 2. 移除歧義的 3-param 版（邏輯已合入上面的 4-param DEFAULT 版）────────
DROP FUNCTION IF EXISTS public._employee_matches_chain_step(INT, INT, INT);

NOTIFY pgrst, 'reload schema';
