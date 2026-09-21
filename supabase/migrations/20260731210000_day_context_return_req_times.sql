-- get_request_day_context 多回單子自己的起訖時間(給加班防呆比對) — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 審核詳情要判「加班時間是否落在排定班表內(A)/是否與當天打卡無交集(B)」,需要加班單
-- 自己的起訖時間。現在 RPC 只回 date/schedule/attendance,補回 req_start/req_end。
-- (承 20260731180000 的換日線邏輯,原樣保留。)
-- ════════════════════════════════════════════════════════════════════════════

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
  v_end   time;
  v_org   int;
  v_boundary int;
  v_result jsonb;
BEGIN
  CASE p_type
    WHEN 'overtime' THEN
      SELECT employee_id, date, start_time, end_time, organization_id
        INTO v_emp, v_date, v_start, v_end, v_org
        FROM public.overtime_requests WHERE id = p_id;
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
    'req_start', v_start,   -- 單子自己的起訖(加班=加班時間;補打卡=補登時間)
    'req_end',   v_end,
    'schedule', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'shift', s.shift, 'absence_type', s.absence_type,
        'actual_start', s.actual_start, 'actual_end', s.actual_end, 'store', s.source_store
      ) ORDER BY s.id)
      FROM public.schedules s WHERE s.employee_id = v_emp AND s.date = v_date), '[]'::jsonb),
    'attendance', (
      SELECT jsonb_build_object(
        'clock_in', a.clock_in, 'clock_out', a.clock_out, 'total_hours', a.total_hours,
        'is_late', a.is_late, 'late_minutes', a.late_minutes)
      FROM public.attendance_records a WHERE a.employee_id = v_emp AND a.date = v_date LIMIT 1)
  ) INTO v_result;

  RETURN v_result;
END $function$;

NOTIFY pgrst, 'reload schema';
