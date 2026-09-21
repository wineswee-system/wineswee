-- ============================================================
-- WMS Phase 2: FEFO + Multi-UOM + Landed Cost
-- ============================================================

-- ─── 1. Multi-UOM on skus ───────────────────────────────────
-- purchase_uom: unit used when receiving from supplier (e.g. 箱)
-- purchase_uom_qty: how many base units per purchase unit (e.g. 12 → 1箱=12個)
-- sale_uom / sale_uom_qty: same concept for outbound (usually = base)
ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS purchase_uom      TEXT,
  ADD COLUMN IF NOT EXISTS purchase_uom_qty  NUMERIC(10,4) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sale_uom          TEXT,
  ADD COLUMN IF NOT EXISTS sale_uom_qty      NUMERIC(10,4) DEFAULT 1;

-- ─── 2. FEFO: expiry_date on inventory_cost_layers ──────────
-- Create the table if it was never migrated (remote may have been bootstrapped via schema dump)
CREATE TABLE IF NOT EXISTS public.inventory_cost_layers (
  id                 SERIAL PRIMARY KEY,
  sku_id             INT    NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  warehouse_id       INT    REFERENCES public.warehouses(id) ON DELETE SET NULL,
  quantity_remaining NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_cost          NUMERIC(14,4) NOT NULL DEFAULT 0,
  source_type        TEXT   DEFAULT 'purchase' CHECK (source_type IN ('purchase', 'manufacturing', 'adjustment')),
  source_id          INT,
  lot_number         TEXT,
  receipt_date       DATE   NOT NULL DEFAULT CURRENT_DATE,
  organization_id    INT    REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- Allows the costing engine to pick the earliest-expiring layer first
ALTER TABLE public.inventory_cost_layers
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- Partial index: only rows with remaining stock, ordered for FEFO scan
CREATE INDEX IF NOT EXISTS idx_cost_layers_fefo
  ON public.inventory_cost_layers(sku_id, warehouse_id, expiry_date ASC NULLS LAST)
  WHERE quantity_remaining > 0;

-- ─── 3. UOM columns on inbound_items ────────────────────────
-- Snapshot of the SKU's purchase UOM at time of ordering so the receiving
-- screen can show "5 箱 × 12 = 60 個" without a live SKU lookup
ALTER TABLE public.inbound_items
  ADD COLUMN IF NOT EXISTS purchase_uom      TEXT,
  ADD COLUMN IF NOT EXISTS purchase_uom_qty  NUMERIC(10,4) DEFAULT 1;

-- ─── 4. Landed costs table ──────────────────────────────────
-- Stores freight, duty, insurance charged against an inbound order.
-- Per-item allocation is computed in the app layer.
CREATE TABLE IF NOT EXISTS public.landed_costs (
  id                SERIAL PRIMARY KEY,
  inbound_order_id  INT    NOT NULL,
  cost_type         TEXT   NOT NULL CHECK (cost_type IN ('freight', 'duty', 'insurance', 'other')),
  amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
  allocation_method TEXT   DEFAULT 'by_value' CHECK (allocation_method IN ('by_value', 'by_qty', 'by_weight')),
  notes             TEXT,
  organization_id   INT    REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_landed_costs_order ON public.landed_costs(inbound_order_id);
