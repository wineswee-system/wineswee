-- ════════════════════════════════════════════════════════════
-- 員工個別權限 — admin 也能用
-- 2026-05-15
--
-- 原本 set_employee_permission_override 只開 super_admin。
-- 但廠商實際只有 admin 角色 → 加放寬：admin 也能用，但加防呆：
--   - admin 不能改自己（防自己升自己）
--   - admin 不能改 super_admin（防降級超管）
--   - admin 不能改其他 admin（防 admin 互鬥）
--   - super_admin 維持無限制
--
-- get_employee_effective_permissions 不變（原本就允許 admin/super_admin/self）
-- ════════════════════════════════════════════════════════════

BEGIN;

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
  v_caller        employees;
  v_caller_role   TEXT;
  v_target_role   TEXT;
BEGIN
  -- ── 1. 抓呼叫端 ──
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT name INTO v_caller_role FROM roles WHERE id = v_caller.role_id;

  -- ── 2. 只開 super_admin / admin ──
  IF v_caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- ── 3. admin 額外防呆：不能改自己、不能改 super_admin / 其他 admin ──
  IF v_caller_role = 'admin' THEN
    IF p_emp_id = v_caller.id THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_MODIFY_SELF',
        'detail', '管理員不能修改自己的權限，請聯絡超級管理員');
    END IF;

    SELECT r.name INTO v_target_role
      FROM employees e JOIN roles r ON r.id = e.role_id
     WHERE e.id = p_emp_id;

    IF v_target_role IN ('super_admin', 'admin') THEN
      RETURN json_build_object('ok', false, 'error', 'CANNOT_MODIFY_PEER_OR_HIGHER',
        'detail', '管理員不能修改超管或其他管理員的權限');
    END IF;
  END IF;

  -- ── 4. mode 驗證 ──
  IF p_mode NOT IN ('grant', 'revoke', 'reset') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_MODE');
  END IF;

  -- ── 5. reset = 刪除 row ──
  IF p_mode = 'reset' THEN
    DELETE FROM employee_permissions
     WHERE employee_id = p_emp_id AND permission_id = p_perm_id;
    RETURN json_build_object('ok', true, 'mode', 'reset');
  END IF;

  -- ── 6. grant / revoke：UPSERT ──
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
