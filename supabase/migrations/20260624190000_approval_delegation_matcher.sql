-- ════════════════════════════════════════════════════════════════════════════
-- 代簽：_employee_matches_chain_step 支援簽核代理(approval_delegation_rules)
-- 2026-06-24
--
-- 既有 approval_delegation_rules 表(委託人→代理人+日期範圍)只有空表沒接邏輯。
-- 這裡讓「比對函式」認代理人:若 p_emp 是某人 active 代理人、且委託人滿足此關 → 也通過。
-- 一改全簽核共用(canApprove 待簽清單 + 各 step_advance 授權) → 代理人即可代簽。
--
-- 安全:
--  - 完整重現原函式所有 target_type 分支(逐字,勿漏)。
--  - 加 p_via_delegation 防遞迴參數:代簽只展開「一層」(代理人→委託人直接比對),
--    不會代理人的代理人無限遞迴。
--  - 先 DROP 舊三參,避免 overload 歧義(3 參呼叫命中四參有預設那支)。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public._employee_matches_chain_step(INT, INT, INT);

CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(
  p_emp_id            INT,
  p_step_id           INT,
  p_applicant_emp_id  INT DEFAULT NULL,
  p_via_delegation    BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step approval_chain_steps;
  v_emp  employees;
  v_app  employees;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_step_id;
  IF v_step.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  -- ★ 代簽:若 p_emp 是某人的 active 代理人,且委託人滿足此關 → 通過。
  --   p_via_delegation=TRUE 時跳過(只展開一層,防遞迴)。
  IF NOT p_via_delegation THEN
    IF EXISTS (
      SELECT 1 FROM approval_delegation_rules dr
       WHERE dr.delegate_employee_id = p_emp_id
         AND dr.is_active
         AND CURRENT_DATE >= dr.effective_from
         AND (dr.effective_to IS NULL OR CURRENT_DATE <= dr.effective_to)
         AND public._employee_matches_chain_step(dr.delegator_employee_id, p_step_id, p_applicant_emp_id, TRUE)
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

  IF v_step.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  ELSIF v_step.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    -- 門市課別督導 = 我，或（課別解不出督導 AND 我是申請人本人 AND 我本身是某課督導）
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

GRANT EXECUTE ON FUNCTION public._employee_matches_chain_step(INT, INT, INT, BOOLEAN) TO authenticated, anon;

-- ── 修 approval_delegation_rules 的 USING(true) 寫洞 → admin 或「委託人本人」可管理 ──
--   非 admin 只能設「自己為委託人」的代理(把自己的簽核權暫時讓給別人),不能替別人設。
DROP POLICY IF EXISTS "delegation_rules_ins" ON approval_delegation_rules;
DROP POLICY IF EXISTS "delegation_rules_upd" ON approval_delegation_rules;
DROP POLICY IF EXISTS "delegation_rules_del" ON approval_delegation_rules;
CREATE POLICY "delegation_rules_ins" ON approval_delegation_rules FOR INSERT
  WITH CHECK (is_admin() OR delegator_employee_id = current_employee_id());
CREATE POLICY "delegation_rules_upd" ON approval_delegation_rules FOR UPDATE
  USING (is_admin() OR delegator_employee_id = current_employee_id())
  WITH CHECK (is_admin() OR delegator_employee_id = current_employee_id());
CREATE POLICY "delegation_rules_del" ON approval_delegation_rules FOR DELETE
  USING (is_admin() OR delegator_employee_id = current_employee_id());

-- ── 權限碼:簽核代理設定(管理頁 gate) ──
INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('approval.delegate_manage', '簽核代理設定', '專案流程', true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, module = EXCLUDED.module, is_active = EXCLUDED.is_active;
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.name IN ('super_admin', 'admin') AND p.code = 'approval.delegate_manage'
ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
