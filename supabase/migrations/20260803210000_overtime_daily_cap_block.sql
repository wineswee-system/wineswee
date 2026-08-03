-- 加班「單日上限」硬擋(申請時就擋)— 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 需求(老闆選 A):加班申請時就擋掉「當天排定淨工時 + 本次加班 > 12 小時」的單(手機/網頁/任何路徑)。
-- 規則:單日加班上限 = 12 − 當天排定淨工時(排 10h→上限 2h;無排班以標準 8h 計→上限 4h);
--   時數皆為淨工時(扣休息)。bypass:額外加班(is_exception)於 chk_overtime_labor_law 開頭已 bypass,
--   → 天災/變形工時等合法例外改用「額外加班」即可繞過硬擋。
-- 做法:新增 _sched_net_hours_day helper + 在 chk_overtime_labor_law(BEFORE INSERT/UPDATE)最後
--   RETURN NEW 前加一段 RAISE。既有單筆>12h / 月>46h 檢查保留。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- 當天「排定淨工時」helper(扣休息:rest_minutes 優先,否則 >=9h→60、>=5h→30;含兩段班、跨午夜)
CREATE OR REPLACE FUNCTION public._sched_net_hours_day(p_emp_id int, p_date date)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  r record; v_total numeric := 0; v_span numeric; v_span2 numeric; v_brk numeric;
BEGIN
  FOR r IN
    SELECT actual_start, actual_end, actual_start_2, actual_end_2, rest_minutes
      FROM public.schedules
     WHERE employee_id = p_emp_id AND date = p_date
       AND COALESCE(absence_type, '') = ''
       AND actual_start IS NOT NULL AND actual_end IS NOT NULL
  LOOP
    v_span := EXTRACT(EPOCH FROM (r.actual_end::time - r.actual_start::time)) / 60.0;
    IF v_span <= 0 THEN v_span := v_span + 1440; END IF;
    v_span2 := 0;
    IF r.actual_start_2 IS NOT NULL AND r.actual_end_2 IS NOT NULL THEN
      v_span2 := EXTRACT(EPOCH FROM (r.actual_end_2::time - r.actual_start_2::time)) / 60.0;
      IF v_span2 <= 0 THEN v_span2 := v_span2 + 1440; END IF;
    END IF;
    v_span := v_span + v_span2;
    v_brk := COALESCE(r.rest_minutes, CASE WHEN v_span >= 540 THEN 60 WHEN v_span >= 300 THEN 30 ELSE 0 END);
    v_total := v_total + GREATEST(0, v_span - v_brk) / 60.0;
  END LOOP;
  RETURN v_total;
END $fn$;

CREATE OR REPLACE FUNCTION public.chk_overtime_labor_law()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_eff_date    DATE;
  v_eff_hours   NUMERIC;
  v_month_start DATE;
  v_month_end   DATE;
  v_month_total NUMERIC;
BEGIN
  -- 特例旁路
  IF COALESCE(NEW.is_exception, false) THEN
    RETURN NEW;
  END IF;

  -- UPDATE 若關鍵欄沒變 → 跳過（避免簽核 status 改動被擋）
  IF TG_OP = 'UPDATE' THEN
    IF NEW.ot_hours     IS NOT DISTINCT FROM OLD.ot_hours
      AND NEW.hours        IS NOT DISTINCT FROM OLD.hours
      AND NEW.request_date IS NOT DISTINCT FROM OLD.request_date
      AND NEW.date         IS NOT DISTINCT FROM OLD.date
      AND NEW.employee_id  IS NOT DISTINCT FROM OLD.employee_id THEN
      RETURN NEW;
    END IF;
  END IF;

  v_eff_date  := COALESCE(NEW.request_date, NEW.date);
  v_eff_hours := COALESCE(NEW.ot_hours, NEW.hours);
  IF v_eff_hours IS NULL THEN
    RETURN NEW;
  END IF;

  -- 單筆 > 12h 視為明顯異常（防 typo）
  IF v_eff_hours > 12 THEN
    RAISE EXCEPTION 'OT_HOURS_ABNORMAL: 單筆加班時數異常（最多 12 小時），本次 % 小時', v_eff_hours
      USING HINT = 'sanity_cap';
  END IF;

  -- 每月上限 46h（同員工、薪資月、非退回、非特例）
  IF v_eff_date IS NOT NULL THEN
    v_month_start := DATE_TRUNC('month', v_eff_date)::DATE;
    v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

    SELECT COALESCE(SUM(COALESCE(ot_hours, hours)), 0) INTO v_month_total
      FROM public.overtime_requests
     WHERE employee_id IS NOT DISTINCT FROM NEW.employee_id
       AND COALESCE(request_date, date) BETWEEN v_month_start AND v_month_end
       AND COALESCE(NULLIF(status, ''), '申請中') NOT IN ('已退回', '已駁回', '已取消', '已拒絕')
       AND id IS DISTINCT FROM NEW.id
       AND NOT COALESCE(is_exception, false);

    IF v_month_total + v_eff_hours > 46 THEN
      RAISE EXCEPTION 'OT_MONTHLY_EXCEED: 本月加班已達上限（46 小時），當月已 % 小時，本次 % 小時，合計 %', v_month_total, v_eff_hours, v_month_total + v_eff_hours
        USING HINT = 'monthly_cap';
    END IF;
  END IF;

  -- ── 單日加班上限:當天排定淨工時 + 本次加班 <= 12h(無排班以標準 8h 計)──
  --   額外加班(is_exception)已於函式開頭 bypass → 天災/變形工時等特例改用「額外加班」可繞過。
  IF NEW.employee_id IS NOT NULL AND v_eff_date IS NOT NULL THEN
    DECLARE
      v_sched numeric;
      v_cap   numeric;
    BEGIN
      v_sched := public._sched_net_hours_day(NEW.employee_id, v_eff_date);
      IF v_sched IS NULL OR v_sched = 0 THEN v_sched := 8; END IF;
      v_cap := 12 - v_sched;
      IF v_eff_hours > v_cap + 0.01 THEN
        RAISE EXCEPTION 'OT_DAILY_CAP: 當天排定 % 小時,單日加班上限約 % 小時,本次 % 小時已超過(單日總工時逾 12 小時)。特殊情況請改用「額外加班」。',
          round(v_sched, 1), round(GREATEST(v_cap, 0), 1), v_eff_hours
          USING HINT = 'daily_cap';
      END IF;
    END;
  END IF;

  RETURN NEW;
END $function$

;

NOTIFY pgrst, 'reload schema';
