-- ============================================================
-- overtime_requests.ot_category 加班類別自動分類 + schema 對齊
-- 2026-05-11
--
-- 目的：
--   1. 修 schema drift：live DB 缺 request_date / ot_hours 欄位（過去 audit_fixes.sql
--      跟前端 Salary.jsx 寫的 RPC/query 因此一直 silent fail）。
--      補欄位 + backfill 從原本的 date / hours 同步過去。
--   2. 前端原本誤用 ot_type ('pay'/'leave') 當作平日/休息日分類，導致所有加班全算平日倍率。
--      新增 ot_category 欄位 (weekday / restday / holiday)，BEFORE INSERT/UPDATE trigger
--      依勞基法 §36 自動分類：
--        - 週一~五 (DOW 1-5) → weekday   ×1.34 (前 2h) + ×1.67 (後續)
--        - 週六     (DOW 6)   → restday   ×1.34 (前 2h) + ×1.67 (3~8h) + ×2.67 (9~12h)
--        - 週日     (DOW 0)   → holiday   ×2 全額加倍 (例假日)
--        - holidays.is_workday=false 國定假日 → holiday ×2 (優先於 DOW)
--   3. 允許前端傳入 ot_category 做手動覆寫（變形工時、調班情境）。
--   4. Backfill 既有 status='已核准' 的紀錄。
--
-- 風險：
--   - holidays.is_workday 欄位在 migration files 中未見 ADD COLUMN（可能老闆在 Studio 手動加）。
--     本 migration 用 ADD COLUMN IF NOT EXISTS 防禦。
--   - request_date / ot_hours 同樣用 IF NOT EXISTS，重跑安全。
-- ============================================================

BEGIN;

-- ═══ 0. overtime_requests schema 對齊 ═══
-- audit_fixes.sql 跟 Salary.jsx 都用 request_date / ot_hours，但 migration files 從沒加過。
-- 補欄位並從舊欄位 backfill，讓兩套命名同時存在（過渡期）。
ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS request_date DATE,
  ADD COLUMN IF NOT EXISTS ot_hours     NUMERIC(5,2);

-- Backfill：把 date → request_date, hours → ot_hours
UPDATE public.overtime_requests
   SET request_date = date
 WHERE request_date IS NULL AND date IS NOT NULL;

UPDATE public.overtime_requests
   SET ot_hours = hours
 WHERE ot_hours IS NULL AND hours IS NOT NULL;

-- 雙向同步 trigger：未來無論前端寫 date 還是 request_date、hours 還是 ot_hours，兩邊都同步
CREATE OR REPLACE FUNCTION public.trg_overtime_sync_legacy_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- date ↔ request_date 雙向同步（以非 NULL 那邊為準）
  IF NEW.request_date IS NULL AND NEW.date IS NOT NULL THEN
    NEW.request_date := NEW.date;
  ELSIF NEW.date IS NULL AND NEW.request_date IS NOT NULL THEN
    NEW.date := NEW.request_date;
  END IF;

  -- hours ↔ ot_hours 雙向同步
  IF NEW.ot_hours IS NULL AND NEW.hours IS NOT NULL THEN
    NEW.ot_hours := NEW.hours;
  ELSIF NEW.hours IS NULL AND NEW.ot_hours IS NOT NULL THEN
    NEW.hours := NEW.ot_hours;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_overtime_sync_legacy_columns ON public.overtime_requests;
CREATE TRIGGER trg_overtime_sync_legacy_columns
  BEFORE INSERT OR UPDATE OF date, request_date, hours, ot_hours
  ON public.overtime_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_overtime_sync_legacy_columns();

-- ═══ 1. holidays.is_workday 防禦補欄位 ═══
ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS is_workday BOOLEAN DEFAULT false;

-- 既有國定假日資料補標 is_workday=false（DEFAULT 已是 false，這裡只處理已存 NULL 的）
UPDATE public.holidays SET is_workday = false WHERE is_workday IS NULL;

-- ═══ 2. overtime_requests.ot_category 新欄位 ═══
ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS ot_category TEXT;

-- CHECK constraint（用 DO 區塊避免重複套用報錯）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'overtime_requests_ot_category_check'
  ) THEN
    ALTER TABLE public.overtime_requests
      ADD CONSTRAINT overtime_requests_ot_category_check
      CHECK (ot_category IS NULL OR ot_category IN ('weekday', 'restday', 'holiday'));
  END IF;
END $$;

-- ═══ 3. classify_overtime_category() 純函式 ═══
CREATE OR REPLACE FUNCTION public.classify_overtime_category(p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_is_holiday BOOLEAN;
  v_dow        INT;
BEGIN
  IF p_date IS NULL THEN
    RETURN NULL;
  END IF;

  -- 國定假日優先（不論週幾，is_workday=false 都算 holiday ×2）
  SELECT EXISTS (
    SELECT 1 FROM public.holidays
    WHERE date = p_date AND COALESCE(is_workday, false) = false
  ) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN 'holiday';
  END IF;

  -- DOW: 0=Sun, 1=Mon, ..., 6=Sat
  v_dow := EXTRACT(DOW FROM p_date)::INT;

  IF v_dow = 0 THEN
    RETURN 'holiday';   -- 週日 例假日
  ELSIF v_dow = 6 THEN
    RETURN 'restday';   -- 週六 休息日
  ELSE
    RETURN 'weekday';   -- 週一~五
  END IF;
END $$;

-- ═══ 4. BEFORE INSERT/UPDATE trigger ═══
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
    NEW.ot_category := public.classify_overtime_category(v_date);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_overtime_auto_category ON public.overtime_requests;
CREATE TRIGGER trg_overtime_auto_category
  BEFORE INSERT OR UPDATE OF date, request_date, ot_category
  ON public.overtime_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_overtime_auto_category();

-- ═══ 5. Backfill 既有資料 ═══
UPDATE public.overtime_requests
   SET ot_category = public.classify_overtime_category(COALESCE(request_date, date))
 WHERE ot_category IS NULL
   AND COALESCE(request_date, date) IS NOT NULL;

-- ═══ 6. 索引 ═══
CREATE INDEX IF NOT EXISTS idx_overtime_requests_ot_category
  ON public.overtime_requests(ot_category)
  WHERE ot_category IS NOT NULL;

COMMIT;

-- 驗證查詢（手動執行）：
-- SELECT ot_category, COUNT(*) FROM overtime_requests GROUP BY ot_category;
-- SELECT id, employee, request_date, EXTRACT(DOW FROM request_date) AS dow, ot_category
--   FROM overtime_requests WHERE status = '已核准' ORDER BY request_date DESC LIMIT 20;
