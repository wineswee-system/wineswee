-- net_work_hours 回到「照班表休息窗 ∩ 打卡」+ ROUND — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 220000 把門市改成「用打卡時長 span 公式」是過度回退:9h 班的人提早走時只扣 30 分,
--   但班表是 9h → 休息該 1h(如張庭瑋 9-18、打卡 08:53-14:01 → 休息窗 13-14 在打卡內 → 扣1h = 4.13h)。
-- 正解:門市&行政都用 _shift_break_context 的「休息窗 ∩ 打卡」:
--   工時 = 打卡時長 −(休息窗 ∩ 打卡)  ← _leave_net_minutes(shift=打卡, leave=打卡)
--   - 整天打卡:休息窗在內 → 扣滿(與 span 公式一致)
--   - 提早走/晚到:只扣「打卡真的涵蓋到的休息」(如打卡在休息窗前 → 不扣)
--   - 行政:午休 12-13 在打卡外(13:15打卡)→ 不扣 → 5.2h
--   - 兩頭班:休息=兩段空檔;連續打卡跨空檔 → 扣掉空檔(兩頭班中間無薪,正確)
--   查無班表/辦公 → 退回 span 階梯公式(不 regress)。一律 ROUND(,2)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.net_work_hours(
  p_emp_id integer, p_date date, p_clock_in time, p_clock_out time
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  ctx    record;
  v_span numeric;
  v_rest integer;
BEGIN
  IF p_clock_in IS NULL OR p_clock_out IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO ctx FROM public._shift_break_context(p_emp_id, p_date);

  IF ctx.shift_start IS NULL AND ctx.break_start IS NULL THEN
    -- 查無班/辦公時間 → 退回 span 階梯公式
    v_span := EXTRACT(EPOCH FROM p_clock_out)/60 - EXTRACT(EPOCH FROM p_clock_in)/60
              + CASE WHEN p_clock_out <= p_clock_in THEN 1440 ELSE 0 END;
    v_rest := CASE WHEN v_span >= 540 THEN 60 WHEN v_span >= 300 THEN 30 ELSE 0 END;
    RETURN ROUND(GREATEST(0, v_span - v_rest) / 60.0, 2);
  END IF;

  RETURN ROUND(public._leave_net_minutes(p_clock_in, p_clock_out, ctx.break_start, ctx.break_end,
                                         p_clock_in, p_clock_out) / 60.0, 2);
END $function$;

NOTIFY pgrst, 'reload schema';
