-- LIFF 簽核時看申請人「當天班表 vs 實際打卡」— 2026-07-22
-- 忘打卡/加班/請假 三種單審核時,主管點開卡片可對照當天排定班別與實際打卡,判斷合理性。
-- 後端從 source_table+id 解出申請人 employee_id + 相關日期,回班表(schedules)+打卡(attendance_records)。
-- staff 閘(anon LIFF 走 SECURITY DEFINER)。

CREATE OR REPLACE FUNCTION public.liff_get_applicant_day_attendance(
  p_line_user_id text, p_source_table text, p_source_id int
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp_id int;
  v_date   date;
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
    SELECT employee_id, date INTO v_emp_id, v_date FROM public.overtime_requests WHERE id = p_source_id;
  ELSIF p_source_table = 'clock_corrections' THEN
    SELECT employee_id, date INTO v_emp_id, v_date FROM public.clock_corrections WHERE id = p_source_id;
  ELSE
    RETURN json_build_object('ok', false, 'error', 'UNSUPPORTED');
  END IF;

  IF v_emp_id IS NULL OR v_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_DATA');
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
    'schedule', v_sched,   -- null = 當天沒排班
    'clock', v_clock       -- null = 當天沒打卡
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_applicant_day_attendance(text, text, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
