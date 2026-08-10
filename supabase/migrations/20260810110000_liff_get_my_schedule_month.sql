-- LIFF 員工自己看當月排班時段（給打卡月曆比對遲到/早退用）
-- 只回「有排定上班時段」的日子(actual_start 非空);例假/休/請假等無時段的不回。
-- 兩頭班(shift_2)結束時間用 actual_end_2;跨午夜由前端 end<=start 自動 +1440。
-- SECURITY DEFINER 繞 anon RLS。

CREATE OR REPLACE FUNCTION public.liff_get_my_schedule_month(
  p_line_user_id TEXT,
  p_year_month   TEXT   -- YYYY-MM
)
RETURNS TABLE(
  sched_date  DATE,
  start_time  TIME,
  end_time    TIME
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id INT;
  v_name        TEXT;
  v_start       DATE;
  v_end         DATE;
BEGIN
  SELECT employee_id INTO v_employee_id
  FROM public.employee_line_accounts
  WHERE line_user_id = p_line_user_id AND is_verified = TRUE
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RETURN;
  END IF;

  SELECT name INTO v_name FROM public.employees WHERE id = v_employee_id;

  v_start := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + INTERVAL '1 month - 1 day')::DATE;

  RETURN QUERY
    SELECT
      s.date::DATE,
      s.actual_start::TIME,
      COALESCE(s.actual_end_2, s.actual_end)::TIME
    FROM public.schedules s
    WHERE (s.employee_id = v_employee_id OR s.employee = v_name)
      AND s.date BETWEEN v_start AND v_end
      AND s.actual_start IS NOT NULL
      AND COALESCE(s.actual_end_2, s.actual_end) IS NOT NULL
      AND s.absence_type IS NULL;   -- 只留真正上班班(排除 休/休息/例假/國定假 等即使掛了時間的列)
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_my_schedule_month(TEXT, TEXT)
  TO anon, authenticated;
