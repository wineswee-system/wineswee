-- 刪除四月（及零星測試月）薪資測試資料 — 2026-07-13
-- 背景:2026-04 薪資為測試資料,HR 要求清除。跨兩套薪資表:
--   salary_records(員工 LINE/LIFF 薪資卡讀) + payroll_records/payroll_runs(薪資單指令讀)。
-- 影響:僅 audit_* AFTER DELETE 觸發器記錄刪除,無 FK 依賴阻擋。
--   刪後員工薪資卡→「尚無薪資記錄」(六月尚未發布),符合預期。
-- 順帶清除零星測試殘留月(2025-12 ~ 2026-03,各 1 筆)。idempotent。

-- 四月:員工端薪資表
DELETE FROM public.salary_records
 WHERE month = '2026-04' AND organization_id = 1;

-- 四月:入帳薪資表(先明細後 run,避免 FK)
DELETE FROM public.payroll_records WHERE pay_period = '2026-04';
DELETE FROM public.payroll_runs    WHERE pay_period = '2026-04';

-- 零星測試殘留月(salary_records)
DELETE FROM public.salary_records
 WHERE month IN ('2025-12', '2026-01', '2026-02', '2026-03') AND organization_id = 1;

-- 髒資料:2026-13(不存在的月份13)測試 run 及其明細
DELETE FROM public.payroll_records WHERE pay_period = '2026-13';
DELETE FROM public.payroll_runs    WHERE pay_period = '2026-13';

NOTIFY pgrst, 'reload schema';
