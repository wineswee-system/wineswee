-- ════════════════════════════════════════════════════════════════════════════
-- expense_requests：新增「驗收單位」多選欄位
-- 2026-06-27
--
-- 驗收單位 = 申請採購時，指定哪些門市/單位會收到/驗收此批貨物。
-- 以 TEXT[] 儲存門市名稱陣列（與 stores.name 對應，非 FK，彈性高）。
-- 預設空陣列，現有資料不受影響。
-- idempotent：ADD COLUMN IF NOT EXISTS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS acceptance_units TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.expense_requests.acceptance_units IS
  '驗收單位（多選）：申請時指定哪些門市/單位負責收貨驗收，存門市名稱陣列';

NOTIFY pgrst, 'reload schema';
