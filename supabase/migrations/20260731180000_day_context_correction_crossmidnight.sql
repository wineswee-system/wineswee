-- 補打卡「當天班表·打卡(審核參考)」套換日線 — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- get_request_day_context 對 overtime 有套換日線(清晨在換日線前 → 屬前一天的班),
-- 但 correction 直接用 clock_corrections.date,沒套 → 跨午夜班(如 15:00~00:00)的「下班
-- 00:00 補打卡」會顯示填單日(7/24)的班,而 00:00 其實是前一天(7/23)那張班的下班
-- (7/24 的班要到 7/25 00:00 才下班)→ 審核人看錯天(慘案:吳昕芛 #141 顯示 7/24 無打卡,
--  實際是 7/23 班已打卡 00:12)。
-- 修:correction 分支比照 overtime,correction_time < 換日線(預設 6 點)→ 參考日 -1。
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

-- ── LIFF 版審核參考(同樣沒套換日線,overtime + correction 一起補)──
CREATE OR REPLACE FUNCTION public.liff_get_applicant_day_attendance(p_line_user_id text, p_source_table text, p_source_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp_id int;
  v_date   date;
  v_start  time;
  v_org    int;
  v_boundary int;
  v_sched  json;
  v_clock  json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public._liff_resolve_employee(p_line_user_id) e WHERE e.id IS NOT NULL) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_STAFF');
  END IF;

  -- 解出申請人 + 當天日期(請假取起日)
  IF p_source_table = 'leave_requests' THEN
    SELECT employee_id, start_date INTO v_emp_id, v_date FROM public.leave_requests WHERE id = p_source_id;
  ELSIF p_source_table = 'overtime_requests' THEN
    SELECT employee_id, date, start_time, organization_id INTO v_emp_id, v_date, v_start, v_org FROM public.overtime_requests WHERE id = p_source_id;
  ELSIF p_source_table = 'clock_corrections' THEN
    SELECT employee_id, date, correction_time, organization_id INTO v_emp_id, v_date, v_start, v_org FROM public.clock_corrections WHERE id = p_source_id;
  ELSE
    RETURN json_build_object('ok', false, 'error', 'UNSUPPORTED');
  END IF;

  IF v_emp_id IS NULL OR v_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_DATA');
  END IF;

  -- 換日線:加班/補打卡 於清晨(換日線前)→ 屬前一天的班(如跨午夜 15:00~00:00 班的 00:00)
  IF v_start IS NOT NULL AND p_source_table IN ('overtime_requests', 'clock_corrections') THEN
    SELECT COALESCE(NULLIF(o.settings->>'day_boundary_hour', '')::int, 6) INTO v_boundary
      FROM public.organizations o WHERE o.id = v_org;
    IF v_start < make_time(COALESCE(v_boundary, 6), 0, 0) THEN
      v_date := v_date - 1;
    END IF;
  END IF;

  -- 當天班表(排定/實際班別時間;含兩頭班與請假標記)
  SELECT json_build_object(
    'shift', s.shift, 'actual_start', s.actual_start, 'actual_end', s.actual_end,
    'rest_minutes', s.rest_minutes, 'absence_type', s.absence_type,
    'shift_2', s.shift_2, 'actual_start_2', s.actual_start_2, 'actual_end_2', s.actual_end_2
  ) INTO v_sched
  FROM public.schedules s
  WHERE s.employee_id = v_emp_id AND s.date = v_date
  LIMIT 1;

  -- 當天打卡
  SELECT json_build_object(
    'clock_in', a.clock_in, 'clock_out', COALESCE(a.clock_out, a.clock_out_time),
    'clock_in_mode', a.clock_in_mode, 'is_late', a.is_late,
    'late_minutes', a.late_minutes, 'total_hours', a.total_hours
  ) INTO v_clock
  FROM public.attendance_records a
  WHERE a.employee_id = v_emp_id AND a.date = v_date
  LIMIT 1;

  RETURN json_build_object(
    'ok', true, 'date', v_date,
    'schedule', v_sched,
    'clock', v_clock
  );
END $function$;

NOTIFY pgrst, 'reload schema';
