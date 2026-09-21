-- ════════════════════════════════════════════════════════════════════════════
-- 加班守門 — 依日子類型分流上限
--
-- 舊 trigger 一律擋單筆 > 4hr，但休息日/國定假日可整天上工，誤擋。
-- 這版改成：
--   平日 (weekday)        : 單筆 ≤ 4hr、日累 ≤ 4hr、月累 ≤ 46hr
--   休息日 (restday)      : 單筆 ≤ 12hr，不入月累
--   例假日 (weekly_off)   : 單筆 ≤ 12hr，不入月累
--   國定假日 (holiday)    : 單筆 ≤ 12hr，不入月累
--
-- 注意：
--   - guard trigger 名稱以 'trg_chk_' 開頭，按字母序在 'trg_overtime_auto_category'
--     之前跑，所以這裡要自己 classify（不能依賴 NEW.ot_category 已被 set）
--   - 若 NEW.ot_category 已被 caller 明確指定 → 尊重它（手動覆寫情境）
--   - is_exception=true 整個 row 跳過所有檢查
--   - 錯誤訊息純中性表述，不出現「勞基法」「§32」字眼
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.chk_overtime_labor_law()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_eff_date    DATE;
  v_eff_hours   NUMERIC;
  v_category    TEXT;
  v_day_total   NUMERIC;
  v_month_total NUMERIC;
  v_month_start DATE;
  v_month_end   DATE;
BEGIN
  -- 例外旁路（CSV 匯入歷史/特殊個案）
  IF COALESCE(NEW.is_exception, false) THEN
    RETURN NEW;
  END IF;

  -- UPDATE 若關鍵欄沒變 → 跳過（避免簽核 status 改動觸發 guard）
  IF TG_OP = 'UPDATE' THEN
    IF NEW.ot_hours     IS NOT DISTINCT FROM OLD.ot_hours
      AND NEW.request_date IS NOT DISTINCT FROM OLD.request_date
      AND NEW.hours        IS NOT DISTINCT FROM OLD.hours
      AND NEW.date         IS NOT DISTINCT FROM OLD.date
      AND NEW.employee_id  IS NOT DISTINCT FROM OLD.employee_id
      AND NEW.ot_category  IS NOT DISTINCT FROM OLD.ot_category THEN
      RETURN NEW;
    END IF;
  END IF;

  v_eff_date  := COALESCE(NEW.request_date, NEW.date);
  v_eff_hours := COALESCE(NEW.ot_hours, NEW.hours);

  -- 資訊不足 → 放過（其他 constraint 會擋）
  IF v_eff_date IS NULL OR v_eff_hours IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── 決定日子類型 ──
  -- 尊重 caller 給的；沒給才自己分（guard 在 auto-category 之前跑）
  v_category := COALESCE(
    NEW.ot_category,
    public.classify_overtime_category_v2(v_eff_date, NEW.employee_id)
  );

  -- ──────────────────────────────────────────────────────────────────────
  -- 休息日 / 例假日 / 國定假日 — 單筆 ≤ 12hr，不入月累
  -- ──────────────────────────────────────────────────────────────────────
  IF v_category IN ('restday', 'weekly_off', 'holiday') THEN
    IF v_eff_hours > 12 THEN
      RAISE EXCEPTION 'OT_HOURS_EXCEED_SINGLE: 單筆加班時數超過單日上限（最多 12 小時），本次 % 小時', v_eff_hours
        USING HINT = 'single_record_cap';
    END IF;
    RETURN NEW;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────
  -- 平日（weekday）或無法判斷 — 套舊規則
  -- ──────────────────────────────────────────────────────────────────────

  -- 規則 1：單筆 ≤ 4
  IF v_eff_hours > 4 THEN
    RAISE EXCEPTION 'OT_HOURS_EXCEED_DAILY: 平日單筆加班超過上限（4 小時），本次 % 小時', v_eff_hours
      USING HINT = 'weekday_single_cap';
  END IF;

  -- 規則 2：同日（同員工、非已退/拒/取消、非特例、平日類）累計 ≤ 4
  SELECT COALESCE(SUM(COALESCE(ot_hours, hours)), 0) INTO v_day_total
    FROM public.overtime_requests
   WHERE employee_id IS NOT DISTINCT FROM NEW.employee_id
     AND COALESCE(request_date, date) = v_eff_date
     AND COALESCE(NULLIF(status, ''), '申請中') NOT IN ('已退回', '已駁回', '已取消', '已拒絕')
     AND id IS DISTINCT FROM NEW.id
     AND NOT COALESCE(is_exception, false)
     AND COALESCE(ot_category, 'weekday') = 'weekday';

  IF v_day_total + v_eff_hours > 4 THEN
    RAISE EXCEPTION 'OT_HOURS_EXCEED_DAILY_TOTAL: 同日平日加班合計超過上限（4 小時）。當日已 % 小時，本次 % 小時，合計 %', v_day_total, v_eff_hours, v_day_total + v_eff_hours
      USING HINT = 'weekday_daily_total_cap';
  END IF;

  -- 規則 3：當月（薪資月 1 號到月底，只計平日 OT）≤ 46
  v_month_start := DATE_TRUNC('month', v_eff_date)::DATE;
  v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  SELECT COALESCE(SUM(COALESCE(ot_hours, hours)), 0) INTO v_month_total
    FROM public.overtime_requests
   WHERE employee_id IS NOT DISTINCT FROM NEW.employee_id
     AND COALESCE(request_date, date) BETWEEN v_month_start AND v_month_end
     AND COALESCE(NULLIF(status, ''), '申請中') NOT IN ('已退回', '已駁回', '已取消', '已拒絕')
     AND id IS DISTINCT FROM NEW.id
     AND NOT COALESCE(is_exception, false)
     AND COALESCE(ot_category, 'weekday') = 'weekday';

  IF v_month_total + v_eff_hours > 46 THEN
    RAISE EXCEPTION 'OT_HOURS_EXCEED_MONTHLY: 當月平日加班合計超過月上限（46 小時）。本月已 % 小時，本次 % 小時，合計 %', v_month_total, v_eff_hours, v_month_total + v_eff_hours
      USING HINT = 'weekday_monthly_cap';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.chk_overtime_labor_law() IS
  '加班守門：平日 4/4/46、休息日/例假/國定 單筆 ≤12hr 不入月累。is_exception=true 跳過。';

COMMIT;

NOTIFY pgrst, 'reload schema';
