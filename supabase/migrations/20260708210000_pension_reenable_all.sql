-- 雇主勞退 6% 加回全部人（推翻先前「全部關掉」）
-- 2026-07-08
-- 背景：20260708180000（gate + set all pension=false）其實有被跑進 live，
--   導致 _compute/generate 的雇主勞退 v_pension_er = CASE WHEN pension THEN 6% ELSE 0
--   全部歸 0（退休金公司付的沒出來）。
-- 老闆決策改為：公司負擔的 6% 要保留給全部人、算進雇主成本。
-- 做法：保留 toggle 接線（未來仍可個別關），把大家 pension 設回 true；
--   pension_rate 空/0 → 補 6（gate 用 COALESCE(pension_rate,6)，但存 0 會算成 0%）。
-- 不動計薪函式（接線本身正確）。idempotent。

UPDATE public.employees SET pension = true
 WHERE pension IS DISTINCT FROM true;

UPDATE public.employees SET pension_rate = 6
 WHERE COALESCE(pension_rate, 0) <= 0;

NOTIFY pgrst, 'reload schema';
