-- 特休額度 RPC(含 PT 實際排班框架)— 2026-07-21 [階段2/4]
-- 複刻 leavePolicy.js getAnnualLeaveEntitlement(§38年資階梯) + getPTAnnualLeaveHours(PT比例)。
-- ★ PT 改用「近6個月實際排班時數」算比例(框架先做對;班表匯入越多算越準;無資料 fallback weekly_hours 不歸0)。
--   → 對齊待辦 project_pt_annual_leave_actual_hours,不再用 weekly_hours=40 灌水值。

-- ── PT 平均週工時:近6個月實際排班淨工時 / 26 週;無排班則 fallback employees.weekly_hours ──
CREATE OR REPLACE FUNCTION public.leave_pt_avg_weekly_hours(p_emp_id int)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total numeric;
  v_weeks int;
  v_weekly numeric;
  v_fallback numeric;
BEGIN
  -- 近 182 天(約6個月)實際排班淨工時加總(兩段 shift;休/例假 actual 為 null → _shift_seg_hours 回 0 自動排除)
  -- + 有「實際上班」的週數(以有排班的那些週為分母,避免只有近期資料的人被固定26週低估;資料越多越準)
  SELECT
    COALESCE(SUM(
      public._shift_seg_hours(s.actual_start, s.actual_end, s.rest_minutes)
    + public._shift_seg_hours(s.actual_start_2, s.actual_end_2, NULL)
    ), 0),
    COUNT(DISTINCT date_trunc('week', s.date))
      FILTER (WHERE s.actual_start IS NOT NULL OR s.actual_start_2 IS NOT NULL)
    INTO v_total, v_weeks
  FROM public.schedules s
  WHERE s.employee_id = p_emp_id
    AND s.date >= (CURRENT_DATE - INTERVAL '182 days')
    AND s.date <= CURRENT_DATE
    AND s.absence_type IS NULL;   -- 排除被請假標記的日子

  IF v_total > 0 AND COALESCE(v_weeks, 0) > 0 THEN
    v_weekly := v_total / v_weeks;   -- 平均「每個有上班的週」工時
    RETURN ROUND(v_weekly, 2);
  END IF;

  -- 無排班資料 → fallback 現行 weekly_hours(行為不變,不歸零)
  SELECT COALESCE(weekly_hours, 0) INTO v_fallback FROM public.employees WHERE id = p_emp_id;
  RETURN v_fallback;
END $$;

GRANT EXECUTE ON FUNCTION public.leave_pt_avg_weekly_hours(int) TO authenticated;

-- ── 特休額度:回 FT 天數 / PT 時數 + 年資 + 比例 ──
CREATE OR REPLACE FUNCTION public.leave_annual_entitlement(p_emp_id int)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_emp     public.employees;
  v_years   numeric;
  v_ft_days int;
  v_is_pt   boolean;
  v_avg_wk  numeric;
  v_ratio   numeric;
  v_pt_hours numeric;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL OR v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE', 'ft_days', 0, 'pt_hours', 0, 'years_worked', 0);
  END IF;

  -- 年資(含時間,對齊 JS (now-join)/365.25天)
  v_years := EXTRACT(EPOCH FROM (now() - v_emp.join_date::timestamptz)) / (365.25 * 86400);

  -- §38 年資階梯(逐字對齊 leavePolicy calcEntitlement)
  v_ft_days := CASE
    WHEN v_years < 0.5 THEN 0
    WHEN v_years < 1  THEN 3
    WHEN v_years < 2  THEN 7
    WHEN v_years < 3  THEN 10
    WHEN v_years < 5  THEN 14
    WHEN v_years < 10 THEN 15
    ELSE LEAST(30, 15 + (FLOOR(v_years)::int - 10))
  END;

  v_is_pt := (v_emp.salary_type = 'hourly');

  v_avg_wk := NULL; v_ratio := NULL; v_pt_hours := NULL;
  IF v_is_pt THEN
    v_avg_wk   := public.leave_pt_avg_weekly_hours(p_emp_id);
    v_ratio    := LEAST(1, COALESCE(v_avg_wk, 0) / 40.0);
    v_pt_hours := v_ft_days * 8 * v_ratio;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'is_pt', v_is_pt,
    'years_worked', ROUND(v_years, 1),
    'ft_days', v_ft_days,
    'pt_avg_weekly_hours', v_avg_wk,
    'pt_ratio', v_ratio,
    'pt_hours', v_pt_hours
  );
END $$;

GRANT EXECUTE ON FUNCTION public.leave_annual_entitlement(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
