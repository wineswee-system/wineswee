-- ============================================================
-- 一鍵自助升 super_admin
-- 用法：在主系統前端 console 跑：
--   await window.__supabase__?.rpc?.('dev_promote_self_to_super_admin')
-- 或直接用 supabase JS：
--   await supabase.rpc('dev_promote_self_to_super_admin')
--
-- 找：
--   1. auth.users.email = (current session email)
--   2. employees row with that email
--   3. 若有 → role_id=1 (super_admin) + role='super_admin'
--   4. 若無 → 回報錯誤要先建 employees row 並對好 email
--
-- ※ 這支是 demo / bootstrap 用，正式環境上線前應該改用後台 UI
-- ============================================================

CREATE OR REPLACE FUNCTION public.dev_promote_self_to_super_admin()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_emp_id INT;
  v_super_role_id INT;
BEGIN
  v_email := (SELECT email FROM auth.users WHERE id = auth.uid());
  IF v_email IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_AUTH_SESSION',
      'hint', '前端沒有 Supabase auth session，請先 signInWithPassword 登入');
  END IF;

  SELECT id INTO v_super_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;

  SELECT id INTO v_emp_id FROM employees WHERE email = v_email LIMIT 1;
  IF v_emp_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE_ROW',
      'auth_email', v_email,
      'hint', concat('employees 表沒有 email=', v_email, ' 的紀錄。請手動 INSERT 或改一筆 employees.email = ', v_email));
  END IF;

  UPDATE employees
     SET role_id = v_super_role_id,
         role    = 'super_admin'
   WHERE id = v_emp_id;

  RETURN json_build_object(
    'ok', true,
    'auth_email', v_email,
    'employee_id', v_emp_id,
    'role_id', v_super_role_id,
    'role', 'super_admin',
    'msg', '已升為 super_admin，重新整理頁面即可'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.dev_promote_self_to_super_admin() TO authenticated, anon;
NOTIFY pgrst, 'reload schema';
