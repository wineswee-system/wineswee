-- 硬刪員工 成柏璋(#475 / W2026084)— 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 老闆要求:此人為 2026-08-03 誤建的空帳,直接刪除(不走離職軟刪)。
-- 刪除前盤點(service-role 實查):
--   排班/請假/加班/薪資記錄/打卡/任務/補休/資遣/特休額度 = 全 0
--   被當主管/店長/督導/專案成員/工作流發起人 = 全 0
--   唯一關聯:salary_structures 1 筆(建員工時自動產生的薪資設定)
-- → 先刪 salary_structure,再刪員工。以 id + 工號雙重把關,避免誤刪。
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM public.salary_structures WHERE employee_id = 475;

DELETE FROM public.employees
 WHERE id = 475 AND employee_number = 'W2026084' AND name = '成柏璋';

-- 驗證(應皆 0 筆):
-- SELECT count(*) FROM public.employees        WHERE id = 475;
-- SELECT count(*) FROM public.salary_structures WHERE employee_id = 475;
