-- 加班審核參考「當天班表/打卡」換日線修正 — 2026-07-20
-- 症狀:打烊/清晨加班(如 7/19 01:00-01:30)其實是前一天(7/18 12:34~7/19 01:33)那個班的尾巴,
--   審核參考卻用加班日期 7/19 查班表/打卡 → 抓到「無排班/無打卡」(資料其實記在 7/18)。
-- 修法:只改 overtime 分支 —— 加班 start_time 早於換日線(organizations.settings.day_boundary_hour,
--   此 org=7,預設 6)時,往前一天查班表 + 打卡並顯示該日。leave/correction/trip 分支完全不動。
-- 唯讀審核參考,不影響實際簽核/計薪。CREATE OR REPLACE,idempotent。

CREATE OR REPLACE FUNCTION public.get_request_day_context(p_type text, p_id int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    WHEN 'leave'      THEN SELECT employee_id, start_date INTO v_emp, v_date FROM public.leave_requests    WHERE id = p_id;
    WHEN 'correction' THEN SELECT employee_id, date       INTO v_emp, v_date FROM public.clock_corrections WHERE id = p_id;
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
END $$;

GRANT EXECUTE ON FUNCTION public.get_request_day_context(text, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
