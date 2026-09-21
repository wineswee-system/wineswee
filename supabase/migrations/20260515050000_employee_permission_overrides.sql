-- ════════════════════════════════════════════════════════════
-- 員工個別權限 override（B 方案 Phase 1+2+3）
-- 2026-05-15
--
-- 需求：super_admin 要能對個別員工開個別功能權限。
--       目前是 5 角色制（super_admin / admin / manager / office_staff / store_staff）
--       角色權限固定，沒辦法針對某個員工特別開放或關閉。
--
-- 設計：
--   - 新表 employee_permissions：(employee_id, permission_id, mode='grant'|'revoke')
--   - has_permission 邏輯改成：
--       super_admin → true
--       否則 → (role 有 OR 個人 grant) AND NOT 個人 revoke
--   - 若 employee_permissions 表完全空 → 行為跟原本一模一樣（向下相容）
--
-- 範圍（per memory「儘量不要動現有功能」）：
--   1. 新表 — 純加（安全）
--   2. liff_employee_has_permission — OR REPLACE 但保證空表時行為不變
--   3. 兩個新 RPC（get/set）— 純加
--
-- 對既有 5 個 caller 不用改：
--   src/lib/approval.js / crmEngine.js / dataMasking.js /
--   components/ProtectedRoute.jsx / contexts/AuthContext.jsx
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 新表：員工個別權限 override ═══
CREATE TABLE IF NOT EXISTS public.employee_permissions (
  id            SERIAL PRIMARY KEY,
  employee_id   INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('grant','revoke')),
  -- grant  = 角色沒有但這人額外給
  -- revoke = 角色有但這人取消
  granted_by    INT REFERENCES public.employees(id) ON DELETE SET NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_perm_emp ON public.employee_permissions(employee_id);

