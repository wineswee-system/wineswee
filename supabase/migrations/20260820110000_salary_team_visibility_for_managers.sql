-- B 方案:店長/主管看得到「自己底下(團隊)」的薪資,但看不到別店/總部/全公司(跟排班同一套階層可見性)。
-- 用 can_see_request(employee_id):回 true 給 本人 / admin / 該員工門市的店長(stores.manager_id) / 主管鏈上的人。
-- 只放寬 salary_structures + salary_records 的 SELECT;寫入維持僅 admin(店長不能改薪資)。
-- 加 is_super_admin() 保底:can_see_request 對跨 org 一律 false,super_admin(org 可能為 null)要能全看。
-- bonus_records / legal_deductions / salary_revisions 維持鎖住(較敏感 / HR 內部),不在此放寬。

-- salary_structures:SELECT → 團隊可見
DROP POLICY IF EXISTS salary_structures_self_or_admin ON public.salary_structures;
DROP POLICY IF EXISTS salary_structures_select_team ON public.salary_structures;
CREATE POLICY salary_structures_select_team ON public.salary_structures FOR SELECT USING (
  public.can_see_request(employee_id) OR is_super_admin()
);

-- salary_records:SELECT → 團隊可見(等於還原成原本的 can_see_request 行為)
DROP POLICY IF EXISTS salary_records_select_self_or_admin ON public.salary_records;
DROP POLICY IF EXISTS salary_records_select_team ON public.salary_records;
CREATE POLICY salary_records_select_team ON public.salary_records FOR SELECT USING (
  public.can_see_request(employee_id) OR is_super_admin()
);
