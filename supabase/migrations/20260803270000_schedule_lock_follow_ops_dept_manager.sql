-- 改:班表鎖定/解鎖權限「自動跟隨營運部部門主管」— 2026-08-03
-- ============================================================================
-- 需求:不綁死某人,改成「有 schedule.lock 權限 或 你是『營運部』部門的 manager」都能鎖/解。
--   → 之後在組織圖把營運部主管換人,鎖/解能力自動轉,不用再手動授權。
-- 動:lock_schedule_month / unlock_schedule_month 的權限判斷加 OR departments(name=營運部,
--   manager_id=current_employee_id())。並收回先前綁死張庭瑋(62)的 schedule.lock 個人授權
--   (permission_id 130),讓它純靠部門主管身分(她現在是主管照樣有;若沒授權過此 DELETE 為 no-op)。
--   前端 gate 另在 Schedule.jsx 同步(見該檔改動)。idempotent。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lock_schedule_month(p_store_id integer, p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp_id INT;
  v_start  DATE := (p_month || '-01')::date;
  v_end    DATE := ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date;
  v_count  INT;
BEGIN
  IF NOT ( public.current_employee_has_permission('schedule.lock')
         OR EXISTS (SELECT 1 FROM public.departments d
                     WHERE d.name = '營運部' AND d.manager_id = public.current_employee_id()) ) THEN
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

CREATE OR REPLACE FUNCTION public.unlock_schedule_month(p_store_id integer, p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start DATE := (p_month || '-01')::date;
  v_end   DATE := ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date;
  v_count INT;
BEGIN
  IF NOT ( public.current_employee_has_permission('schedule.lock')
         OR EXISTS (SELECT 1 FROM public.departments d
                     WHERE d.name = '營運部' AND d.manager_id = public.current_employee_id()) ) THEN
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

-- 收回綁死張庭瑋的個人授權(改純自動跟隨部門主管)
DELETE FROM public.employee_permissions WHERE employee_id = 62 AND permission_id = 130;

NOTIFY pgrst, 'reload schema';
