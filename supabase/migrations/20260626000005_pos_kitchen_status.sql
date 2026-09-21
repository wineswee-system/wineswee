-- Migration: pos kitchen status progression
-- Adds new order status values, item_status column, and order_source column
-- so QR approval flow and KDS can track orders through the full lifecycle.

-- ── 1. Extend pos_orders.status to include kitchen lifecycle states ─────────
ALTER TABLE pos_orders DROP CONSTRAINT IF EXISTS pos_orders_status_check;
ALTER TABLE pos_orders ADD CONSTRAINT pos_orders_status_check
  CHECK (status IN ('open','submitted','confirmed','preparing','ready','paid','served','voided'));

-- ── 2. Order source — which channel created this order ─────────────────────
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS order_source TEXT DEFAULT 'staff'
  CHECK (order_source IN ('staff','qr','kiosk'));

-- ── 3. Per-item status — drives kitchen display progression ────────────────
ALTER TABLE pos_order_items ADD COLUMN IF NOT EXISTS item_status TEXT DEFAULT 'pending'
  CHECK (item_status IN ('pending','confirmed','preparing','ready','cancelled'));

-- Backfill: existing items already sent to kitchen are treated as confirmed
UPDATE pos_order_items SET item_status = 'confirmed'
  WHERE sent_to_kitchen = true AND item_status = 'pending';

-- ── 4. Indexes for kitchen display queries ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pos_order_items_kitchen
  ON pos_order_items(order_id, item_status) WHERE sent_to_kitchen = true;

CREATE INDEX IF NOT EXISTS idx_pos_order_items_guest_pending
  ON pos_order_items(order_id, created_at)
  WHERE source = 'guest' AND item_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pos_orders_source
  ON pos_orders(store_id, order_source, status);
