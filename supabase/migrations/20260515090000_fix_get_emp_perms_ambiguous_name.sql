-- ════════════════════════════════════════════════════════════
-- 修 get_employee_effective_permissions: column reference "name" ambiguous
-- 2026-05-15
--
-- 慘案：RETURNS TABLE 宣告了 `name TEXT` 欄位，函式體內
--   SELECT name INTO v_caller_role FROM roles ...
--                ^^^^
--   PG 不知道這個 name 是 roles.name 還是 RETURNS TABLE 的 OUT param。
--
-- 之所以 CLI 測沒抓到：CLI 沒 auth.uid() → v_caller.id IS NULL → 提早
--   RETURN，根本沒執行到那行。真實 admin 登入才會踩。
--
-- 修法：用 roles.name 明確 qualify
--   （也順手把其他可能 ambiguous 的全部加 prefix 防呆）
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_employee_effective_permissions(p_emp_id int)
RETURNS TABLE (
  permission_id   INT,
  code            TEXT,
  name            TEXT,
  module          TEXT,
  source          TEXT,
  effective       BOOLEAN,
  override_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp           employees;
  v_caller        employees;
  v_caller_role   TEXT;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN; END IF;

  -- ★ 修：roles.name qualify 避免跟 RETURNS TABLE 的 name OUT param 衝突
  SELECT roles.name INTO v_caller_role
    FROM roles
   WHERE roles.id = v_caller.role_id;

  IF NOT (
    v_caller_role IN ('super_admin','admin')
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
   WHERE (v_caller_role = 'super_admin' OR p.is_active = true)
    ORDER BY p.module, p.id;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
