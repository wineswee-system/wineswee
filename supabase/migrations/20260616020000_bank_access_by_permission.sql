-- ════════════════════════════════════════════════════════════════════════════
-- 銀行帳號 / 代發薪：改為「權限可調」— admin 在權限設定頁決定誰能看
-- 2026-06-16
--
-- 原本寫死「只有 admin/super_admin」。改成吃既有權限「薪資發放 salary.pay」：
--   admin/super_admin 永遠有（控管者）；其餘人 admin 在「權限設定」勾 salary.pay
--   給角色或個別員工，就看得到。前端按鈕 + 後端 RLS/RPC 都吃同一條件（真的鎖）。
--
-- 新增：
--   current_user_can(code)  — 含個人 override 的有效權限布林（super_admin 自動 true）
--   can_manage_bank()       — admin/super_admin OR current_user_can('salary.pay')
-- 改：employee_bank_accounts RLS、import_employee_bank_account、get_payroll_transfer_file
--
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 有效權限布林（對齊 get_employee_effective_permissions 的判定：override > 角色）──
CREATE OR REPLACE FUNCTION public.current_user_can(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me employees; v_eff boolean;
BEGIN
  SELECT * INTO me FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF me.id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM roles r WHERE r.id = me.role_id AND r.name = 'super_admin') THEN
    RETURN true;
  END IF;
  SELECT CASE
    WHEN ep.mode = 'grant'      THEN true
    WHEN ep.mode = 'revoke'     THEN false
    WHEN rp.role_id IS NOT NULL THEN true
    ELSE false
  END
  INTO v_eff
  FROM permissions p
  LEFT JOIN role_permissions rp     ON rp.permission_id = p.id AND rp.role_id = me.role_id
  LEFT JOIN employee_permissions ep ON ep.permission_id = p.id AND ep.employee_id = me.id
  WHERE p.code = p_code
  LIMIT 1;
  RETURN COALESCE(v_eff, false);
END $$;
GRANT EXECUTE ON FUNCTION public.current_user_can(TEXT) TO authenticated, service_role;

-- ── 銀行/代發薪的存取條件：控管者(admin/super_admin) 或 有薪資發放權限 ──
CREATE OR REPLACE FUNCTION public.can_manage_bank()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_employee_role() IN ('admin','super_admin')
      OR public.current_user_can('salary.pay')
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_bank() TO authenticated, service_role;


-- ── employee_bank_accounts RLS：role 寫死 → can_manage_bank() ──
DROP POLICY IF EXISTS emp_bank_admin_select ON public.employee_bank_accounts;
CREATE POLICY emp_bank_admin_select ON public.employee_bank_accounts
  FOR SELECT TO authenticated
  USING ( public.can_manage_bank() AND organization_id = current_user_org_id() );

DROP POLICY IF EXISTS emp_bank_admin_write ON public.employee_bank_accounts;
CREATE POLICY emp_bank_admin_write ON public.employee_bank_accounts
  FOR ALL TO authenticated
  USING ( public.can_manage_bank() AND organization_id = current_user_org_id() )
  WITH CHECK ( public.can_manage_bank() AND organization_id = current_user_org_id() );


-- ── 匯入 RPC：guard 改 can_manage_bank()（service_role 腳本 auth.uid()=null 照樣放行）──
CREATE OR REPLACE FUNCTION public.import_employee_bank_account(
  p_employee_number TEXT, p_name TEXT, p_bank_code TEXT, p_bank_branch TEXT, p_bank_account TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp employees; v_by TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_bank() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  IF p_employee_number IS NOT NULL AND btrim(p_employee_number) <> '' THEN
    SELECT * INTO v_emp FROM employees WHERE employee_number = btrim(p_employee_number) LIMIT 1;
    IF v_emp.id IS NOT NULL THEN v_by := 'employee_number'; END IF;
  END IF;
  IF v_emp.id IS NULL AND p_name IS NOT NULL AND btrim(p_name) <> '' THEN
    SELECT * INTO v_emp FROM employees WHERE name = btrim(p_name) LIMIT 1;
    IF v_emp.id IS NOT NULL THEN v_by := 'name'; END IF;
  END IF;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND',
      'employee_number', p_employee_number, 'name', p_name);
  END IF;

  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_code, bank_branch, bank_account, account_holder)
  VALUES
    (v_emp.id, v_emp.organization_id,
     NULLIF(btrim(p_bank_code),''), NULLIF(btrim(p_bank_branch),''),
     NULLIF(btrim(p_bank_account),''), NULLIF(btrim(p_name),''))
  ON CONFLICT (employee_id) DO UPDATE SET
    bank_code      = EXCLUDED.bank_code,
    bank_branch    = EXCLUDED.bank_branch,
    bank_account   = EXCLUDED.bank_account,
    account_holder = COALESCE(EXCLUDED.account_holder, employee_bank_accounts.account_holder),
    updated_at     = now();

  RETURN jsonb_build_object('ok', true, 'employee_id', v_emp.id, 'name', v_emp.name, 'matched_by', v_by);
END $$;
REVOKE ALL ON FUNCTION public.import_employee_bank_account(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_employee_bank_account(TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated, service_role;


-- ── 代發薪匯出 RPC：guard 改 can_manage_bank() ──
CREATE OR REPLACE FUNCTION public.get_payroll_transfer_file(
  p_period TEXT, p_org INT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result json;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_bank() THEN
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
  LEFT JOIN employees e ON e.name = sr.employee AND e.organization_id = p_org
  LEFT JOIN employee_bank_accounts ba ON ba.employee_id = e.id
  WHERE sr.organization_id = p_org AND sr.month = p_period;

  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_payroll_transfer_file(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payroll_transfer_file(TEXT, INT) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
