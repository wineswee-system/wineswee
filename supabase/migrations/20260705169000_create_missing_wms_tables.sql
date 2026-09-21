-- ─────────────────────────────────────────────────────────────────────────────
-- 補建遠端缺漏的 WMS 表（2026-07-07 drift 檢查發現）
--
-- inventory_valuations / stock_counts 原只存在於初始 schema（ARCHIVE），
-- 從無 migration 管理；遠端實測不存在，但 20260705170000_inventory_monthly_close
-- 於 statement 17 直接 ALTER 這兩張表 → push 失敗。
-- 此處以 ARCHIVE 定義原樣補建（organization_id 等補欄由 170000 接手）。
--
-- 冪等：可重複執行。
-- ─────────────────────────────────────────────────────────────────────────────

-- 庫存估價快照（src/lib/db/finance.js、valuationSnapshots.js 使用）
CREATE TABLE IF NOT EXISTS public.inventory_valuations (
  id             SERIAL PRIMARY KEY,
  sku_id         INT REFERENCES public.skus(id),
  valuation_date DATE,
  costing_method TEXT DEFAULT 'weighted_avg',  -- fifo, weighted_avg
  total_quantity NUMERIC DEFAULT 0,
  total_value    NUMERIC DEFAULT 0,
  unit_cost      NUMERIC DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 庫存盤點作業（src/lib/db/inventoryClose.js、manufacturing.js 使用）
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id            SERIAL PRIMARY KEY,
  count_date    DATE,
  warehouse     TEXT,
  counter       TEXT,
  items         JSONB DEFAULT '[]',
  total_items   INT DEFAULT 0,
  discrepancies INT DEFAULT 0,
  status        TEXT DEFAULT '盤點中',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
-- RLS/org 欄位由後續 migration（20260705170000 補欄、20260705210000 valuations RLS）處理
