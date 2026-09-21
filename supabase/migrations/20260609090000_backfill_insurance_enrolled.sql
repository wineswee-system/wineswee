-- ════════════════════════════════════════════════════════════════════════════
-- Backfill：employees.labor_insurance / health_insurance toggle
--
-- 20260609080000 把 generate_payroll 接上 toggle，但這兩個欄位 DB default
-- 是 false，舊員工資料沒人手動打開過 → 月結時全部變不扣保險 → 慘案。
--
-- 規則：之前有設「投保級距」的員工 = 之前在保 → toggle 自動 ON
--      沒設級距的 = 之前就沒在保 → 維持 false（要保的人 HR 手動去開）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.employees
   SET labor_insurance = TRUE
 WHERE labor_ins_grade IS NOT NULL
   AND COALESCE(labor_insurance, false) = false;

UPDATE public.employees
   SET health_insurance = TRUE
 WHERE health_ins_grade IS NOT NULL
   AND COALESCE(health_insurance, false) = false;

COMMIT;

NOTIFY pgrst, 'reload schema';
