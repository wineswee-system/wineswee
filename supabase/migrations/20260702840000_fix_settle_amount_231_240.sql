-- 更正兩筆批次補結單的驗收(實際)金額
-- 2026-07-02
-- 背景：20260625230000 批次補結時，未填實際金額的舊單以「申請金額」補上 actual_amount。
--   其中兩筆申請人回報實際核銷金額與申請不同，人工更正：
--     #231 玻璃飲料桶 5LX13：申請 7927 → 驗收 7327（-600）
--     #240 起司標籤貼 X15    ：申請 2070 → 驗收 2175（+105）
-- 只動 actual_amount + updated_at；狀態維持已核銷、不建分錄、不發 LINE。
-- idempotent：WHERE 綁舊值，更正後再跑 0 筆。

BEGIN;
SET LOCAL app.skip_chain_notify = 'true';

UPDATE public.expense_requests
   SET actual_amount = 7327, updated_at = NOW()
 WHERE id = 231 AND actual_amount = 7927 AND status = '已核銷';

UPDATE public.expense_requests
   SET actual_amount = 2175, updated_at = NOW()
 WHERE id = 240 AND actual_amount = 2070 AND status = '已核銷';

COMMIT;
