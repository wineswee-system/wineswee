-- 工時扣休息也走「休息時段 ∩ 打卡時段」+ 收斂共用 break-window — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 破綻:打卡 13:15–18:27(午休12-13在打卡外)卻硬扣 1h → 工時 4.2h;應 5.2h(休息在打卡外不扣)。
-- 做法:抽出「班/休息窗」單一來源 _shift_break_context,請假 & 工時共用同一把尺:
--   工時 = 打卡時段 −(休息窗 ∩ 打卡時段)  ← 用 _leave_net_minutes(shift=clock, leave=clock) 直接得
--   請假 = 請假時段 −(休息窗 ∩ 請假時段)  ← _leave_net_hours 改走 context(行為不變,重驗)
-- 純加/收斂函式,不接任何寫入。前端/Edge/計薪之後改走 net_work_hours(另處理)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 單一來源:某員工某日的「班窗 + 休息窗」──
--    行政:辦公時間 + 固定午休 12:00 起(長度 office_hours_break_minutes)
--    門市:讀班表;一般班休息=上班+4h(長度 rest_minutes 或公式 <5h→0/5~9h→30/≥9h→60);兩頭班=中間空檔
--    查無 → 全回 NULL(呼叫端 fallback)
CREATE OR REPLACE FUNCTION public._shift_break_context(p_emp_id integer, p_date date)
RETURNS TABLE(shift_start time, shift_end time, break_start time, break_end time)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_cat text; v_store_id integer;
  v_has_office boolean; v_os time; v_oe time; v_obreak integer;
  sc public.schedules; v_span_min numeric; v_break_min integer;
BEGIN
  SELECT ss.employment_category, e.store_id
    INTO v_cat, v_store_id
    FROM public.employees e
    LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = p_emp_id;

  IF COALESCE(v_cat, '') = 'admin' THEN
    SELECT st.has_office_hours, st.office_hours_start::time, st.office_hours_end::time,
           COALESCE(st.office_hours_break_minutes, 60)
      INTO v_has_office, v_os, v_oe, v_obreak
      FROM public.stores st WHERE st.id = v_store_id;
    IF NOT COALESCE(v_has_office, false) OR v_os IS NULL OR v_oe IS NULL THEN
      v_os := time '09:00'; v_oe := time '18:00'; v_obreak := COALESCE(v_obreak, 60);
    END IF;
    shift_start := v_os; shift_end := v_oe;
    break_start := time '12:00'; break_end := time '12:00' + make_interval(mins => v_obreak);
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO sc FROM public.schedules
   WHERE employee_id = p_emp_id AND date = p_date
   ORDER BY (leave_request_id IS NULL) DESC LIMIT 1;
  IF sc.employee_id IS NULL OR sc.actual_start IS NULL OR sc.actual_end IS NULL THEN
    RETURN;  -- 無班表 → 空
  END IF;

  IF sc.actual_start_2 IS NOT NULL AND sc.actual_end_2 IS NOT NULL THEN
    shift_start := sc.actual_start; shift_end := sc.actual_end_2;
    break_start := sc.actual_end;   break_end := sc.actual_start_2;
  ELSE
    shift_start := sc.actual_start; shift_end := sc.actual_end;
    v_span_min := EXTRACT(EPOCH FROM sc.actual_end)/60 - EXTRACT(EPOCH FROM sc.actual_start)/60
                  + CASE WHEN sc.actual_end <= sc.actual_start THEN 1440 ELSE 0 END;
    v_break_min := COALESCE(sc.rest_minutes,
                            CASE WHEN v_span_min >= 540 THEN 60 WHEN v_span_min >= 300 THEN 30 ELSE 0 END);
    IF v_break_min > 0 THEN
      break_start := sc.actual_start + interval '4 hours';
      break_end   := sc.actual_start + interval '4 hours' + make_interval(mins => v_break_min);
    END IF;
  END IF;
  RETURN NEXT;
END $function$;

-- ── 2. _leave_net_hours 收斂成走 context(行為與前一版一致,重驗)──
CREATE OR REPLACE FUNCTION public._leave_net_hours(
  p_emp_id integer, p_date date, p_leave_start time, p_leave_end time
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE ctx record;
BEGIN
  SELECT * INTO ctx FROM public._shift_break_context(p_emp_id, p_date);
  IF ctx.shift_start IS NULL THEN RETURN NULL; END IF;
  RETURN public._leave_net_minutes(ctx.shift_start, ctx.shift_end, ctx.break_start, ctx.break_end,
                                   p_leave_start, p_leave_end) / 60.0;
END $function$;

-- ── 3. 新:淨工時 = 打卡時段 −(休息窗 ∩ 打卡時段)──
--    用 _leave_net_minutes(shift=打卡, leave=打卡):(打卡∩打卡) − (休息∩打卡) = 打卡span − 休息重疊。
--    無 context(門市查無班表)→ 退回原 span 公式(不regress)。
CREATE OR REPLACE FUNCTION public.net_work_hours(
  p_emp_id integer, p_date date, p_clock_in time, p_clock_out time
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE ctx record; v_span numeric; v_rest integer;
BEGIN
  IF p_clock_in IS NULL OR p_clock_out IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO ctx FROM public._shift_break_context(p_emp_id, p_date);

  IF ctx.shift_start IS NULL AND ctx.break_start IS NULL THEN
    -- 查無班/辦公時間 → 退回原 span 階梯公式
    v_span := EXTRACT(EPOCH FROM p_clock_out)/60 - EXTRACT(EPOCH FROM p_clock_in)/60
              + CASE WHEN p_clock_out <= p_clock_in THEN 1440 ELSE 0 END;
    v_rest := CASE WHEN v_span >= 540 THEN 60 WHEN v_span >= 300 THEN 30 ELSE 0 END;
    RETURN GREATEST(0, v_span - v_rest) / 60.0;
  END IF;

  RETURN public._leave_net_minutes(p_clock_in, p_clock_out, ctx.break_start, ctx.break_end,
                                   p_clock_in, p_clock_out) / 60.0;
END $function$;

GRANT EXECUTE ON FUNCTION public._shift_break_context(integer, date) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.net_work_hours(integer, date, time, time) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
