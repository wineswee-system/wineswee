-- 加班守門：加回「每月上限 46 小時」硬擋（保留單筆 ≤12h sanity）
-- 2026-07-08
-- 背景：20260608070000 簡化成只擋單筆 12h，把月上限拿掉了。
--   但月加班上限跟四週變形工時是兩回事（變形改的是正常工時分配，月加班上限照樣適用）。
--   依需求把每月 46h 上限「硬擋」加回來。
-- 規則：
--   單筆 > 12h → 擋（防 typo）
--   當月（薪資月 1號~月底）非退回、非特例 加班合計 + 本筆 > 46h → 擋
--   is_exception=true 完全跳過、也不計入當月配額（特例匯入用）
-- UI 訊息中性，不出現法規條文字眼。idempotent(CREATE OR REPLACE)。

BEGIN;

CREATE OR REPLACE FUNCTION public.chk_overtime_labor_law()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.chk_overtime_labor_law() IS
  '加班守門：單筆 ≤12h + 每月 ≤46h（特例匯入 is_exception 跳過且不計配額）';

COMMIT;
NOTIFY pgrst, 'reload schema';
