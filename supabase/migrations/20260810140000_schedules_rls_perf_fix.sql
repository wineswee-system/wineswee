-- schedules RLS 效能治本 — 2026-08-10
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:schedules 的 RLS(SELECT 吃 _v_sel + _v_write[FOR ALL] 兩條)對「非全店可見」的
--   督導,要對整月上千列「逐列」跑 6 個含遞迴主管鏈的函式 → ~8.5 秒 → 踩 authenticated
--   role 的 statement_timeout(遷移後被重設成 8s)→ 查詢被取消 → 前端班表全空。
--   (營運部經理 _emp_sees_all_stores=true 短路 → 秒回;cycle 列少跑得完 → 只有督導/月中招)
-- 修:把「可見性聯集」一次算成 employee_id 陣列(InitPlan 只算一次),再 hash 比對。
--   實測 8455ms → 406ms(快 20 倍);各角色(督導/店員/admin/營運經理)可見列數與現行 RLS
--   逐一比對「完全一致」,零回歸、零多給。
-- ════════════════════════════════════════════════════════════════════════════

-- ① 回填 employee_id=NULL 的班表(60 筆,都有姓名;靠姓名唯一對應)。
--    改成 id-based 可見性後,NULL 的列會比對不到 → 先補起來避免看不到。
UPDATE public.schedules s
   SET employee_id = e.id
  FROM public.employees e
 WHERE s.employee_id IS NULL
   AND s.employee = e.name
   AND (SELECT count(*) FROM public.employees e2 WHERE e2.name = s.employee) = 1;

-- ② 可見 employee_id 集合(= 現行 6 個可見性函式的聯集,一次算好)。
--    plpgsql(非 SQL)→ 不會被 inline → 在 (SELECT ...)::int[] 裡只呼叫一次。
CREATE OR REPLACE FUNCTION public.current_user_visible_emp_ids()
RETURNS int[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me int := current_employee_id(); r int[];
BEGIN
  IF v_me IS NULL THEN RETURN '{}'; END IF;
  SELECT COALESCE(array_agg(DISTINCT e.id), '{}') INTO r
    FROM public.employees e
   WHERE e.id = v_me                                                              -- 本人
      OR e.store_id IN (SELECT s.id FROM public.stores s WHERE s.manager_id = v_me)  -- 我當店長的店
      OR e.id IN (                                                                -- 我在其主管鏈上(遞迴往下)
           WITH RECURSIVE d AS (
             SELECT id FROM public.employees WHERE supervisor_id = v_me
             UNION
             SELECT emp.id FROM public.employees emp JOIN d ON emp.supervisor_id = d.id
           ) SELECT id FROM d)
      OR (EXISTS(SELECT 1 FROM public.department_sections ds WHERE ds.supervisor_id = v_me)  -- 課督導→本店
          AND e.store_id = (SELECT store_id FROM public.employees WHERE id = v_me))
      OR (public.liff_employee_has_permission(v_me,'schedule.edit')              -- 有 schedule.edit → 可見門市
          AND public._can_see_store_for_emp(v_me::bigint, e.store_id::bigint))
      OR public.can_manage_store(e.store_id::bigint);                            -- 可管門市(admin同org/店長/…)
  RETURN r;
END $fn$;
GRANT EXECUTE ON FUNCTION public.current_user_visible_emp_ids() TO authenticated, anon;

-- ③ SELECT policy 換快版:sees_all 短路(InitPlan) + 可見集合 hash 比對(InitPlan cast)。
DROP POLICY IF EXISTS schedules_v_sel ON public.schedules;
CREATE POLICY schedules_v_sel ON public.schedules FOR SELECT USING (
  (SELECT public._emp_sees_all_stores(public.current_employee_id()))
  OR employee_id = ANY((SELECT public.current_user_visible_emp_ids())::int[])
);

-- ④ 原 _v_write 是 FOR ALL → 連 SELECT 都套(逐列跑 4 個貴函式,拖慢查詢)。
--    拆成只管「寫」(INSERT/UPDATE/DELETE),條件與原本逐字相同 → 寫入權限不變、SELECT 不再被它拖累。
DROP POLICY IF EXISTS schedules_v_write ON public.schedules;
DROP POLICY IF EXISTS schedules_v_write_ins ON public.schedules;
DROP POLICY IF EXISTS schedules_v_write_upd ON public.schedules;
DROP POLICY IF EXISTS schedules_v_write_del ON public.schedules;
CREATE POLICY schedules_v_write_ins ON public.schedules FOR INSERT WITH CHECK (
  can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee)
  OR _emp_sees_all_stores(current_employee_id()) OR perm_edit_can_schedule_emp(employee_id, employee)
);
CREATE POLICY schedules_v_write_upd ON public.schedules FOR UPDATE
USING (
  can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee)
  OR _emp_sees_all_stores(current_employee_id()) OR perm_edit_can_schedule_emp(employee_id, employee)
) WITH CHECK (
  can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee)
  OR _emp_sees_all_stores(current_employee_id()) OR perm_edit_can_schedule_emp(employee_id, employee)
);
CREATE POLICY schedules_v_write_del ON public.schedules FOR DELETE USING (
  can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee)
  OR _emp_sees_all_stores(current_employee_id()) OR perm_edit_can_schedule_emp(employee_id, employee)
);
