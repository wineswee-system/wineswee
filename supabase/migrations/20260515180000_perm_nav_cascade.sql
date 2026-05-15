-- ════════════════════════════════════════════════════════════
-- 權限級聯：feature perm 全關 → 自動關掉對應 nav.*（sidebar 消失）
-- 2026-05-15
--
-- 邏輯：
--   admin 改了某 feature perm 後，系統檢查同 module 內所有相關 feature perm
--   - 任一 effective=true → 確保 nav 是 ON（清掉 revoke override 或加 grant override）
--   - 全部 effective=false → 確保 nav 是 OFF（加 revoke override 或清掉 grant override）
--
-- mapping 透過 permission_nav_cascade 表設定（不寫死在 function，admin 可改）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. mapping 表 ═══
CREATE TABLE IF NOT EXISTS public.permission_nav_cascade (
  feature_code TEXT NOT NULL,
  nav_code     TEXT NOT NULL,
  PRIMARY KEY (feature_code, nav_code)
);

-- 清空舊資料（保險）+ 重新塞
TRUNCATE public.permission_nav_cascade;

INSERT INTO public.permission_nav_cascade (feature_code, nav_code) VALUES
  -- 薪酬與福利
  ('salary.view_dept',       'nav.salary.basic'),
  ('salary.view_all',        'nav.salary.basic'),
  ('salary.edit',            'nav.salary.basic'),
  ('salary.compute',         'nav.salary.basic'),
  ('salary.pay',             'nav.salary.basic'),
  ('severance.view',         'nav.salary.advanced'),
  ('severance.execute',      'nav.salary.advanced'),
  ('legal_deduction.view',   'nav.salary.advanced'),
  ('legal_deduction.edit',   'nav.salary.advanced'),
  ('bonus.view',             'nav.salary.advanced'),
  ('bonus.compute',          'nav.salary.advanced'),
  ('insurance_rate.view',    'nav.salary.law'),
  ('insurance_rate.edit',    'nav.salary.law'),
  -- 人才發展
  ('recruit.view',           'nav.talent'),
  ('recruit.manage',         'nav.talent'),
  ('training.view',          'nav.talent'),
  ('training.manage',        'nav.talent'),
  ('probation.view',         'nav.talent'),
  ('probation.evaluate',     'nav.talent'),
  -- 員工體驗
  ('survey.view_result',     'nav.experience_mgr'),
  ('ai_attrition.view',      'nav.experience_mgr'),
  -- 行政庶務
  ('expense.view',           'nav.admin_office'),
  ('expense.approve',        'nav.admin_office'),
  ('expense.settle_view',    'nav.admin_office'),
  ('expense.settle',         'nav.admin_office'),
  ('expense.account_view',   'nav.admin_office'),
  ('expense.account_edit',   'nav.admin_office'),
  ('doc.view',               'nav.admin_office'),
  ('doc.delete',             'nav.admin_office'),
  -- 組織架構（內部資料）
  ('org.employee.view',      'nav.org.internal'),
  ('org.employee.view_full', 'nav.org.internal'),
  ('org.employee.edit',      'nav.org.internal'),
  ('org.employee.delete',    'nav.org.internal'),
  ('org.structure.edit',     'nav.org.internal'),
  -- HR 表單建立器
  ('hr_form.template_edit',  'nav.hr_form.builder'),
  -- 專案流程
  ('project.view',           'nav.project.work'),
  ('project.manage',         'nav.project.work'),
  ('task.assign',            'nav.project.work'),
  ('approval_chain.view',    'nav.project.admin'),
  ('approval_chain.edit',    'nav.project.admin');


