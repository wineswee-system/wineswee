-- ════════════════════════════════════════════════════════════════════════════
-- get_payroll_transfer_file：代發薪匯款檔多回傳「身分證字號」
-- 2026-06-22
--
-- 前端匯出代發薪改成 Excel，欄位：身分證字號 / 帳號 / 金額 / 姓名。
-- 身分證字號要從 employees.id_number 帶出，原 RPC 沒回，這裡只「加一個欄位」，
-- 其餘 join / guard / 排序 一律不動。仍 SECURITY DEFINER + 自 guard admin/super_admin。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_payroll_transfer_file(
  p_period TEXT,
  p_org    INT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result json;
BEGIN
  IF auth.uid() IS NOT NULL AND current_employee_role() NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT COALESCE(json_agg(json_build_object(
    'employee_number', e.employee_number,
    'name',            sr.employee,
    'id_number',       e.id_number,
    'bank_code',       ba.bank_code,
    'bank_branch',     ba.bank_branch,
    'bank_account',    ba.bank_account,
    'amount',          sr.net_salary,
    'has_account',     (ba.bank_account IS NOT NULL AND btrim(ba.bank_account) <> '')
  ) ORDER BY e.employee_number NULLS LAST, sr.employee), '[]'::json)
  INTO v_result
  FROM salary_records sr
  LEFT JOIN employees e
    ON e.name = sr.employee AND e.organization_id = p_org
  LEFT JOIN employee_bank_accounts ba
    ON ba.employee_id = e.id
  WHERE sr.organization_id = p_org
    AND sr.month = p_period;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_payroll_transfer_file(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payroll_transfer_file(TEXT, INT) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
