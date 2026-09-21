-- web 看班表(SELECT)也認「看全公司」→ 不靠主管鏈運氣 — 2026-07-27
-- ════════════════════════════════════════════════════════════════════════════
-- schedules SELECT(schedules_v_sel)原本只 can_see_request(主管鏈:誰 supervisor_id 爬到你)。
-- 營運經理/看全店的人看別店班表原本靠「大家主管鏈剛好接到他」→ 不夠硬。
-- 加 _emp_sees_all_stores(current_employee_id()):跟寫入/鎖定可見一致,直接照資料判「看全公司」。
-- ════════════════════════════════════════════════════════════════════════════
ALTER POLICY schedules_v_sel ON public.schedules
  USING (
    can_see_request(employee_id)
    OR public._emp_sees_all_stores(current_employee_id())
  );

NOTIFY pgrst, 'reload schema';
