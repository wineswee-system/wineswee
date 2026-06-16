-- ════════════════════════════════════════════════════════════════════════════
-- get_payroll_transfer_file：代發薪匯款檔資料（薪資 net + 銀行帳號 join）
-- 2026-06-16
--
-- 把某月已存的 salary_records.net_salary（你對過的實領）配上 employee_bank_accounts
-- 的帳號，給前端「匯出代發薪檔」用。SECURITY DEFINER（帳號表 RLS 鎖 admin，
-- 故用 definer 讀），但自己 guard：登入者必須 admin/super_admin。
--
-- 回每位「本月有薪資紀錄」的員工：員工編號 / 戶名 / 銀行代號 / 分行 / 帳號 / 金額(net)
-- / has_account（沒帳號的前端會排除並提醒）。
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
