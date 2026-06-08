-- ════════════════════════════════════════════════════════════════════════════
-- 加班分類加 'weekly_off'（例假日加班）— 跟 'restday'（休息日）區分
--
-- 原本 4 桶倍率（weekday/restday/holiday）合理但「例假日」沒有自己的分類，
-- 之前都被 DOW=0 (週日) 預設成 'holiday' 桶（×2 倍率對但分類錯）。
--
-- 排班時可以 schedules.shift = '例假' / '休息' 明確標示，trigger 會優先看
-- 該員工該日的排班 shift 來分類；沒明確標的 fallback 到 DOW 推估。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 更新 CHECK constraint 加 'weekly_off' ───────────────────────────────
DO $$
BEGIN
  -- 先 drop 既有 constraint（如果存在）
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'overtime_requests_ot_category_check'
  ) THEN
    ALTER TABLE public.overtime_requests
      DROP CONSTRAINT overtime_requests_ot_category_check;
  END IF;

  -- 重新 add（包含 weekly_off）
  ALTER TABLE public.overtime_requests
    ADD CONSTRAINT overtime_requests_ot_category_check
    CHECK (ot_category IS NULL OR ot_category IN ('weekday', 'restday', 'weekly_off', 'holiday'));
END $$;


-- ─── 2. 重寫 classify_overtime_category 支援員工 schedule 查詢 ──────────────
-- 新簽名加 p_employee_id：
--   1. 國定假日（holidays.is_workday=false）→ 'holiday'（最高優先）
--   2. 看 schedules.shift 該員工該日：
--        '例假'         → 'weekly_off'
--        '休' / '休息'  → 'restday'
--   3. 沒排班/沒明確標 → 依 DOW fallback：
--        DOW=0 週日 → 'weekly_off'（多數公司預設）
--        DOW=6 週六 → 'restday'
--        其他      → 'weekday'

CREATE OR REPLACE FUNCTION public.classify_overtime_category(p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_is_holiday BOOLEAN;
  v_dow        INT;
BEGIN
  -- legacy 簽名（沒 employee_id）— 國定 + DOW fallback，不查 schedule
  IF p_date IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.holidays
    WHERE date = p_date AND COALESCE(is_workday, false) = false
  ) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN 'holiday';
  END IF;

  v_dow := EXTRACT(DOW FROM p_date)::INT;
  IF v_dow = 0 THEN
    RETURN 'weekly_off';
  ELSIF v_dow = 6 THEN
    RETURN 'restday';
  ELSE
    RETURN 'weekday';
  END IF;
END $$;

-- 新版（帶 employee_id 查 schedule）
CREATE OR REPLACE FUNCTION public.classify_overtime_category_v2(
  p_date        DATE,
  p_employee_id INT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_is_holiday BOOLEAN;
  v_shift      TEXT;
  v_dow        INT;
BEGIN
  IF p_date IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. 國定假日優先（不論其他）
  SELECT EXISTS (
    SELECT 1 FROM public.holidays
    WHERE date = p_date AND COALESCE(is_workday, false) = false
  ) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN 'holiday';
  END IF;

  -- 2. 看員工該日排班 shift（明確標示優先）
  IF p_employee_id IS NOT NULL THEN
    SELECT s.shift INTO v_shift
      FROM public.schedules s
      JOIN public.employees e ON e.name = s.employee
     WHERE e.id = p_employee_id
       AND s.date = p_date
     LIMIT 1;

    IF v_shift = '例假' THEN
      RETURN 'weekly_off';
    ELSIF v_shift IN ('休', '休息') THEN
      RETURN 'restday';
    END IF;
  END IF;

  -- 3. fallback 依 DOW
  v_dow := EXTRACT(DOW FROM p_date)::INT;
  IF v_dow = 0 THEN
    RETURN 'weekly_off';
  ELSIF v_dow = 6 THEN
    RETURN 'restday';
  ELSE
    RETURN 'weekday';
  END IF;
END $$;


-- ─── 3. 更新 BEFORE INSERT/UPDATE trigger 用新版 v2 函式 ───────────────────
CREATE OR REPLACE FUNCTION public.trg_overtime_auto_category()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_date DATE;
BEGIN
  -- 已手動指定就尊重，否則自動分類
  IF NEW.ot_category IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- request_date 優先於 date（schema drift fallback）
  v_date := COALESCE(NEW.request_date, NEW.date);

  IF v_date IS NOT NULL THEN
    NEW.ot_category := public.classify_overtime_category_v2(v_date, NEW.employee_id);
  END IF;

  RETURN NEW;
END $$;

-- trigger 本身不用重 create（function name 沒變）


-- ─── 4. Backfill 既有 'holiday'（其實是 DOW=0 例假）→ 'weekly_off' ──────────
-- 邏輯：where ot_category='holiday' 但對應 date 沒在 holidays 表中 → 之前誤分類
UPDATE public.overtime_requests ot
   SET ot_category = 'weekly_off'
 WHERE ot.ot_category = 'holiday'
   AND COALESCE(ot.request_date, ot.date) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.holidays h
      WHERE h.date = COALESCE(ot.request_date, ot.date)
        AND COALESCE(h.is_workday, false) = false
   );

COMMIT;

NOTIFY pgrst, 'reload schema';
