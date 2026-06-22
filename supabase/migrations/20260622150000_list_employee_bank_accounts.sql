-- ════════════════════════════════════════════════════════════════════════════
-- list_employee_bank_accounts：撈全機構員工銀行帳號（給薪資結構/匯款帳戶匯出用）
-- 2026-06-22
--
-- employee_bank_accounts RLS 鎖 admin，前端直查會被擋；比照 get_payroll_transfer_file
-- 用 SECURITY DEFINER 讀，但自 guard：登入者必須 admin/super_admin。
-- 回每位有帳號的員工：employee_id / 銀行代號 / 銀行名 / 分行 / 帳號 / 戶名。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.list_employee_bank_accounts(
  p_org INT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result json;
BEGIN
  IF auth.uid() IS NOT NULL AND current_employee_role() NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT COALESCE(json_agg(json_build_object(
    'employee_id',    ba.employee_id,
    'bank_code',      ba.bank_code,
    'bank_name',      ba.bank_name,
    'bank_branch',    ba.bank_branch,
    'bank_account',   ba.bank_account,
    'account_holder', ba.account_holder
  )), '[]'::json)
  INTO v_result
  FROM employee_bank_accounts ba
  WHERE ba.organization_id = p_org;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.list_employee_bank_accounts(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_employee_bank_accounts(INT) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
