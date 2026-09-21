-- 修:排班「選門市看不到員工」— employees SELECT policy 補上「看全公司」helper — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:20260727110000 把集中 helper _emp_sees_all_stores(=admin OR schedule.view_all
--   OR 營運部經理)掛到 schedules_v_write / schedule_month_locks / LIFF 選店,但
--   【漏掛到 employees 的 SELECT policy(employees_select_v4)】。
--   結果:有 schedule.view_all 的人(例:周容甄,manager+view_all)能「選門市/寫班表」跨店,
--   但員工名冊走 employees RLS,manager 只看得到自己門市 → 選別店抓不到員工。
--   ※ current_employee_role() 用 role_id→roles.name(非 role 文字欄),所以 role 文字 drift
--     不影響本問題;此為 helper 覆蓋不全,非角色問題。
-- 修法:employees_select_v4 增量加一支 OR:_emp_sees_all_stores(自己) AND 同 org。
--   非 true、helper 把關、org-scoped、僅 SELECT;anon 無 employee → helper 回 false 不受影響。
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS employees_select_v4 ON public.employees;
CREATE POLICY employees_select_v4 ON public.employees
FOR SELECT USING (
  (auth.role() = 'service_role')
  OR is_super_admin()
  OR (auth_user_id = auth.uid())
  OR (current_employee_role() IN ('admin','office_staff')
      AND organization_id = current_user_org_id())
  OR (current_employee_role() = 'manager'
      AND store_id = current_user_store_id())
  OR (current_employee_role() = 'store_staff'
      AND store_id = current_user_store_id())
  -- ★ 新增:有「看全公司」能力者(admin / schedule.view_all / 營運部經理)看全 org 員工(排班名冊用)
  OR (public._emp_sees_all_stores(current_employee_id())
      AND organization_id = current_user_org_id())
);

NOTIFY pgrst, 'reload schema';
