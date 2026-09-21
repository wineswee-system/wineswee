-- 請假天數/時數計算 RPC(計算唯一來源)— 2026-07-21 [階段1/4:先建計算,後續才切換]
-- 複刻 src/lib/leaveDaysCalc.js 的 countWorkDays/diffHours/snapToStep + Leave.jsx 的組合邏輯,
--   一字不差搬到後端,讓 web/LIFF/手機共用同一套(根治「跟LIFF對齊」的手動同步)。
-- 純計算(讀 holidays);step 由呼叫端(create_leave_request)解好門市/全公司覆寫後傳進來 → 此函式保持純。
--
-- 規則(對齊 JS):
--   時 mode: hours=diffHours(跨日+24h);GREATEST(0.5);step_unit=hour→snap hours;minute→snap分再/60;days=round(hours/8,1)
--   日 mode: workDays=排除週六日+holidays全部日期(min 1);step_unit=day→snap;否則原值;hours=days*8
--   snapToStep(v,step)=ceil(v/step - 1e-9)*step(往上湊)

CREATE OR REPLACE FUNCTION public.leave_calc_days_hours(
  p_unit       text,   -- 'day' | 'hour'
  p_start_date date,
  p_end_date   date,
  p_start_time time,
  p_end_time   time,
  p_step       numeric DEFAULT 0.5,
  p_step_unit  text    DEFAULT 'day'  -- 'day' | 'hour' | 'minute'
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_step numeric := COALESCE(NULLIF(p_step, 0), 0.5);
  v_mins int;
  v_hours numeric;
  v_workdays int;
  v_days numeric;
BEGIN
  IF p_unit = 'hour' THEN
    -- 跨日時數差
    v_mins := (EXTRACT(HOUR FROM p_end_time)::int * 60 + EXTRACT(MINUTE FROM p_end_time)::int)
            - (EXTRACT(HOUR FROM p_start_time)::int * 60 + EXTRACT(MINUTE FROM p_start_time)::int);
    IF v_mins <= 0 THEN v_mins := v_mins + 1440; END IF;
    v_hours := GREATEST(0.5, v_mins::numeric / 60.0);

    IF p_step_unit = 'hour' THEN
      v_hours := CEIL(v_hours / v_step - 1e-9) * v_step;
    ELSIF p_step_unit = 'minute' THEN
      v_hours := (CEIL((v_hours * 60) / v_step - 1e-9) * v_step) / 60.0;
    END IF;

    v_days := ROUND(v_hours / 8.0, 1);
    RETURN json_build_object('days', v_days, 'hours', v_hours);
  ELSE
    -- 日 mode:排除週六日 + holidays 全部日期(對齊 web:select('date') 不濾 is_workday)
    SELECT GREATEST(1, COUNT(*)) INTO v_workdays
    FROM generate_series(p_start_date, COALESCE(p_end_date, p_start_date), interval '1 day') g
    WHERE EXTRACT(DOW FROM g) NOT IN (0, 6)
      AND g::date NOT IN (SELECT date FROM public.holidays);

    IF p_step_unit = 'day' THEN
      v_days := CEIL(v_workdays / v_step - 1e-9) * v_step;
    ELSE
      v_days := v_workdays;
    END IF;

    RETURN json_build_object('days', v_days, 'hours', v_days * 8);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.leave_calc_days_hours(text, date, date, time, time, numeric, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
