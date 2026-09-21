-- ════════════════════════════════════════════════════════════════════════════
-- 跨店打卡支援：DB 層更新
--
-- 配合 supabase/functions/clock-in/index.ts 改成依 employees.additional_stores
-- 自動辨識實際門市的修改，DB 這邊也要：
--
-- 1. admin_attendance_diff_report — 篩 store 時要納入「跨店訪客」員工
--    （additional_stores 含該店名）
-- 2. liff_get_stores_for_employee — 新 RPC 回 JSON array
--    （主要店 + additional_stores 對應的 store rows）→ LIFF Clock.jsx 用
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. admin_attendance_diff_report：篩 store 時納入跨店員工 ───
CREATE OR REPLACE FUNCTION public.admin_attendance_diff_report(
  p_year_month TEXT,
  p_store_id   INT DEFAULT NULL
)
RETURNS TABLE (
  employee_id    INT,
  employee_name  TEXT,
  store_name     TEXT,
  diff_count     BIGINT,
  notified       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_name TEXT;
BEGIN
  -- 篩選的那間店的店名（給 additional_stores TEXT[] 比對）
  IF p_store_id IS NOT NULL THEN
    SELECT name INTO v_store_name FROM public.stores WHERE id = p_store_id;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.name,
    s.name,
    (SELECT COUNT(*) FROM public.monthly_attendance_diff(e.id, p_year_month)
       WHERE diff_type IS NOT NULL) AS diff_count,
    EXISTS(SELECT 1 FROM public.attendance_diff_notifications n
           WHERE n.employee_id = e.id AND n.year_month = p_year_month) AS notified
  FROM public.employees e
  LEFT JOIN public.stores s ON s.id = e.store_id
  WHERE e.status = '在職'
    AND (
      p_store_id IS NULL
      OR e.store_id = p_store_id
      OR (v_store_name IS NOT NULL AND v_store_name = ANY(e.additional_stores))
    )
  ORDER BY diff_count DESC, e.name;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_attendance_diff_report(TEXT, INT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_attendance_diff_report(TEXT, INT) IS
  '月結打卡核對報表：admin 用，依 store 篩選時納入「跨店訪客」員工（additional_stores 含該店名）。';


-- ─── 2. liff_get_stores_for_employee：新 RPC 回多家候選店 ───
-- 用於 LIFF Clock.jsx：員工跨店打卡時要 loop 各候選店算距離，找到「員工在範圍內」的那家
-- 回傳 JSON array：[{id, name, lat, lng, clock_radius, allowed_wifi, ...}]
-- 第一筆 = primary store；其後 = additional_stores
CREATE OR REPLACE FUNCTION public.liff_get_stores_for_employee(p_employee_id INT)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_agg(
    json_build_object(
      'id',                     s.id,
      'name',                   s.name,
      'lat',                    s.lat,
      'lng',                    s.lng,
      'clock_radius',           s.clock_radius,
      'allowed_wifi',           s.allowed_wifi,
      'late_tolerance_minutes', s.late_tolerance_minutes,
      'early_clock_minutes',    s.early_clock_minutes,
      'clock_in_method',        s.clock_in_method,
      'is_primary',             (s.id = e.store_id)
    )
    ORDER BY (s.id = e.store_id) DESC, s.name
  )
  FROM public.employees e
  CROSS JOIN LATERAL (
    SELECT * FROM public.stores
     WHERE id = e.store_id
        OR name = ANY(COALESCE(e.additional_stores, '{}'::TEXT[]))
  ) s
  WHERE e.id = p_employee_id;
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_stores_for_employee(INT)
  TO anon, authenticated;

COMMENT ON FUNCTION public.liff_get_stores_for_employee(INT) IS
  '回該員工所有授權門市（主要店 + additional_stores）。LIFF Clock.jsx 跨店打卡 UI 用。';


COMMIT;

NOTIFY pgrst, 'reload schema';

-- 健檢
DO $$
DECLARE
  v_count INT;
  v_test JSON;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM pg_proc WHERE proname IN
      ('admin_attendance_diff_report', 'liff_get_stores_for_employee');
  RAISE NOTICE 'admin_attendance_diff_report + liff_get_stores_for_employee 共 % 個 function', v_count;

  -- 測 RPC 對員工 148（黃蘊珊）回多少家店
  SELECT public.liff_get_stores_for_employee(148) INTO v_test;
  RAISE NOTICE '黃蘊珊 (id=148) 授權門市：%', v_test;
END $$;
