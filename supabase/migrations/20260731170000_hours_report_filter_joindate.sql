-- 每月出缺勤時數表:排除未來才入職者 + 應出勤含請假日 + 行政辦公時數 + 鎖 org — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 承 20260731160000 再修:WHERE 沒濾到職日 → 未來才入職(join_date>當月月底)的人也跑進報表
--   (慘案:王慧甄 8/17 入職卻出現在 7 月)。加 AND (join_date IS NULL OR join_date <= 月底)。
-- 以下同 160000:
-- 承 20260731150000 再修:門市/PT 全天假會把排班換成假別(actual_start=null)→ 應出勤被扣掉。
--   請假不該扣應出勤(他本來就該上班,用假抵掉,時數另列假勤)。改:門市/PT 應出勤 =
--   Σ排班工時 + Σ全天假請假時數(該假起始日若仍保留上班班別=部分假,工時已在班內,不補)。
-- 以下同 150000 的兩個修正:
-- 承 20260731140000 兩個修正:
--  ① 應出勤=0 慘案:行政/總部(salary_structures.employment_category='admin')不是門市輪班制,
--     沒排班 → Σ排班=0。改:行政的應出勤 = 當月「平日(非國定假)且在職期間內」天數 × 辦公淨時數
--     (辦公時間取門市 office_hours,預設 09:00-18:00 → 淨 8h)。門市/PT 維持 Σ排班淨工時。
--  ② 明確鎖 org:加 p_org 參數,前端傳 profile.organization_id;WHERE 用 COALESCE(p_org, current_employee_org())。
-- 先 DROP 舊 2 參數版避免 overload 42725。
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.monthly_attendance_hours_report(text, integer);

CREATE OR REPLACE FUNCTION public.monthly_attendance_hours_report(
  p_year_month text, p_store_id integer DEFAULT NULL, p_org integer DEFAULT NULL
)
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
  v_org        integer := COALESCE(p_org, current_employee_org());
BEGIN
  IF p_store_id IS NOT NULL THEN
    SELECT s.name INTO v_store_name FROM public.stores s WHERE s.id = p_store_id;
  END IF;

  RETURN QUERY
  SELECT
    e.employee_number,
    e.name,
    COALESCE(NULLIF(e.dept, ''), e.store, '—')::text,
    -- 應出勤:行政=平日(非國定假)×辦公淨時數;門市/PT=Σ排班淨工時
    ROUND(
      CASE WHEN ss.employment_category = 'admin' THEN
        ( SELECT COUNT(*)
          FROM generate_series(
                 GREATEST(v_mstart, COALESCE(e.join_date, v_mstart)),
                 LEAST(v_mend, COALESCE(e.resign_date, v_mend)),
                 '1 day'::interval) d(day)
          WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM public.holidays h
                            WHERE h.date = d.day::date AND COALESCE(h.is_workday, true) = false)
        ) * public._shift_seg_hours(
              COALESCE(st.office_hours_start, TIME '09:00'),
              COALESCE(st.office_hours_end,   TIME '18:00'), NULL)
      ELSE
        -- 門市/PT:Σ排班工時 + 全天假請假時數補回(請假不該扣應出勤;部分假已保留原班故不重複補)
        COALESCE((
          SELECT SUM(public._shift_seg_hours(s.actual_start, s.actual_end, s.rest_minutes))
          FROM public.schedules s
          WHERE (s.employee_id = e.id OR s.employee = e.name)
            AND s.date BETWEEN v_mstart AND v_mend
            AND s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL
        ), 0)
        + COALESCE((
          SELECT SUM(l.hours)
          FROM public.leave_requests l
          WHERE (l.employee_id = e.id OR l.employee = e.name)
            AND l.status = '已核准' AND l.deleted_at IS NULL
            AND l.start_date BETWEEN v_mstart AND v_mend
            -- 該假之起始日若仍保留上班班別(部分假)→ 工時已在班內,不補回
            AND NOT EXISTS (
              SELECT 1 FROM public.schedules s3
              WHERE (s3.employee_id = e.id OR s3.employee = e.name)
                AND s3.date = l.start_date
                AND s3.actual_start IS NOT NULL
            )
        ), 0)
      END, 1),
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
      SELECT SUM(CASE WHEN early_min > COALESCE(st.late_tolerance_minutes, 5) THEN early_min ELSE 0 END)
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
  LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
  WHERE e.organization_id = v_org
    AND (e.status = '在職' OR (e.status = '離職' AND e.resign_date >= v_mstart))
    AND (e.join_date IS NULL OR e.join_date <= v_mend)   -- 到職日晚於當月月底(未來才入職)不列入(慘案:王慧甄 8/17 入職卻出現在 7 月)
    AND e.in_payroll
    AND (p_store_id IS NULL OR e.store_id = p_store_id
         OR (v_store_name IS NOT NULL AND v_store_name = ANY(e.additional_stores)))
  ORDER BY e.employee_number NULLS LAST, e.name;
END $function$;

NOTIFY pgrst, 'reload schema';
