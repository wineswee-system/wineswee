-- 每月出缺勤時數表 RPC(一鍵匯出用,全部小時) — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 每人每月彙總:應出勤/實際出勤/加班/遲到/早退/忘刷/假勤。定義(對齊系統既有算法):
--   應出勤時數 = Σ 排班淨工時(_shift_seg_hours,扣休息)
--   實際出勤時數 = Σ 打卡淨工時(attendance_records.total_hours,已扣休息)
--   加班時數     = Σ 已核准一般加班 ot_hours(is_exception 非 true)
--   額外加班時數 = Σ 已核准額外加班 ot_hours(is_exception=true)
--   遲到(小時)   = Σ late_minutes ÷ 60
--   早退(小時)   = Σ 每天 GREATEST(0, 排班下班 − 實際下班打卡),超過門市寬限才算(跨午夜校正)
--   忘刷(次)     = 當月補打卡(clock_corrections)申請次數(排除已取消)
--   假勤時數     = Σ 已核准請假 hours(start_date 落在當月)
-- 範圍:在職 + 當月仍在職的離職者;排除編制外(in_payroll=false);可選門市。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.monthly_attendance_hours_report(p_year_month text, p_store_id integer DEFAULT NULL)
 RETURNS TABLE(
   employee_number text, name text, dept text,
   scheduled_hours numeric, actual_hours numeric, ot_hours numeric, extra_ot_hours numeric,
   late_hours numeric, early_leave_hours numeric, missing_punch_count integer, leave_hours numeric
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mstart     date := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  v_mend       date := (to_date(p_year_month || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::date;
  v_store_name text;
BEGIN
  IF p_store_id IS NOT NULL THEN
    SELECT s.name INTO v_store_name FROM public.stores s WHERE s.id = p_store_id;
  END IF;

  RETURN QUERY
  SELECT
    e.employee_number,
    e.name,
    COALESCE(NULLIF(e.dept, ''), e.store, '—')::text,
    -- 應出勤:排班淨工時
    ROUND(COALESCE((
      SELECT SUM(public._shift_seg_hours(s.actual_start, s.actual_end, s.rest_minutes))
      FROM public.schedules s
      WHERE (s.employee_id = e.id OR s.employee = e.name)
        AND s.date BETWEEN v_mstart AND v_mend
        AND s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL
    ), 0), 1),
    -- 實際出勤:打卡淨工時
    ROUND(COALESCE((
      SELECT SUM(a.total_hours)
      FROM public.attendance_records a
      WHERE a.employee_id = e.id AND a.date BETWEEN v_mstart AND v_mend
    ), 0), 1),
    -- 加班:已核准一般加班 ot_hours(is_exception 非 true)
    ROUND(COALESCE((
      SELECT SUM(o.ot_hours)
      FROM public.overtime_requests o
      WHERE (o.employee_id = e.id OR o.employee = e.name)
        AND o.status = '已核准' AND o.deleted_at IS NULL
        AND o.is_exception IS NOT TRUE
        AND o.date BETWEEN v_mstart AND v_mend
    ), 0), 1),
    -- 額外加班:已核准且 is_exception=true 的加班
    ROUND(COALESCE((
      SELECT SUM(o.ot_hours)
      FROM public.overtime_requests o
      WHERE (o.employee_id = e.id OR o.employee = e.name)
        AND o.status = '已核准' AND o.deleted_at IS NULL
        AND o.is_exception IS TRUE
        AND o.date BETWEEN v_mstart AND v_mend
    ), 0), 1),
    -- 遲到(小時):late_minutes ÷ 60
    ROUND(COALESCE((
      SELECT SUM(a.late_minutes)
      FROM public.attendance_records a
      WHERE a.employee_id = e.id AND a.date BETWEEN v_mstart AND v_mend
    ), 0) / 60.0, 2),
    -- 早退(小時):排班下班 − 實際下班打卡,超過門市寬限才算(跨午夜校正)
    ROUND(COALESCE((
      SELECT SUM(
        CASE WHEN early_min > COALESCE(st.late_tolerance_minutes, 5) THEN early_min ELSE 0 END
      )
      FROM (
        SELECT GREATEST(0,
          ( EXTRACT(EPOCH FROM s.actual_end)/60 + CASE WHEN s.actual_end <= s.actual_start THEN 1440 ELSE 0 END )
          - ( EXTRACT(EPOCH FROM a.clock_out)/60 + CASE WHEN a.clock_out < a.clock_in THEN 1440 ELSE 0 END )
        ) AS early_min
        FROM public.attendance_records a
        JOIN public.schedules s
          ON (s.employee_id = e.id OR s.employee = e.name) AND s.date = a.date
        WHERE a.employee_id = e.id AND a.date BETWEEN v_mstart AND v_mend
          AND a.clock_in IS NOT NULL AND a.clock_out IS NOT NULL
          AND s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL
      ) q
    ), 0) / 60.0, 2),
    -- 忘刷:補打卡申請次數(排除已取消)
    COALESCE((
      SELECT COUNT(*)::int
      FROM public.clock_corrections c
      WHERE c.employee = e.name
        AND c.date BETWEEN v_mstart AND v_mend
        AND c.deleted_at IS NULL
        AND COALESCE(c.status, '') <> '已取消'
    ), 0),
    -- 假勤:已核准請假 hours(start_date 落在當月)
    ROUND(COALESCE((
      SELECT SUM(l.hours)
      FROM public.leave_requests l
      WHERE (l.employee_id = e.id OR l.employee = e.name)
        AND l.status = '已核准' AND l.deleted_at IS NULL
        AND l.start_date BETWEEN v_mstart AND v_mend
    ), 0), 1)
  FROM public.employees e
  LEFT JOIN public.stores st ON st.id = e.store_id
  WHERE e.organization_id = current_employee_org()
    AND (e.status = '在職' OR (e.status = '離職' AND e.resign_date >= v_mstart))
    AND e.in_payroll
    AND (p_store_id IS NULL OR e.store_id = p_store_id
         OR (v_store_name IS NOT NULL AND v_store_name = ANY(e.additional_stores)))
  ORDER BY e.employee_number NULLS LAST, e.name;
END $function$;

NOTIFY pgrst, 'reload schema';