-- ═══ 2. cascade helper：對單一 (emp, nav_code) 重新評估 nav 狀態 ═══
CREATE OR REPLACE FUNCTION public._cascade_nav_perm(p_emp_id INT, p_nav_code TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_nav_perm_id      INT;
  v_emp_role_id      INT;
  v_any_effective    BOOLEAN;
  v_nav_role_default BOOLEAN;
BEGIN
  SELECT id INTO v_nav_perm_id FROM permissions WHERE code = p_nav_code;
  IF v_nav_perm_id IS NULL THEN RETURN; END IF;

  SELECT role_id INTO v_emp_role_id FROM employees WHERE id = p_emp_id;
  IF v_emp_role_id IS NULL THEN RETURN; END IF;

  -- 是否有「任一」相關 feature perm 對此員工 effective=true
  SELECT EXISTS (
    SELECT 1
      FROM permission_nav_cascade pnc
      JOIN permissions p ON p.code = pnc.feature_code
     WHERE pnc.nav_code = p_nav_code
       AND (
         -- 個人 grant
         EXISTS (
           SELECT 1 FROM employee_permissions ep
            WHERE ep.employee_id = p_emp_id
              AND ep.permission_id = p.id
              AND ep.mode = 'grant'
         )
         OR
         -- 角色預設有 AND 沒被個人 revoke
         (
           EXISTS (
             SELECT 1 FROM role_permissions rp
              WHERE rp.role_id = v_emp_role_id AND rp.permission_id = p.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM employee_permissions ep
              WHERE ep.employee_id = p_emp_id
                AND ep.permission_id = p.id
                AND ep.mode = 'revoke'
           )
         )
       )
  ) INTO v_any_effective;

  -- nav 的角色預設是否有
  SELECT EXISTS (
    SELECT 1 FROM role_permissions rp
     WHERE rp.role_id = v_emp_role_id AND rp.permission_id = v_nav_perm_id
  ) INTO v_nav_role_default;

  IF v_any_effective THEN
    -- 至少一個 feature 有效 → nav 應該 = TRUE
    IF v_nav_role_default THEN
      -- role 預設有 → 清掉 revoke override（若有）
      DELETE FROM employee_permissions
       WHERE employee_id = p_emp_id AND permission_id = v_nav_perm_id AND mode = 'revoke';
    ELSE
      -- role 預設沒 → 確保有 grant override
      INSERT INTO employee_permissions (employee_id, permission_id, mode, granted_by, reason)
      VALUES (p_emp_id, v_nav_perm_id, 'grant', NULL, '系統 cascade 自動加給')
      ON CONFLICT (employee_id, permission_id) DO UPDATE SET
        mode = 'grant',
        reason = '系統 cascade 自動加給',
        updated_at = NOW();
    END IF;
  ELSE
    -- 所有 feature 都無效 → nav 應該 = FALSE
    IF v_nav_role_default THEN
      -- role 預設有 → 加 revoke override
      INSERT INTO employee_permissions (employee_id, permission_id, mode, granted_by, reason)
      VALUES (p_emp_id, v_nav_perm_id, 'revoke', NULL, '系統 cascade 自動禁用')
      ON CONFLICT (employee_id, permission_id) DO UPDATE SET
        mode = 'revoke',
        reason = '系統 cascade 自動禁用',
        updated_at = NOW();
    ELSE
      -- role 預設沒 → 清掉 grant override（若有）
      DELETE FROM employee_permissions
       WHERE employee_id = p_emp_id AND permission_id = v_nav_perm_id AND mode = 'grant';
    END IF;
  END IF;
END $$;


-- ═══ 3. 改 set_employee_permission_override 加 cascade 觸發 ═══
-- 改完 feature perm 後，找對應 nav 重新評估
CREATE OR REPLACE FUNCTION public.set_employee_permission_override(
  p_emp_id   INT,
  p_perm_id  INT,
  p_mode     TEXT,
  p_reason   TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller        employees;
  v_caller_role   TEXT;
  v_target_role   TEXT;
  v_perm_code     TEXT;
  v_nav_code      TEXT;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT roles.name INTO v_caller_role
    FROM roles WHERE roles.id = v_caller.role_id;

  IF v_caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF v_caller_role = 'admin' THEN
    IF p_emp_id = v_caller.id THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_MODIFY_SELF');
    END IF;
    SELECT roles.name INTO v_target_role
      FROM employees e JOIN roles ON roles.id = e.role_id
     WHERE e.id = p_emp_id;
    IF v_target_role IN ('super_admin', 'admin') THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_MODIFY_PEER_OR_HIGHER');
    END IF;
    -- 不能授出自己沒有的 perm
    IF p_mode = 'grant' AND NOT EXISTS (
      SELECT 1 FROM role_permissions
       WHERE role_id = (SELECT id FROM roles WHERE roles.name = 'admin')
         AND permission_id = p_perm_id
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_GRANT_BEYOND_OWN_ROLE');
    END IF;
  END IF;

  IF p_mode NOT IN ('grant', 'revoke', 'reset') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_MODE');
  END IF;

  IF p_mode = 'reset' THEN
    DELETE FROM employee_permissions
     WHERE employee_id = p_emp_id AND permission_id = p_perm_id;
  ELSE
    INSERT INTO employee_permissions (
      employee_id, permission_id, mode, granted_by, reason
    ) VALUES (
      p_emp_id, p_perm_id, p_mode, v_caller.id, p_reason
    )
    ON CONFLICT (employee_id, permission_id) DO UPDATE SET
      mode       = EXCLUDED.mode,
      granted_by = EXCLUDED.granted_by,
      reason     = EXCLUDED.reason,
      updated_at = NOW();
  END IF;

  -- ★ Cascade：找這個 feature perm 對應的所有 nav perm，重新評估
  SELECT code INTO v_perm_code FROM permissions WHERE id = p_perm_id;
  FOR v_nav_code IN
    SELECT DISTINCT nav_code FROM permission_nav_cascade
     WHERE feature_code = v_perm_code
  LOOP
    PERFORM _cascade_nav_perm(p_emp_id, v_nav_code);
  END LOOP;

  RETURN json_build_object('ok', true, 'mode', p_mode);
END $$;


COMMIT;

NOTIFY pgrst, 'reload schema';
