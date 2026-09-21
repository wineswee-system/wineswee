-- 排班寫入:持有 schedule.edit 者(如儲備幹部)可寫自己門市班表 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:儲備幹部靠 position_permissions grant 拿到 schedule.edit → 前端 canEditSchedule 放行、
--   排得了看得到,但 schedules 寫入 RLS(schedules_v_write)三分支
--   (can_manage_emp_store 店長 / supervisor_can_schedule_emp 督導課 / _emp_sees_all_stores view_all)
--   都不含「純持 edit 權限、排自己店」的人 → 存不進 DB(前端能改、後端靜默擋)。
--   實測:潘胤傑#101/呂柏毅#130/馮千瑜#84/温子杰#122 皆 edit=true、view_all=false、
--   can_see_own_store=true,正是這缺口。
-- 修:新增第4分支 perm_edit_can_schedule_emp = 持有 schedule.edit 且「被排員工的門市」在自己
--   可見/可管範圍(_can_see_store_for_emp:本店/user_stores/當店長/督導課)。
--   → 對齊前端非 view_all 的 scope(user_stores + 本店…),不放寬到別店。
--   權限閘門在 schedule.edit,沒這權限的一般店員仍寫不了。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.perm_edit_can_schedule_emp(p_emp_id integer, p_emp_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me        int := current_employee_id();
  v_tgt_store int;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF v_me IS NULL THEN RETURN false; END IF;
  -- 權限閘門:必須持有 schedule.edit(儲備幹部靠 position_permissions grant)
  IF NOT COALESCE(public.liff_employee_has_permission(v_me, 'schedule.edit'), false) THEN
    RETURN false;
  END IF;
  -- 被排員工的門市(id 優先、姓名 fallback,對齊 supervisor_can_schedule_emp / can_manage_emp_store)
  SELECT COALESCE(
    (SELECT store_id FROM public.employees WHERE id = p_emp_id),
    (SELECT store_id FROM public.employees WHERE name = p_emp_name AND status = '在職' ORDER BY id LIMIT 1)
  ) INTO v_tgt_store;
  -- 該門市在我可見/可管範圍內(本店 / user_stores / 當店長 / 督導課)
  RETURN v_tgt_store IS NOT NULL AND public._can_see_store_for_emp(v_me::bigint, v_tgt_store::bigint);
END $function$;

GRANT EXECUTE ON FUNCTION public.perm_edit_can_schedule_emp(integer, text) TO anon, authenticated, service_role;

-- 加入 schedules 寫入 policy 的第4分支(前3分支照 20260727110000 現況原樣帶上)
ALTER POLICY schedules_v_write ON public.schedules
  USING (
    can_manage_emp_store(employee_id, employee)
    OR supervisor_can_schedule_emp(employee_id, employee)
    OR public._emp_sees_all_stores(current_employee_id())
    OR public.perm_edit_can_schedule_emp(employee_id, employee)
  )
  WITH CHECK (
    can_manage_emp_store(employee_id, employee)
    OR supervisor_can_schedule_emp(employee_id, employee)
    OR public._emp_sees_all_stores(current_employee_id())
    OR public.perm_edit_can_schedule_emp(employee_id, employee)
  );

NOTIFY pgrst, 'reload schema';
