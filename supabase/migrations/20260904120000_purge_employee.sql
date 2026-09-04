-- 2026-09-04 員工「徹底刪除(連根拔起)」RPC
--   用途:報到當天不錄用/誤建的空帳號 → 不留任何紀錄。
--   權限:admin / super_admin,且同租戶。
--   安全閘:已有薪資紀錄(payroll_records/salary_records)者拒絕硬刪 → 請改走「離職」(法遵留紀錄)。
--   作法:動態刪除所有含 employee_id 的 base table + 以姓名存的排班 + 員工本人。不可復原。

CREATE OR REPLACE FUNCTION public.purge_employee(p_emp_id int)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_emp  public.employees;
  v_role text;
  v_tbl  text;
BEGIN
  v_role := public.current_employee_role();
  IF COALESCE(v_role, '') NOT IN ('admin', 'super_admin') THEN
    RETURN json_build_object('ok', false, 'error', 'NO_PERMISSION');
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF NOT public._same_org_or_super(v_emp.organization_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NO_PERMISSION');
  END IF;

  -- 安全閘:有薪資紀錄不可硬刪
  IF EXISTS (SELECT 1 FROM public.payroll_records WHERE employee_id = p_emp_id)
     OR EXISTS (SELECT 1 FROM public.salary_records WHERE employee_id = p_emp_id) THEN
    RETURN json_build_object('ok', false, 'error', 'HAS_PAYROLL',
      'message', '此員工已有薪資紀錄,不可徹底刪除;請改用「離職」保留紀錄');
  END IF;

  -- 動態刪除所有含 employee_id 的 base table(排除 employees 本身與 views)
  FOR v_tbl IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'employee_id'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name <> 'employees'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE employee_id = $1', v_tbl) USING p_emp_id;
  END LOOP;

  -- 以姓名存的排班(schedules.employee 文字欄)
  DELETE FROM public.schedules WHERE employee = v_emp.name AND organization_id = v_emp.organization_id;

  -- 員工本人
  DELETE FROM public.employees WHERE id = p_emp_id;

  RETURN json_build_object('ok', true, 'name', v_emp.name);
END $fn$;

REVOKE ALL ON FUNCTION public.purge_employee(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_employee(int) TO authenticated;
