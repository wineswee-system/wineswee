-- 清除 2 筆舊測試單（離職 #1 / 異動 #1，陳楷仁 emp 209，2026-05-13 建立、reason='測試'）
-- 2026-07-07
-- 背景：config 尚未設定時建的測試單，approval_chain_id=NULL、無快照、無依賴。
--   用 id + employee_id + 狀態 + 測試標記四重 guard，只打中這 2 筆，誤刪不了真單。
-- idempotent：已刪則不動。

BEGIN;

DELETE FROM public.resignation_requests
 WHERE id = 1
   AND employee_id = 209
   AND status = '申請中'
   AND reason_detail = '測試';

DELETE FROM public.personnel_transfer_requests
 WHERE id = 1
   AND employee_id = 209
   AND status = '申請中'
   AND reason = '測試';

COMMIT;
