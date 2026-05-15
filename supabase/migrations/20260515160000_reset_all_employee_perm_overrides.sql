-- ════════════════════════════════════════════════════════════
-- reset_all_employee_permission_overrides: 清光單一員工所有 override
-- 2026-05-15
--
-- 給「全部恢復角色預設」按鈕用。一次 DELETE 比前端 loop N 個 RPC 快。
--
-- 防呆規則跟 set_employee_permission_override 一樣：
--   - 必須是 super_admin / admin
--   - admin 不能清自己 / 不能清 super_admin / 不能清其他 admin
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.reset_all_employee_permission_overrides(p_emp_id INT)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller        employees;
  v_caller_role   TEXT;
  v_target_role   TEXT;
  v_deleted       int;
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

  -- admin 額外防呆
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
  END IF;

  WITH del AS (
    DELETE FROM employee_permissions WHERE employee_id = p_emp_id RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM del;

  RETURN json_build_object('ok', true, 'deleted', v_deleted);
END $$;

GRANT EXECUTE ON FUNCTION public.reset_all_employee_permission_overrides(INT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
