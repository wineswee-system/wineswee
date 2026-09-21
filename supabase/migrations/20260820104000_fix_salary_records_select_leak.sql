-- 資安修正:salary_records(員工實際薪資明細)SELECT 用 can_see_request → 店長/主管看得到下屬薪資
-- can_see_request 會對「申請人門市的店長」「主管鏈上任何人」回 true(那是給請假/加班等申請單的垂直可見性用的),
-- 套在薪資明細上 = 店長看得到自己店員工的實際薪水、主管看得到下屬薪水 → 薪資機密外洩。
-- 改成與 payroll_records 相同:本人 OR admin/super_admin(+ service_role 給後端/DEFINER)。
-- 讀者盤點:SelfService(員工看自己 employee_id=self)、HR/admin 頁(Salary/TaxForms/LaborInspection…)、
-- payslip/automation(service_role)。無主管看團隊薪資流程,故不影響現有功能。
DROP POLICY IF EXISTS salary_vsel ON public.salary_records;
DROP POLICY IF EXISTS salary_records_select_self_or_admin ON public.salary_records;
CREATE POLICY salary_records_select_self_or_admin ON public.salary_records FOR SELECT USING (
  (auth.role() = 'service_role')
  OR employee_id = current_employee_id()
  OR is_super_admin()
  OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org())
);
