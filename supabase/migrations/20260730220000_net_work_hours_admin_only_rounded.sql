-- net_work_hours 修正:行政午休窗 + 門市維持原公式 + ROUND — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 前一版(20260730200000)用「班表休息窗」硬套到門市,炸出兩頭班 −3.5h 等離譜波動,
-- 且未 ROUND 產生 ±0.003h 浮點雜訊。改成:
--   行政(employment_category='admin'):工時 = 打卡時長 −(午休 12:00~ ∩ 打卡)
--     → 打卡落在午休外(如 13:15 打卡)就不扣;午休在打卡內(整天班)照扣 = 與原本一致。
--   門市/其他:**維持原本 span 階梯公式**(<5h→0、5~9h→30、≥9h→60),完全不動,避免波動。
--   一律 ROUND 2 位(對齊 Edge Function 的 toFixed(2)、避免雜訊)。
-- _shift_break_context 仍供請假(_leave_net_hours)用,不動。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.net_work_hours(
  p_emp_id integer, p_date date, p_clock_in time, p_clock_out time
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_cat    text;
  v_store  integer;
  v_obreak integer;
  v_ci     numeric;
  v_co     numeric;
  v_span   numeric;
  v_ovl    numeric;
BEGIN
  IF p_clock_in IS NULL OR p_clock_out IS NULL THEN RETURN NULL; END IF;

  v_ci := EXTRACT(EPOCH FROM p_clock_in) / 60;
  v_co := EXTRACT(EPOCH FROM p_clock_out) / 60;
  IF v_co <= v_ci THEN v_co := v_co + 1440; END IF;   -- 跨午夜
  v_span := v_co - v_ci;

  SELECT ss.employment_category, e.store_id
    INTO v_cat, v_store
    FROM public.employees e
    LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = p_emp_id;

  IF COALESCE(v_cat, '') = 'admin' THEN
    SELECT COALESCE(st.office_hours_break_minutes, 60) INTO v_obreak
      FROM public.stores st WHERE st.id = v_store;
    v_obreak := COALESCE(v_obreak, 60);
    -- 午休窗 [12:00, 12:00+obreak] = [720, 720+obreak];與打卡重疊才扣
    v_ovl := GREATEST(0, LEAST(v_co, 720 + v_obreak) - GREATEST(v_ci, 720));
    RETURN ROUND(GREATEST(0, v_span - v_ovl) / 60.0, 2);
  ELSE
    -- 門市/其他:原 span 階梯公式(不動)
    RETURN ROUND(GREATEST(0, v_span
      - CASE WHEN v_span < 300 THEN 0 WHEN v_span < 540 THEN 30 ELSE 60 END) / 60.0, 2);
  END IF;
END $function$;

NOTIFY pgrst, 'reload schema';
