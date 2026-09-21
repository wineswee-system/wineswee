-- ════════════════════════════════════════════════════════════
-- set_employee_permission_override: 加「不能授出超過自己」保險絲
-- 2026-05-15
--
-- 規則：admin 只能 grant 自己也有的權限，不能 grant 「super_admin 專屬」
--   例如 insurance_rate.edit / system.tenant_manage
--
-- 否則 admin 可以 grant insurance_rate.edit 給某 manager → 該 manager
-- 變相獲得改勞健保級距能力，等於 privilege escalation。
-- ════════════════════════════════════════════════════════════

BEGIN;

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

  -- ── admin 額外防呆 ──
  IF v_caller_role = 'admin' THEN
    -- 1. 不能改自己
    IF p_emp_id = v_caller.id THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_MODIFY_SELF',
        'detail', '管理員不能修改自己的權限，請聯絡超級管理員');
    END IF;

    -- 2. 不能改 super_admin / 其他 admin
    SELECT roles.name INTO v_target_role
      FROM employees e JOIN roles ON roles.id = e.role_id
     WHERE e.id = p_emp_id;

    IF v_target_role IN ('super_admin', 'admin') THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_MODIFY_PEER_OR_HIGHER',
        'detail', '管理員不能修改超管或其他管理員的權限');
    END IF;

    -- 3. ★ 新加：不能授出 admin 自己沒有的權限（防 privilege escalation）
    IF p_mode = 'grant' AND NOT EXISTS (
      SELECT 1 FROM role_permissions
       WHERE role_id = (SELECT id FROM roles WHERE roles.name = 'admin')
         AND permission_id = p_perm_id
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_GRANT_BEYOND_OWN_ROLE',
        'detail', '此權限非管理員預設可用，僅超級管理員可授予');
    END IF;
  END IF;

  IF p_mode NOT IN ('grant', 'revoke', 'reset') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_MODE');
  END IF;

  IF p_mode = 'reset' THEN
    DELETE FROM employee_permissions
     WHERE employee_id = p_emp_id AND permission_id = p_perm_id;
    RETURN json_build_object('ok', true, 'mode', 'reset');
  END IF;

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

COMMIT;

NOTIFY pgrst, 'reload schema';
