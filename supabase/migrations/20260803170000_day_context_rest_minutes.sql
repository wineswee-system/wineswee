-- get_request_day_context 班表補 rest_minutes + 兩段班 — 2026-08-03
-- 加班警示C(單日總工時>12h)要正確扣休息;兩頭班的手動休息(rest_minutes)與第二段班
-- 原本沒回傳 → web 會算錯。補三欄,對齊 LIFF liff_get_applicant_day_attendance。idempotent。

CREATE OR REPLACE FUNCTION public.get_request_day_context(p_type text, p_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp   int;
  v_date  date;
  v_start time;
  v_org   int;
  v_boundary int;
  v_result jsonb;
BEGIN
  CASE p_type
    WHEN 'overtime' THEN
      SELECT employee_id, date, start_time, organization_id
        INTO v_emp, v_date, v_start, v_org
        FROM public.overtime_requests WHERE id = p_id;
      -- 換日線:清晨(換日線前)開始的加班屬前一天的班 → 往前一天查
      IF v_start IS NOT NULL THEN
        SELECT COALESCE(NULLIF(o.settings->>'day_boundary_hour', '')::int, 6) INTO v_boundary
          FROM public.organizations o WHERE o.id = v_org;
        IF v_start < make_time(COALESCE(v_boundary, 6), 0, 0) THEN
          v_date := v_date - 1;
        END IF;
      END IF;
    WHEN 'correction' THEN
      SELECT employee_id, date, correction_time, organization_id
        INTO v_emp, v_date, v_start, v_org
        FROM public.clock_corrections WHERE id = p_id;
      -- 換日線:清晨(換日線前)補打卡屬前一天的班(如跨午夜 15:00~00:00 班的 00:00 下班歸前一天)
      IF v_start IS NOT NULL THEN
        SELECT COALESCE(NULLIF(o.settings->>'day_boundary_hour', '')::int, 6) INTO v_boundary
          FROM public.organizations o WHERE o.id = v_org;
        IF v_start < make_time(COALESCE(v_boundary, 6), 0, 0) THEN
          v_date := v_date - 1;
        END IF;
      END IF;
    WHEN 'leave'      THEN SELECT employee_id, start_date INTO v_emp, v_date FROM public.leave_requests    WHERE id = p_id;
    WHEN 'trip'       THEN SELECT employee_id, start_date INTO v_emp, v_date FROM public.business_trips    WHERE id = p_id;
    ELSE RETURN NULL;
  END CASE;

  IF v_emp IS NULL OR v_date IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'date', v_date,
    'schedule', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'shift', s.shift, 'absence_type', s.absence_type,
        'actual_start', s.actual_start, 'actual_end', s.actual_end, 'actual_start_2', s.actual_start_2, 'actual_end_2', s.actual_end_2, 'rest_minutes', s.rest_minutes, 'store', s.source_store
      ) ORDER BY s.id)
      FROM public.schedules s WHERE s.employee_id = v_emp AND s.date = v_date), '[]'::jsonb),
    'attendance', (
      SELECT jsonb_build_object(
        'clock_in', a.clock_in, 'clock_out', a.clock_out, 'total_hours', a.total_hours,
        'is_late', a.is_late, 'late_minutes', a.late_minutes)
      FROM public.attendance_records a WHERE a.employee_id = v_emp AND a.date = v_date LIMIT 1)
  ) INTO v_result;

  RETURN v_result;
END $function$

;

NOTIFY pgrst, 'reload schema';
