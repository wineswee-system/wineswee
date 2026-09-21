-- 詹健如(id 145, L2025026) 設勞退自提 6%
-- 2026-07-09  保險明細無自提資料，此為另外指定。自提從薪水扣、計薪讀 labor_pension_self_rate。
-- idempotent。

UPDATE public.employees
   SET labor_pension_self_rate = 6
 WHERE id = 145 AND name = '詹健如';

NOTIFY pgrst, 'reload schema';
