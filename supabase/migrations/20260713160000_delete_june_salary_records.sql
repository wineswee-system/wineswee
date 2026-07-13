-- 刪除 2026-06 薪資（salary_records）— 2026-07-13
-- 背景:員工 LINE 薪資卡(liff_card_my_salary_brief)讀 salary_records「最新月」,
--   六月尚未定案卻已被員工看到 → HR 要求先清掉六月,之後重算再放。
-- 影響:salary_records month='2026-06' 共 84 筆(83 draft + 1 finalized,finalized_at 為空),
--   net 合計 3,065,025。無 DELETE 觸發器、無下游外鍵依賴(計薪副作用在 payroll_records 側,與此無關)。
--   刪後員工薪資卡自動退回 2026-04。
-- idempotent:重跑不再刪任何列。

DELETE FROM public.salary_records
 WHERE month = '2026-06'
   AND organization_id = 1;

NOTIFY pgrst, 'reload schema';
