-- ════════════════════════════════════════════════════════════════════════════
-- 排班「兩段班」(split shift) 支援
-- ----------------------------------------------------------------------------
-- 同 emp 同 date 可有兩段班，例：11~14 早班 + 18~22 晚班，中間 4h 離店不計薪
-- 規則：兩段加總 ≤7h、中間 gap 3-7h、店面不付中間 gap 薪資
--
-- 不破壞 backward compat：第二段欄位 nullable，舊資料不變
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS shift_2 TEXT,                -- 第二段班 label 例 "18~22"
  ADD COLUMN IF NOT EXISTS actual_start_2 TIME,         -- 第二段實際開始
  ADD COLUMN IF NOT EXISTS actual_end_2 TIME,           -- 第二段實際結束
  ADD COLUMN IF NOT EXISTS actual_hours_2 NUMERIC(5,2); -- 第二段淨工時

COMMENT ON COLUMN public.schedules.shift_2 IS '兩段班第二段 label（如 "18~22"）。null = 單段班';
COMMENT ON COLUMN public.schedules.actual_hours_2 IS '第二段實際淨工時。總工時 = actual_hours + actual_hours_2';

-- 規則驗證 trigger（保護 DB 層級不被亂寫）
CREATE OR REPLACE FUNCTION public._validate_split_shift()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_gap_h NUMERIC;
  v_total_h NUMERIC;
BEGIN
  -- 沒第二段就直接過
  IF NEW.shift_2 IS NULL THEN RETURN NEW; END IF;

  -- 第二段資料完整性檢查
  IF NEW.actual_start_2 IS NULL OR NEW.actual_end_2 IS NULL THEN
    RAISE EXCEPTION '兩段班第二段缺 actual_start_2 / actual_end_2';
  END IF;
  IF NEW.actual_start IS NULL OR NEW.actual_end IS NULL THEN
    RAISE EXCEPTION '兩段班第一段缺 actual_start / actual_end';
  END IF;

  -- 兩段加總工時 ≤7h
  v_total_h := COALESCE(NEW.actual_hours, 0) + COALESCE(NEW.actual_hours_2, 0);
  IF v_total_h > 7.0 THEN
    RAISE EXCEPTION '兩段班總工時 %h 超過 7h 上限', v_total_h;
  END IF;

  -- 中間 gap 3-7h
  v_gap_h := EXTRACT(EPOCH FROM (NEW.actual_start_2 - NEW.actual_end)) / 3600.0;
  IF v_gap_h < 3.0 OR v_gap_h > 7.0 THEN
    RAISE EXCEPTION '兩段班中間間隔 %h 不在 3-7h 範圍', v_gap_h;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_split_shift ON public.schedules;
CREATE TRIGGER trg_validate_split_shift
  BEFORE INSERT OR UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public._validate_split_shift();

COMMIT;
