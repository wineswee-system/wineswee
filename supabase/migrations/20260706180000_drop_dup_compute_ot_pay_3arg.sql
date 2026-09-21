-- 修：加班核准跳「function public._compute_ot_pay(numeric, numeric, text) is not unique」(42725)
-- 2026-07-06
-- 根因：_compute_ot_pay 有兩個 overload：
--   (a) 3 參數 (p_hours, p_hourly_rate, p_category)                              — 舊版
--   (b) 4 參數 (p_hours, p_hourly_rate, p_category, p_salary_type DEFAULT 'monthly') — 新版(FT/PT 分開，20260609100000)
--   3 參數呼叫同時匹配 (a) 與 (b)(第4參數走 default) → 撞名不唯一 → 加班核准觸發計酬時炸。
-- 修法：DROP 舊的 3 參數版。3 參數呼叫會落到 4 參數版(salary_type 預設 monthly，行為對齊舊版)，
--   4 參數呼叫維持不變。calls 為 plpgsql 晚繫結，DROP 不會連鎖。idempotent。
-- 對應鐵則：新建少參數版前必須 DROP 舊版（[[feedback_pg_function_overload_ambiguity]]）。

DROP FUNCTION IF EXISTS public._compute_ot_pay(numeric, numeric, text);
