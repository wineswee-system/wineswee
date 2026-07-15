-- 排班鎖定/解鎖改權限控制 — 2026-07-15
-- 需求:鎖定+解鎖都限有「schedule.lock」權限者(預設 admin/super_admin,可在權限頁授權他人)。
-- 原本:lock 沒權限檢查(誰都能鎖)、unlock 硬檢查 role in admin/super_admin。改成統一權限碼。

-- ① 新增權限碼(顯示在權限頁「排班管理」模組)
INSERT INTO public.permissions (code, name, module, is_system, is_active)
SELECT 'schedule.lock', '鎖定 / 解鎖班表', '排班管理', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'schedule.lock');

-- ② 預設授權 admin / super_admin（super_admin 本來就恆有,一併寫入明確）
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.name IN ('admin','super_admin') AND p.code = 'schedule.lock'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- ③ 鎖定:加權限檢查(其餘逐字保留)
CREATE OR REPLACE FUNCTION public.lock_schedule_month(p_store_id integer, p_month text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_emp_id INT;
  v_start  DATE := (p_month || '-01')::date;
  v_end    DATE := ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date;
  v_count  INT;
BEGIN
  IF NOT public.current_employee_has_permission('schedule.lock') THEN
    RAISE EXCEPTION '沒有「鎖定/解鎖班表」的權限';
  END IF;

  SELECT id INTO v_emp_id FROM employees
   WHERE auth_user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
   LIMIT 1;

  UPDATE schedules s SET status = 'published'
   WHERE s.date BETWEEN v_start AND v_end
     AND s.employee IN (SELECT name FROM employees WHERE store_id = p_store_id)
     AND s.status = 'draft';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO schedule_month_locks (store_id, month, locked_at, locked_by)
  VALUES (p_store_id, p_month, now(), v_emp_id)
  ON CONFLICT (store_id, month) DO UPDATE
    SET locked_at = now(), locked_by = EXCLUDED.locked_by;

  RETURN jsonb_build_object('ok', true, 'locked_rows', v_count, 'month', p_month);
END $function$;

-- ④ 解鎖:role 硬檢查 → 改權限檢查(其餘逐字保留)
CREATE OR REPLACE FUNCTION public.unlock_schedule_month(p_store_id integer, p_month text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_start DATE := (p_month || '-01')::date;
  v_end   DATE := ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date;
  v_count INT;
BEGIN
  IF NOT public.current_employee_has_permission('schedule.lock') THEN
    RAISE EXCEPTION '沒有「鎖定/解鎖班表」的權限';
  END IF;

  PERFORM set_config('schedules.bypass_lock', 'on', true);

  UPDATE schedules s SET status = 'draft'
   WHERE s.date BETWEEN v_start AND v_end
     AND s.employee IN (SELECT name FROM employees WHERE store_id = p_store_id)
     AND s.status = 'published';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM schedule_month_locks WHERE store_id = p_store_id AND month = p_month;

  RETURN jsonb_build_object('ok', true, 'unlocked_rows', v_count, 'month', p_month);
END $function$;

NOTIFY pgrst, 'reload schema';
