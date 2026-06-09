-- ════════════════════════════════════════════════════════════════════════════
-- Backfill：所有員工 labor_insurance / health_insurance toggle 全部 ON
--
-- 用戶決策：default 全部保，要不保的人 HR 手動去員工頁關掉。
-- 比 20260609090000（只開有級距的）更廣，覆蓋所有員工。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.employees
   SET labor_insurance = TRUE
 WHERE COALESCE(labor_insurance, false) = false;

UPDATE public.employees
   SET health_insurance = TRUE
 WHERE COALESCE(health_insurance, false) = false;

COMMIT;

NOTIFY pgrst, 'reload schema';
