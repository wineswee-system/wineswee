-- 排班:營運經理(schedule.view_all)跨店寫入 + 看得到鎖定 — 2026-07-27
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:can_manage_emp_store / can_see_store 都沒認 schedule.view_all → 營運經理(role=manager,
--   靠 schedule.view_all 跨店)碰到兩個問題:
--   A. schedules 寫入(schedules_v_write=can_manage_emp_store OR supervisor_can_schedule_emp)不放行
--      → 存不進其他門市班表。
--   B. schedule_month_locks SELECT(=can_see_store)看不到別店鎖定 → 前端 monthLocks 抓不到 → 以為沒鎖
--      → 已鎖月份格子仍點得開(誤導以為能改;實際 write 被 A 擋)。南京建國正是他 can_see 之外的鎖定店。
-- 修:只在這兩個 schedule RLS 加 OR current_employee_has_permission('schedule.view_all')。
--   不動通用 can_see_store(避免波及門市稽核/申請單等其他網域)。
--   service_role 寫入仍走 can_manage_emp_store 的 service_role 分支,不受影響。
-- ════════════════════════════════════════════════════════════════════════════

-- A. 營運經理寫得進其他門市班表(未鎖月份)
ALTER POLICY schedules_v_write ON public.schedules
  USING (
    can_manage_emp_store(employee_id, employee)
    OR supervisor_can_schedule_emp(employee_id, employee)
    OR current_employee_has_permission('schedule.view_all')
  )
  WITH CHECK (
    can_manage_emp_store(employee_id, employee)
    OR supervisor_can_schedule_emp(employee_id, employee)
    OR current_employee_has_permission('schedule.view_all')
  );

-- B. 營運經理看得到所有門市的月鎖定 → 前端正確擋住已鎖格子
ALTER POLICY schedule_month_locks_st_sel ON public.schedule_month_locks
  USING (
    can_see_store((store_id)::bigint)
    OR current_employee_has_permission('schedule.view_all')
  );

NOTIFY pgrst, 'reload schema';
