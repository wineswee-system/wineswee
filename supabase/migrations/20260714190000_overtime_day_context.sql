-- 加班申請明細帶入當天班表+打卡 — 2026-07-14
-- 審核加班時,自動顯示申請人加班當天的排班+打卡,方便判斷加班合不合理(對照班表/實際打卡)。
-- SECURITY DEFINER 繞前端 RLS(schedules/attendance_records)。回傳 date + schedule[](可空) + attendance(可 null/不完整)。

CREATE OR REPLACE FUNCTION public.get_overtime_day_context(p_overtime_id int)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ot AS (SELECT * FROM public.overtime_requests WHERE id = p_overtime_id)
  SELECT jsonb_build_object(
    'date', ot.date,
    'schedule', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'shift', s.shift, 'absence_type', s.absence_type,
        'actual_start', s.actual_start, 'actual_end', s.actual_end, 'store', s.source_store
      ) ORDER BY s.id)
      FROM public.schedules s WHERE s.employee_id = ot.employee_id AND s.date = ot.date), '[]'::jsonb),
    'attendance', (
      SELECT jsonb_build_object(
        'clock_in', a.clock_in, 'clock_out', a.clock_out, 'total_hours', a.total_hours,
        'is_late', a.is_late, 'late_minutes', a.late_minutes)
      FROM public.attendance_records a WHERE a.employee_id = ot.employee_id AND a.date = ot.date LIMIT 1)
  )
  FROM ot;
$$;
GRANT EXECUTE ON FUNCTION public.get_overtime_day_context(int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
