-- ════════════════════════════════════════════════════════════════════════════
-- 加班勞基法 §32 守門 + 特例匯入欄
--
-- 規則（同時對正職 / 兼職）：
--   - 單筆 OT > 4 小時 → 擋
--   - 同日累積 OT > 4 小時 → 擋（日總工時 8+4=12 上限）
--   - 月累積 OT > 46 小時 → 擋（薪資月：1 號到月底）
--
-- 特例旁路：
--   is_exception = true 的 row 完全跳過上面 3 條檢查
--   且不計入其他人的累計（trigger 內 NOT is_exception 過濾）
--   → CSV 匯入特例 OT 時設 is_exception=true 即可繞過
--
-- 已退回/已駁回/已取消的 row 也不計入累計
--
-- ⚠️ 既有歷史資料若已超標，新申請會立刻被擋（歷史 OT 已用掉本月配額）。
--    如需追溯處理：手動把那些 row UPDATE is_exception=true 即可。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 加 4 個欄位 ───
ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS is_exception          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exception_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_imported_by INT REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS exception_note        TEXT;

COMMENT ON COLUMN public.overtime_requests.is_exception IS
  '勞基法特例：true = 跳過 §32 check（HR CSV 匯入時設）';
COMMENT ON COLUMN public.overtime_requests.exception_imported_at IS '特例 CSV 匯入時間';
COMMENT ON COLUMN public.overtime_requests.exception_imported_by IS '特例 CSV 匯入人';
COMMENT ON COLUMN public.overtime_requests.exception_note IS '特例備註（CSV 帶進來）';

CREATE INDEX IF NOT EXISTS idx_overtime_requests_is_exception
  ON public.overtime_requests (is_exception);

-- ─── 2. trigger function：勞基法 §32 檢查 ───
CREATE OR REPLACE FUNCTION public.chk_overtime_labor_law()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_eff_date    DATE;
  v_eff_hours   NUMERIC;
  v_day_total   NUMERIC;
  v_month_total NUMERIC;
  v_month_start DATE;
  v_month_end   DATE;
BEGIN
  -- 特例匯入跳過所有檢查
  IF COALESCE(NEW.is_exception, false) THEN
    RETURN NEW;
  END IF;

  -- UPDATE 時若關鍵欄（date / hours）沒變 → 跳過（避免簽核 status 改動被擋）
  IF TG_OP = 'UPDATE' THEN
    IF NEW.ot_hours     IS NOT DISTINCT FROM OLD.ot_hours
      AND NEW.request_date IS NOT DISTINCT FROM OLD.request_date
      AND NEW.hours        IS NOT DISTINCT FROM OLD.hours
      AND NEW.date         IS NOT DISTINCT FROM OLD.date
      AND NEW.employee_id  IS NOT DISTINCT FROM OLD.employee_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 用較新欄 request_date / ot_hours，fallback 舊欄 date / hours
  v_eff_date  := COALESCE(NEW.request_date, NEW.date);
  v_eff_hours := COALESCE(NEW.ot_hours, NEW.hours);

  -- 不夠資訊判斷就放過（其他 constraint 會擋）
  IF v_eff_date IS NULL OR v_eff_hours IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── 規則 1：單筆 OT 不能 > 4 ──
  IF v_eff_hours > 4 THEN
    RAISE EXCEPTION 'OT_HOURS_EXCEED_DAILY: 單筆加班不能超過 4 小時（勞基法 §32 日總工時上限 12 小時）。本次申請 % 小時', v_eff_hours
      USING HINT = 'labor_law_§32_daily_single';
  END IF;

  -- ── 規則 2：同日累積（同員工，非已退回，非特例）不能 > 4 ──
  SELECT COALESCE(SUM(COALESCE(ot_hours, hours)), 0) INTO v_day_total
    FROM public.overtime_requests
   WHERE employee_id IS NOT DISTINCT FROM NEW.employee_id
     AND COALESCE(request_date, date) = v_eff_date
     AND COALESCE(NULLIF(status, ''), '申請中') NOT IN ('已退回', '已駁回', '已取消', '已拒絕')
     AND id IS DISTINCT FROM NEW.id
     AND NOT COALESCE(is_exception, false);

  IF v_day_total + v_eff_hours > 4 THEN
    RAISE EXCEPTION 'OT_HOURS_EXCEED_DAILY_TOTAL: 同日加班合計不能超過 4 小時。當日已有 % 小時申請中/已核准，本次 % 小時，合計 %', v_day_total, v_eff_hours, v_day_total + v_eff_hours
      USING HINT = 'labor_law_§32_daily_total';
  END IF;

  -- ── 規則 3：月累積（薪資月 1 號到月底）不能 > 46 ──
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
    RAISE EXCEPTION 'OT_HOURS_EXCEED_MONTHLY: 月加班合計不能超過 46 小時（勞基法 §32）。本月已有 % 小時，本次 % 小時，合計 %', v_month_total, v_eff_hours, v_month_total + v_eff_hours
      USING HINT = 'labor_law_§32_monthly';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.chk_overtime_labor_law() IS
  '加班申請勞基法 §32 守門 — 單日 ≤ 4hr、月累計 ≤ 46hr。is_exception=true 跳過。';

-- ─── 3. 掛 trigger ───
DROP TRIGGER IF EXISTS trg_chk_overtime_labor_law ON public.overtime_requests;
CREATE TRIGGER trg_chk_overtime_labor_law
  BEFORE INSERT OR UPDATE ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.chk_overtime_labor_law();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── 4. 健檢：列出當前 DB 有沒有歷史超標的 row（不會擋住，只是告知） ───
DO $$
DECLARE
  v_daily_violators INT;
  v_monthly_violators INT;
BEGIN
  SELECT COUNT(*) INTO v_daily_violators
    FROM public.overtime_requests
   WHERE COALESCE(ot_hours, hours) > 4
     AND NOT COALESCE(is_exception, false);

  SELECT COUNT(*) INTO v_monthly_violators
    FROM (
      SELECT employee_id,
             DATE_TRUNC('month', COALESCE(request_date, date))::DATE AS m,
             SUM(COALESCE(ot_hours, hours)) AS total
        FROM public.overtime_requests
       WHERE COALESCE(NULLIF(status, ''), '申請中')
             NOT IN ('已退回','已駁回','已取消','已拒絕')
         AND NOT COALESCE(is_exception, false)
         AND COALESCE(request_date, date) IS NOT NULL
       GROUP BY 1, 2
      HAVING SUM(COALESCE(ot_hours, hours)) > 46
    ) sub;

  RAISE NOTICE '勞基法守門 trigger 已啟用。歷史 row 健檢：';
  RAISE NOTICE '  - 單筆 > 4 小時：% 筆', v_daily_violators;
  RAISE NOTICE '  - 某員工月累計 > 46 小時的 (員工×月份) 組合：% 組', v_monthly_violators;
  IF v_daily_violators > 0 OR v_monthly_violators > 0 THEN
    RAISE NOTICE '★ 提示：歷史超標 row 不會被 trigger 擋，但會佔該員工該月的配額 → 新申請可能立刻被擋。要追溯放行，把那些 row UPDATE SET is_exception=true 即可。';
  END IF;
END $$;
