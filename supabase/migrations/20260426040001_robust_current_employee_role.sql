-- ============================================================
-- 修：current_employee_role() 原本只讀 employees.role text 欄位
-- 但 RBAC 5 角色制後資料是寫在 employees.role_id → roles 表
-- 如果有人沒同步填 role text 就會 NULL → RLS 全部擋
--
-- 改：優先讀 roles.code (透過 role_id JOIN)，fallback 才讀 role text
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT e.id, e.role AS role_text, r.name AS role_name
      FROM employees e
      LEFT JOIN roles r ON r.id = e.role_id
     WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
     LIMIT 1
  )
  SELECT COALESCE(role_name, role_text) FROM me;
$$;

GRANT EXECUTE ON FUNCTION public.current_employee_role() TO authenticated, anon;


-- 順便：debug 用 RPC，讓你直接從前端拉自己的 session 對應狀態
CREATE OR REPLACE FUNCTION public.debug_my_session()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'auth_uid',   auth.uid(),
    'auth_email', (SELECT email FROM auth.users WHERE id = auth.uid()),
    'employee',   (
      SELECT json_build_object(
        'id', e.id, 'name', e.name, 'email', e.email,
        'role_text', e.role, 'role_id', e.role_id, 'role_name', r.name,
        'organization_id', e.organization_id
      )
      FROM employees e LEFT JOIN roles r ON r.id = e.role_id
      WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
      LIMIT 1
    ),
    'resolved_role', public.current_employee_role()
  );
$$;

GRANT EXECUTE ON FUNCTION public.debug_my_session() TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
