-- 資安修正:salary_structures 的 SELECT 被 org 全開 policy 洩漏
-- 症狀:店長(manager)在 /hr/1/salary-structures 看得到全公司薪資。
-- 原因:salary_structures 有兩條 SELECT policy(RLS 多條 = OR):
--   ① org_scope_select_salary_structures:organization_id=current_employee_org() OR is_super_admin()  ← 同組織全看得到(洩漏)
--   ② salary_structures_self_or_admin:employee_id=self OR admin/super_admin                          ← 正確
-- ①把②蓋過去 → 任何在職員工都看得到全部。移除①,只留②(本人或 admin)。
-- 寫入權限維持 salary_structures_admin_write(僅 admin/super_admin),不受影響。
DROP POLICY IF EXISTS org_scope_select_salary_structures ON public.salary_structures;
