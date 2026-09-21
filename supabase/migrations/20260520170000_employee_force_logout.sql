-- ════════════════════════════════════════════════════════════════════════════
-- 強制登出：employees 加 force_logout_at + RPC
-- 2026-05-20
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS force_logout_at TIMESTAMPTZ;

-- admin / super_admin 專用：強制特定員工下線
CREATE OR REPLACE FUNCTION public.admin_force_logout(p_emp_id INT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  SELECT r.name INTO v_caller_role
    FROM employees e
    JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid();

  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '無權限執行強制登出' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.employees
     SET force_logout_at = NOW()
   WHERE id = p_emp_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_force_logout(INT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
