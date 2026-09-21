-- 通用「當天班表 + 打卡」審核參考 — 2026-07-20
-- 原本只有加班(get_overtime_day_context)有;放寬到 請假/補打卡/出差,讓儀表板簽核時
--   一眼看到申請人當天排班 + 實際打卡,判斷單子合不合理。
-- 不動舊的 get_overtime_day_context(加班頁還在用);新增一支通用版即可。
-- SECURITY DEFINER 繞前端 RLS(schedules/attendance_records)。
--   請假/出差取 start_date 當天;加班/補打卡取 date。回傳 {date, schedule[], attendance}。

CREATE OR REPLACE FUNCTION public.get_request_day_context(p_type text, p_id int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp  int;
  v_date date;
  v_result jsonb;
BEGIN
  CASE p_type
    WHEN 'overtime'   THEN SELECT employee_id, date       INTO v_emp, v_date FROM public.overtime_requests WHERE id = p_id;
    WHEN 'leave'      THEN SELECT employee_id, start_date  INTO v_emp, v_date FROM public.leave_requests    WHERE id = p_id;
    WHEN 'correction' THEN SELECT employee_id, date        INTO v_emp, v_date FROM public.clock_corrections WHERE id = p_id;
    WHEN 'trip'       THEN SELECT employee_id, start_date  INTO v_emp, v_date FROM public.business_trips    WHERE id = p_id;
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
END $$;

GRANT EXECUTE ON FUNCTION public.get_request_day_context(text, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
