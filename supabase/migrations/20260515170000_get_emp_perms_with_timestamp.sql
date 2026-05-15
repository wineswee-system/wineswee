-- ════════════════════════════════════════════════════════════
-- get_employee_effective_permissions: 回傳 override 時間
-- 2026-05-15
--
-- UI 上「個人加給/個人禁用」徽章要顯示「何時手動調整的」。
-- 多回傳 override_at（employee_permissions.updated_at）。
-- 沒 override 時為 NULL。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- RETURNS TABLE 加了新欄位 → PG 不讓 OR REPLACE，必須先 DROP
DROP FUNCTION IF EXISTS public.get_employee_effective_permissions(int);

CREATE FUNCTION public.get_employee_effective_permissions(p_emp_id int)
RETURNS TABLE (
  permission_id    INT,
  code             TEXT,
  name             TEXT,
  module           TEXT,
  source           TEXT,
  effective        BOOLEAN,
  override_reason  TEXT,
  override_at      TIMESTAMPTZ
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

  SELECT roles.name INTO v_caller_role FROM roles WHERE roles.id = v_caller.role_id;

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
      ep.reason AS override_reason,
      ep.updated_at AS override_at  -- ★ 新加：override 寫入時間
    FROM permissions p
    LEFT JOIN role_permissions rp
      ON rp.permission_id = p.id AND rp.role_id = v_emp.role_id
    LEFT JOIN employee_permissions ep
      ON ep.permission_id = p.id AND ep.employee_id = p_emp_id
   WHERE (v_caller_role = 'super_admin' OR p.is_active = true)
    ORDER BY p.module, p.id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_employee_effective_permissions(int) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
