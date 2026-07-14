-- 兼職特休額度計算(6個月實際排班時數比例) — 2026-07-14
-- 規則:PT特休 = base(依年資:滿6月24h/滿1年56h/滿2年80h…) × min(1, 近6個月實際排班時數 / 1040)
--   1040 = 26週 × 40h(全職6個月時數)。窗口=結算日往前推6個月。跨午夜/兩段班都算。
-- ⚠️ 需歷史班表匯入後才有正確結果(現在班表不全→時數偏低)。先建函式,資料到位自動生效。
-- 尚未接進 _compute 折現(等班表匯入再接)。

-- 班次區段時數(time→time,跨午夜+24;含 NULL 防呆)
CREATE OR REPLACE FUNCTION public._seg_hours(s time, e time)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN s IS NULL OR e IS NULL THEN 0
    ELSE EXTRACT(EPOCH FROM (e - s)) / 3600.0 + CASE WHEN e < s THEN 24 ELSE 0 END
  END;
$$;

-- 年資→法定特休天數(週年制)
CREATE OR REPLACE FUNCTION public._annual_leave_days(p_years numeric)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_years IS NULL OR p_years < 0.5 THEN 0
    WHEN p_years < 1  THEN 3
    WHEN p_years < 2  THEN 7
    WHEN p_years < 3  THEN 10
    WHEN p_years < 5  THEN 14
    WHEN p_years < 10 THEN 15
    ELSE LEAST(30, 15 + floor(p_years - 10)::int)
  END;
$$;

-- 兼職特休時數 = base(年資) × min(1, 近6個月實際排班時數 / 1040)
CREATE OR REPLACE FUNCTION public.calc_pt_annual_leave_hours(p_emp_id int, p_as_of date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_join   date;
  v_years  numeric;
  v_base_h numeric;
  v_worked numeric;
  v_ratio  numeric;
BEGIN
  SELECT join_date INTO v_join FROM public.employees WHERE id = p_emp_id;
  IF v_join IS NULL OR p_as_of IS NULL THEN RETURN 0; END IF;

  v_years  := (p_as_of - v_join) / 365.25;
  v_base_h := public._annual_leave_days(v_years) * 8;      -- 法定天數 × 8
  IF v_base_h = 0 THEN RETURN 0; END IF;                    -- 未滿6個月無特休

  -- 近6個月實際排班工作時數(排除請假/休;含兩段班;跨午夜)
  SELECT COALESCE(SUM(
      CASE WHEN s.actual_start IS NOT NULL
           THEN public._seg_hours(s.actual_start, s.actual_end)
           ELSE COALESCE(s.actual_hours, 0) END
    + public._seg_hours(s.actual_start_2, s.actual_end_2)
  ), 0)
  INTO v_worked
  FROM public.schedules s
  WHERE s.employee_id = p_emp_id
    AND s.date >= (p_as_of - INTERVAL '6 months')::date
    AND s.date <  p_as_of
    AND s.absence_type IS NULL
    AND COALESCE(s.shift,'') NOT IN ('休','例假','休息','特休','病','事','會議','產','補休','國定');

  v_ratio := LEAST(1, v_worked / 1040.0);                   -- 1040 = 26週×40h
  RETURN round(v_base_h * v_ratio, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.calc_pt_annual_leave_hours(int, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
