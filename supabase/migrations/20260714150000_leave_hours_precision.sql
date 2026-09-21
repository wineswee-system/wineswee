-- 假別時數精確化:放寬精度 + 修正 14 筆半小時(0.5h)差 — 2026-07-14
-- 根因:total_days/used_days 是 numeric(x,1)(0.8h級距),存不下半小時 → 有請半小時假的人被四捨五入。
-- ① 放寬三欄為無限精度 numeric(舊值不損);② 用 104 原檔精確值(小時/8,保留4位)改這幾筆。
-- 搭配前端 daysToHours 改 0.5h 級距才看得到。idempotent(值固定,可重跑)。

ALTER TABLE public.leave_balances
  ALTER COLUMN total_days      TYPE numeric,
  ALTER COLUMN used_days       TYPE numeric,
  ALTER COLUMN carry_over_days TYPE numeric;

UPDATE public.leave_balances SET total_days = 0.0625 WHERE employee_id = 84 AND year = 2026 AND leave_type = '舊人資系統補休結算';
UPDATE public.leave_balances SET total_days = 0.6875 WHERE employee_id = 65 AND year = 2026 AND leave_type = '舊人資系統補休結算';
UPDATE public.leave_balances SET total_days = 7.6875 WHERE employee_id = 71 AND year = 2026 AND leave_type = 'annual';
UPDATE public.leave_balances SET used_days = 4.1875 WHERE employee_id = 71 AND year = 2026 AND leave_type = '舊人資系統補休結算';
UPDATE public.leave_balances SET used_days = 0.0625 WHERE employee_id = 101 AND year = 2026 AND leave_type = 'annual';
UPDATE public.leave_balances SET total_days = 0.1875, used_days = 0.1875 WHERE employee_id = 145 AND year = 2026 AND leave_type = '舊人資系統補休結算';
UPDATE public.leave_balances SET used_days = 0.4375 WHERE employee_id = 208 AND year = 2026 AND leave_type = 'sick';
UPDATE public.leave_balances SET used_days = 0.6875 WHERE employee_id = 123 AND year = 2026 AND leave_type = 'sick';
UPDATE public.leave_balances SET total_days = 0.0625 WHERE employee_id = 130 AND year = 2026 AND leave_type = '舊人資系統補休結算';
UPDATE public.leave_balances SET used_days = 0.5625 WHERE employee_id = 74 AND year = 2026 AND leave_type = 'sick';
UPDATE public.leave_balances SET used_days = 1.1875 WHERE employee_id = 58 AND year = 2026 AND leave_type = 'personal';
UPDATE public.leave_balances SET used_days = 3.4375 WHERE employee_id = 151 AND year = 2026 AND leave_type = 'personal';
UPDATE public.leave_balances SET used_days = 0.4375 WHERE employee_id = 98 AND year = 2026 AND leave_type = 'sick';

NOTIFY pgrst, 'reload schema';
