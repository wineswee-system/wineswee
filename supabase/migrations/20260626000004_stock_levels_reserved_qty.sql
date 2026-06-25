-- Add reserved_qty to stock_levels so sales-order reservations can be persisted
ALTER TABLE stock_levels ADD COLUMN IF NOT EXISTS reserved_qty numeric NOT NULL DEFAULT 0;
ALTER TABLE stock_levels ADD CONSTRAINT chk_stock_levels_reserved_qty_nonneg CHECK (reserved_qty >= 0);
