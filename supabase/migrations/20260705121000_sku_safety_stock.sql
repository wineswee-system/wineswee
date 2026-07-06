-- ============================================================
-- 20260705121000_sku_safety_stock.sql
-- F-C3.3 安全存量持久化（PLAN_fin-tax-inv_2026-07-04 三/F-C3）
--
-- 現況：安全存量僅在 app 層計算（demandForecast.js），無持久欄位。
-- 此遷移在 skus 補三欄，供 ReorderTab 讀寫（建議值一鍵套用後保存）。
--
-- 冪等：可重複執行。
-- ============================================================

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS safety_stock  NUMERIC,  -- 安全存量
  ADD COLUMN IF NOT EXISTS reorder_point NUMERIC,  -- 再訂購點（低於此量觸發補貨）
  ADD COLUMN IF NOT EXISTS reorder_qty   NUMERIC;  -- 建議訂購量

COMMENT ON COLUMN public.skus.safety_stock  IS '安全存量（F-C3.3）：Z × σ × √前置時間，可由 demandForecast 建議值套用或手動維護';
COMMENT ON COLUMN public.skus.reorder_point IS '再訂購點：平均日需求 × 前置時間 + 安全存量';
COMMENT ON COLUMN public.skus.reorder_qty   IS '建議訂購量：補貨時的預設下單數量';

NOTIFY pgrst, 'reload schema';
