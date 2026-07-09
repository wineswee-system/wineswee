-- 勞健退功能對齊：補齊保險明細缺的欄位
-- 2026-07-09  對齊「保險資料明細.xlsx」：職災級距、勞退級距、健保退保日、勞退加保日
-- 台灣制度：職災保險投保薪資上限(72800)高於勞保普通事故(45800)，高薪者兩者不同 →
--   需獨立欄位。勞退提繳工資(上限150000)也是獨立金額，非只有提繳率%。
-- 只加欄位(功能)；資料另支匯入。idempotent。

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS labor_occ_injury_grade NUMERIC,   -- 職災投保級距(獨立於勞保普通事故)
  ADD COLUMN IF NOT EXISTS labor_pension_grade    NUMERIC,   -- 勞退提繳工資級距(金額,非只%)
  ADD COLUMN IF NOT EXISTS health_ins_end         DATE,      -- 健保退保日期(對齊勞保 labor_ins_end)
  ADD COLUMN IF NOT EXISTS labor_pension_start    DATE;      -- 勞退加保日期

COMMENT ON COLUMN public.employees.labor_occ_injury_grade IS '職災保險投保薪資(上限72800，可高於勞保普通事故45800)';
COMMENT ON COLUMN public.employees.labor_pension_grade    IS '勞退提繳工資級距(上限150000)';

NOTIFY pgrst, 'reload schema';
