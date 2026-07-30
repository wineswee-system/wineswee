-- 部分請假「淨時數」helper(step 1)— 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 規格(project_partial_leave_break_spec):請假時數 = 請假時段 −(休息時段 ∩ 請假時段)。
-- 本 migration 只「新增」helper 函式,不改請假時數/計薪任何現有邏輯 → 純加,零風險。
--   step 2/3(把請假時數、計薪出勤接上這支)另開 migration。
--
-- 休息長度:重用現有公式(對齊 _shift_seg_hours):<5h→0、5~未滿9h→30、≥9h→60;
--   班表有 rest_minutes(手動/兩頭班)就用手動。
-- 休息位置:一般班 = 上班 +4h;兩頭班 = 兩段中間空檔。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 純幾何核心:給定 班/休息/請假 三個時段,回「淨請假分鐘」 ──
--    淨 = (請假 ∩ 班) − (休息 ∩ 請假 ∩ 班)。break 傳 null = 無休息。
--    支援跨午夜(班/請假結束 <= 起始 → +1440)。
CREATE OR REPLACE FUNCTION public._leave_net_minutes(
  p_shift_start time, p_shift_end time,
  p_break_start time, p_break_end time,
  p_leave_start time, p_leave_end time
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
  m  constant numeric := 1440;
  ss numeric; se numeric; ls numeric; le numeric; bs numeric; be numeric;
  lo numeric; hi numeric;        -- 請假 ∩ 班 的邊界
  liv numeric; bil numeric := 0; -- leave-in-shift、break-in-that
BEGIN
  IF p_shift_start IS NULL OR p_shift_end IS NULL
     OR p_leave_start IS NULL OR p_leave_end IS NULL THEN
    RETURN NULL;
  END IF;
  ss := EXTRACT(EPOCH FROM p_shift_start) / 60;
  se := EXTRACT(EPOCH FROM p_shift_end)   / 60;  IF se <= ss THEN se := se + m; END IF;
  ls := EXTRACT(EPOCH FROM p_leave_start) / 60;  IF ls <  ss THEN ls := ls + m; END IF;
  le := EXTRACT(EPOCH FROM p_leave_end)   / 60;  IF le <= ls THEN le := le + m; END IF;

  lo  := GREATEST(ls, ss);
  hi  := LEAST(le, se);
  liv := GREATEST(0, hi - lo);           -- 請假落在班內的分鐘

  IF p_break_start IS NOT NULL AND p_break_end IS NOT NULL AND liv > 0 THEN
    bs := EXTRACT(EPOCH FROM p_break_start) / 60;  IF bs <  ss THEN bs := bs + m; END IF;
    be := EXTRACT(EPOCH FROM p_break_end)   / 60;  IF be <= bs THEN be := be + m; END IF;
    bil := GREATEST(0, LEAST(hi, be) - GREATEST(lo, bs));  -- 休息 ∩ (請假∩班)
  END IF;

  RETURN GREATEST(0, liv - bil);
END $function$;

COMMENT ON FUNCTION public._leave_net_minutes(time,time,time,time,time,time)
  IS '部分請假淨分鐘 = (請假∩班) − (休息∩請假∩班);break 傳 null=無休息;支援跨午夜';


-- ── 2. 門市 wrapper:讀班表 → 推出 班/休息 窗 → 回淨請假「小時」 ──
--    一般班:休息長度 = COALESCE(rest_minutes, 公式),位置 = 上班+4h(長度>0 才有)。
--    兩頭班(actual_start_2 not null):班 = [actual_start, actual_end_2]、休息 = 中間空檔。
--    查無班表 → 回 NULL(交給呼叫端 fallback,例如照原時段差)。
CREATE OR REPLACE FUNCTION public._store_leave_net_hours(
  p_emp_id      integer,
  p_date        date,
  p_leave_start time,
  p_leave_end   time
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  sc          schedules;
  v_span_min  numeric;
  v_break_min numeric;
  v_shift_s   time; v_shift_e time;
  v_break_s   time; v_break_e time;
BEGIN
  SELECT * INTO sc
    FROM public.schedules
   WHERE employee_id = p_emp_id AND date = p_date
   ORDER BY (leave_request_id IS NULL) DESC   -- 有實班的優先
   LIMIT 1;
  IF sc.employee_id IS NULL OR sc.actual_start IS NULL OR sc.actual_end IS NULL THEN
    RETURN NULL;
  END IF;

  IF sc.actual_start_2 IS NOT NULL AND sc.actual_end_2 IS NOT NULL THEN
    -- 兩頭班:整段 [start, end_2],休息 = 中間空檔 [end, start_2]
    v_shift_s := sc.actual_start; v_shift_e := sc.actual_end_2;
    v_break_s := sc.actual_end;   v_break_e := sc.actual_start_2;
  ELSE
    v_shift_s := sc.actual_start; v_shift_e := sc.actual_end;
    -- span(分)含跨午夜
    v_span_min := EXTRACT(EPOCH FROM sc.actual_end) / 60
                  - EXTRACT(EPOCH FROM sc.actual_start) / 60
                  + CASE WHEN sc.actual_end <= sc.actual_start THEN 1440 ELSE 0 END;
    v_break_min := COALESCE(sc.rest_minutes,
                            CASE WHEN v_span_min >= 540 THEN 60
                                 WHEN v_span_min >= 300 THEN 30
                                 ELSE 0 END);
    IF v_break_min > 0 THEN
      v_break_s := sc.actual_start + interval '4 hours';
      v_break_e := sc.actual_start + interval '4 hours' + make_interval(mins => v_break_min::int);
    END IF;
  END IF;

  RETURN public._leave_net_minutes(v_shift_s, v_shift_e, v_break_s, v_break_e,
                                   p_leave_start, p_leave_end) / 60.0;
END $function$;

COMMENT ON FUNCTION public._store_leave_net_hours(integer,date,time,time)
  IS '門市部分請假淨小時:讀班表推班/休息窗(休息長度重用公式或rest_minutes、位置上班+4h;兩頭班用中間空檔),再 _leave_net_minutes';

NOTIFY pgrst, 'reload schema';
