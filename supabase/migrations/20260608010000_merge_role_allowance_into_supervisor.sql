-- ════════════════════════════════════════════════════════════════════════════
-- 把 salary_structures.role_allowance（職務津貼）的值合進 supervisor_allowance
-- ────────────────────────────────────────────────────────────────────────────
-- 系統內過去同時有「職務津貼」(role_allowance) 跟「主管津貼/主管加給」
-- (supervisor_allowance) 兩個欄位，意義模糊且 UI 多處顯示名稱不一致：
-- - HrTabContent: 「職務津貼」
-- - SalaryStructures: 「主管津貼」
-- - BatchPayrollModal: 「主管津貼」
-- - PayrollFormulaModal: 「主管/職務津貼」
-- - PayslipRow / Payroll PDF: 「主管加給」 + 「職務津貼」分別列
--
-- 統一改成「**主管加給**」單一概念。
--
-- 本 migration：
--   1. 把 role_allowance 的值累加進 supervisor_allowance（保留總和不變）
--   2. role_allowance 設為 0（DB column 保留向後相容，不 DROP）
--   3. payrollCalc.js 的 supervisor_allowance + role_allowance 加總仍可運作，
--      搬移後 role_allowance 都是 0，結果等於只看 supervisor_allowance
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.salary_structures
   SET supervisor_allowance = COALESCE(supervisor_allowance, 0) + COALESCE(role_allowance, 0),
       role_allowance       = 0
 WHERE COALESCE(role_allowance, 0) > 0;

COMMIT;

-- 驗證查詢（手動跑）：
-- SELECT employee_id, supervisor_allowance, role_allowance
--   FROM salary_structures
--  WHERE supervisor_allowance > 0 OR role_allowance > 0;
