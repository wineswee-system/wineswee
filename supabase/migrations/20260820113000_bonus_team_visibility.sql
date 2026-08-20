-- 承 20260820110000:老闆決定獎金也比照薪資,開給店長看「自己店底下團隊」。
-- bonus_records SELECT 從「本人或admin」放寬成 can_see_request(本人/admin/該員工門市店長/主管鏈)+ is_super_admin 保底。
-- 寫入維持僅 admin(bonus_records_write_admin 不動,店長只能看不能改)。
-- legal_deductions(法扣)維持鎖住不放寬(法院扣押/債務更敏感)。
DROP POLICY IF EXISTS bonus_records_select_self_or_admin ON public.bonus_records;
DROP POLICY IF EXISTS bonus_records_select_team ON public.bonus_records;
CREATE POLICY bonus_records_select_team ON public.bonus_records FOR SELECT USING (
  public.can_see_request(employee_id) OR is_super_admin()
);
