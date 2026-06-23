-- ════════════════════════════════════════════════════════════════════════════
-- 後台「重設員工薪資密碼」RPC
-- 2026-06-23
--
-- 管理者(super_admin/admin)把某員工的 line_pin_hash 清成 NULL，
-- 員工下次在 LIFF 查薪資會被引導重新設定 PIN。
-- 守門：is_admin() + 限同 organization；純清空，不影響任何薪資資料。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reset_employee_salary_pin(p_employee_id int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  UPDATE public.employees
     SET line_pin_hash = NULL
   WHERE id = p_employee_id
     AND organization_id = public.current_employee_org()
  RETURNING name INTO v_name;

  IF v_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object('ok', true, 'name', v_name);
END $$;

GRANT EXECUTE ON FUNCTION public.reset_employee_salary_pin(int) TO authenticated;
