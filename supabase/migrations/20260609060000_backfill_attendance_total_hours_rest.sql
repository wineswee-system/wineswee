-- ════════════════════════════════════════════════════════════════════
-- Backfill attendance_records.total_hours with shift-rest deduction
-- ════════════════════════════════════════════════════════════════════
-- 對齊新公式（同 src/lib/scheduleUtils.js#getRestMinutes）：
--   gross < 5h  → 0 分休息
--   5 ≤ gross < 9h → 30 分休息
--   gross ≥ 9h → 60 分休息
--
-- 原本 supabase/functions/clock-in/index.ts 寫進來的 total_hours
-- 是「打卡毛時數」(clock_out - clock_in)，沒扣休息 → 薪資 / 出勤
-- 拿到偏高的數值。本 migration 把舊資料一次性重算對齊。
--
-- Idempotent：再跑一次只會 update 還沒對齊的列；已對齊的不動。
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 可重用 helper（之後查詢、診斷都能用）
CREATE OR REPLACE FUNCTION public.calc_shift_rest_minutes(gross_hours numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN gross_hours IS NULL OR gross_hours <= 0 THEN 0
    WHEN gross_hours < 5 THEN 0
    WHEN gross_hours < 9 THEN 30
    ELSE 60
  END;
$$;

COMMENT ON FUNCTION public.calc_shift_rest_minutes(numeric) IS
  '依班次毛時數推算休息分鐘（公司政策：<5h=0, 5~9h=30, >=9h=60）。與 scheduleUtils.js#getRestMinutes 同步。';

-- 一次性 backfill
WITH calc AS (
  SELECT
    id,
    clock_in,
    clock_out,
    total_hours AS old_total,
    CASE
      WHEN EXTRACT(EPOCH FROM clock_out) >= EXTRACT(EPOCH FROM clock_in)
      THEN (EXTRACT(EPOCH FROM clock_out) - EXTRACT(EPOCH FROM clock_in)) / 3600.0
      ELSE (EXTRACT(EPOCH FROM clock_out) + 86400 - EXTRACT(EPOCH FROM clock_in)) / 3600.0
    END AS gross_h
  FROM public.attendance_records
  WHERE clock_in IS NOT NULL
    AND clock_out IS NOT NULL
),
recalc AS (
  SELECT
    id,
    old_total,
    gross_h,
    public.calc_shift_rest_minutes(gross_h) AS rest_min,
    ROUND((gross_h - public.calc_shift_rest_minutes(gross_h) / 60.0)::numeric, 2) AS new_total
  FROM calc
),
updated AS (
  UPDATE public.attendance_records ar
  SET total_hours = r.new_total
  FROM recalc r
  WHERE ar.id = r.id
    AND ar.total_hours IS DISTINCT FROM r.new_total
  RETURNING ar.id, r.old_total, r.new_total
)
SELECT count(*) AS rows_updated FROM updated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- 診斷 SELECT（不會被 migration 跑，貼到 Studio 手動查）
-- ════════════════════════════════════════════════════════════════════
-- 看某月所有員工的 before/after：
--
-- SELECT
--   e.name,
--   ar.date,
--   ar.clock_in, ar.clock_out,
--   ROUND((CASE
--     WHEN EXTRACT(EPOCH FROM ar.clock_out) >= EXTRACT(EPOCH FROM ar.clock_in)
--     THEN (EXTRACT(EPOCH FROM ar.clock_out) - EXTRACT(EPOCH FROM ar.clock_in)) / 3600.0
--     ELSE (EXTRACT(EPOCH FROM ar.clock_out) + 86400 - EXTRACT(EPOCH FROM ar.clock_in)) / 3600.0
--   END)::numeric, 2) AS gross_h,
--   public.calc_shift_rest_minutes(
--     CASE
--       WHEN EXTRACT(EPOCH FROM ar.clock_out) >= EXTRACT(EPOCH FROM ar.clock_in)
--       THEN (EXTRACT(EPOCH FROM ar.clock_out) - EXTRACT(EPOCH FROM ar.clock_in)) / 3600.0
--       ELSE (EXTRACT(EPOCH FROM ar.clock_out) + 86400 - EXTRACT(EPOCH FROM ar.clock_in)) / 3600.0
--     END
--   ) AS rest_min,
--   ar.total_hours AS net_h_now
-- FROM public.attendance_records ar
-- JOIN public.employees e ON e.id = ar.employee_id
-- WHERE ar.date BETWEEN '2026-04-01' AND '2026-04-30'
--   AND ar.clock_in IS NOT NULL AND ar.clock_out IS NOT NULL
-- ORDER BY e.name, ar.date;
