-- 資安修正:薪資機密表的 org 全開 RLS(讀寫都只擋 org → 同組織任何人可讀、甚至可改)
-- 承 20260820100000(salary_structures)。稽核發現同款 org_scope_* 兄弟洩漏:
--   bonus_records  / salary_revisions:SELECT+INSERT+UPDATE+DELETE 都是 (org OR admin) → 店員能看/改/刪獎金、調薪
--   legal_deductions:單一 ALL policy (service OR org IS NULL OR org=self) → 同組織任何人讀寫法扣
-- 改成:讀=本人或 admin/super(salary_revisions 無 employee_id → 純 admin);寫=僅 admin/super/service。
-- 只有 HR/admin 頁(Salary/Bonus/LegalDeductions)與 payroll 引擎讀這些表,無員工自助流程,故不影響現有功能。

-- 共用管理者條件:is_super_admin OR service_role OR (admin/super AND 同org)
-- （salary_structures_self_or_admin 既有正確 policy 的同款寫法）

-- ── bonus_records:讀=本人或admin,寫=admin ──
DROP POLICY IF EXISTS org_scope_select_bonus_records ON public.bonus_records;
DROP POLICY IF EXISTS org_scope_insert_bonus_records ON public.bonus_records;
DROP POLICY IF EXISTS org_scope_modify_bonus_records ON public.bonus_records;
DROP POLICY IF EXISTS org_scope_delete_bonus_records ON public.bonus_records;
DROP POLICY IF EXISTS bonus_records_select_self_or_admin ON public.bonus_records;
DROP POLICY IF EXISTS bonus_records_write_admin ON public.bonus_records;
CREATE POLICY bonus_records_select_self_or_admin ON public.bonus_records FOR SELECT USING (
  employee_id = current_employee_id()
  OR is_super_admin()
  OR (auth.role() = 'service_role')
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
);
CREATE POLICY bonus_records_write_admin ON public.bonus_records FOR ALL USING (
  is_super_admin() OR (auth.role() = 'service_role')
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
) WITH CHECK (
  is_super_admin() OR (auth.role() = 'service_role')
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
);

-- ── legal_deductions:讀=本人或admin,寫=admin ──
DROP POLICY IF EXISTS legal_deductions_org_rls ON public.legal_deductions;
DROP POLICY IF EXISTS legal_deductions_select_self_or_admin ON public.legal_deductions;
DROP POLICY IF EXISTS legal_deductions_write_admin ON public.legal_deductions;
CREATE POLICY legal_deductions_select_self_or_admin ON public.legal_deductions FOR SELECT USING (
  employee_id = current_employee_id()
  OR is_super_admin()
  OR (auth.role() = 'service_role')
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
);
CREATE POLICY legal_deductions_write_admin ON public.legal_deductions FOR ALL USING (
  is_super_admin() OR (auth.role() = 'service_role')
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
) WITH CHECK (
  is_super_admin() OR (auth.role() = 'service_role')
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
);

-- ── salary_revisions:無 employee_id → 純 admin/super(讀寫都是) ──
DROP POLICY IF EXISTS org_scope_select_salary_revisions ON public.salary_revisions;
DROP POLICY IF EXISTS org_scope_insert_salary_revisions ON public.salary_revisions;
DROP POLICY IF EXISTS org_scope_modify_salary_revisions ON public.salary_revisions;
DROP POLICY IF EXISTS org_scope_delete_salary_revisions ON public.salary_revisions;
DROP POLICY IF EXISTS salary_revisions_admin_only ON public.salary_revisions;
CREATE POLICY salary_revisions_admin_only ON public.salary_revisions FOR ALL USING (
  is_super_admin() OR (auth.role() = 'service_role')
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
) WITH CHECK (
  is_super_admin() OR (auth.role() = 'service_role')
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
);