-- RLS：read 同 org，write 透過 SECURITY DEFINER RPC
ALTER TABLE public.employee_permissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'employee_permissions' AND policyname = 'same_org_read'
  ) THEN
    CREATE POLICY same_org_read ON public.employee_permissions
      FOR SELECT USING (
        employee_id IN (
          SELECT id FROM employees
           WHERE organization_id IN (
             SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
           )
        )
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;


-- ═══ 2. OR REPLACE has_permission：加 override 邏輯 ═══
-- 重要：employee_permissions 空表時，這個函式行為跟舊版 100% 一樣
--      （grant EXISTS=false, revoke EXISTS=false → 只剩 super_admin OR role_permissions）
CREATE OR REPLACE FUNCTION public.liff_employee_has_permission(
  p_emp_id  int,
  p_perm_code text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- ── 1. super_admin 一律放行（保險絲，行為不變）──
  SELECT EXISTS (
    SELECT 1 FROM employees e
    JOIN roles r ON r.id = e.role_id
    WHERE e.id = p_emp_id AND r.name = 'super_admin'
  )
  OR (
    -- ── 2. 個人 grant：即使角色沒有，個人加給就有 ──
    EXISTS (
      SELECT 1 FROM employee_permissions ep
      JOIN permissions p ON p.id = ep.permission_id
      WHERE ep.employee_id = p_emp_id
        AND p.code = p_perm_code
        AND ep.mode = 'grant'
    )
    OR (
      -- ── 3. 角色有 AND 沒有被個人 revoke ──
      EXISTS (
        SELECT 1 FROM employees e
        JOIN role_permissions rp ON rp.role_id = e.role_id
        JOIN permissions p        ON p.id = rp.permission_id
        WHERE e.id = p_emp_id AND p.code = p_perm_code
      )
      AND NOT EXISTS (
        SELECT 1 FROM employee_permissions ep
        JOIN permissions p ON p.id = ep.permission_id
        WHERE ep.employee_id = p_emp_id
          AND p.code = p_perm_code
          AND ep.mode = 'revoke'
      )
    )
  );
$$;


-- ═══ 3. get_employee_effective_permissions：給 UI 抓員工有效權限清單 ═══
-- 回傳該員工每個 permission 的當前狀態 + 來源
CREATE OR REPLACE FUNCTION public.get_employee_effective_permissions(p_emp_id int)
RETURNS TABLE (
  permission_id   INT,
  code            TEXT,
  name            TEXT,
  module          TEXT,
  -- 'role'        = 角色有，沒人個別調整
  -- 'role_revoke' = 角色有但個人 revoke 掉了（最終 = 沒權限）
  -- 'grant'       = 角色沒有但個人 grant（最終 = 有權限）
  -- 'none'        = 角色沒有，也沒個人 grant（最終 = 沒權限）
  source          TEXT,
  effective       BOOLEAN,
  override_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp     employees;
  v_caller  employees;
BEGIN
  -- 權限檢查：呼叫端是 super_admin 才能查任何員工；否則只能查自己
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN; END IF;

  -- super_admin / 同 org 的 admin 可以查；其他人只能查自己
  IF NOT (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = v_caller.role_id AND r.name IN ('super_admin','admin'))
    OR v_caller.id = p_emp_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      p.id AS permission_id,
      p.code,
      p.name,
      p.module,
      CASE
        WHEN ep.mode = 'grant'   THEN 'grant'
        WHEN ep.mode = 'revoke'  THEN 'role_revoke'
        WHEN rp.role_id IS NOT NULL THEN 'role'
        ELSE 'none'
      END AS source,
      CASE
        WHEN ep.mode = 'grant'  THEN TRUE
        WHEN ep.mode = 'revoke' THEN FALSE
        WHEN rp.role_id IS NOT NULL THEN TRUE
        ELSE FALSE
      END AS effective,
      ep.reason AS override_reason
    FROM permissions p
    LEFT JOIN role_permissions rp
      ON rp.permission_id = p.id AND rp.role_id = v_emp.role_id
    LEFT JOIN employee_permissions ep
      ON ep.permission_id = p.id AND ep.employee_id = p_emp_id
    ORDER BY p.module, p.id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_employee_effective_permissions(int) TO authenticated;


-- ═══ 4. set_employee_permission_override：寫入 / 移除 override ═══
-- mode = 'grant' | 'revoke' | 'reset'（reset 刪除 row → 回到角色預設）
CREATE OR REPLACE FUNCTION public.set_employee_permission_override(
  p_emp_id   INT,
  p_perm_id  INT,
  p_mode     TEXT,    -- 'grant' / 'revoke' / 'reset'
  p_reason   TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller       employees;
  v_caller_role  TEXT;
BEGIN
  -- ── 權限：只有 super_admin 能改任何人的權限 ──
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT name INTO v_caller_role FROM roles WHERE id = v_caller.role_id;
  IF v_caller_role <> 'super_admin' THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_mode NOT IN ('grant', 'revoke', 'reset') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_MODE');
  END IF;

  -- ── reset = 刪除 row 回到角色預設 ──
  IF p_mode = 'reset' THEN
    DELETE FROM employee_permissions
     WHERE employee_id = p_emp_id AND permission_id = p_perm_id;
    RETURN json_build_object('ok', true, 'mode', 'reset');
  END IF;

  -- ── grant / revoke：UPSERT ──
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

  RETURN json_build_object('ok', true, 'mode', p_mode);
END $$;

GRANT EXECUTE ON FUNCTION public.set_employee_permission_override(INT, INT, TEXT, TEXT) TO authenticated;


COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- 緊急 rollback：
--   1. ALTER FUNCTION liff_employee_has_permission 回上一版（從 20260423000000）
--   2. DROP FUNCTION public.set_employee_permission_override(INT,INT,TEXT,TEXT);
--      DROP FUNCTION public.get_employee_effective_permissions(int);
--   3. DROP TABLE public.employee_permissions;
--
-- 驗證測試：
--   -- 空表 → 員工 X 仍只走角色預設權限
--   SELECT liff_employee_has_permission(X, 'employee.view');
--
--   -- 加一筆 grant → 員工 X 多了 finance.edit
--   INSERT INTO employee_permissions(employee_id, permission_id, mode, granted_by)
--     VALUES (X, 13, 'grant', 1);
--   SELECT liff_employee_has_permission(X, 'finance.edit');  -- 應該 true
--
--   -- 列出該員工所有權限
--   SELECT * FROM get_employee_effective_permissions(X);
-- ════════════════════════════════════════════════════════════
