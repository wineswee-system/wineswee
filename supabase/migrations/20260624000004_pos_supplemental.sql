-- Supplemental POS additions

-- paid_at may be absent if initial migration was applied before this column was added
ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- show_in_qr_menu flag for filtering which products appear in guest self-order
ALTER TABLE pos_products
  ADD COLUMN IF NOT EXISTS show_in_qr_menu BOOLEAN NOT NULL DEFAULT true;

-- Return / refund records
CREATE TABLE IF NOT EXISTS pos_returns (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id            UUID          NOT NULL,
  order_id            UUID          REFERENCES pos_orders(id),
  employee_id         UUID,
  return_items        JSONB         NOT NULL DEFAULT '[]',
  refund_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
  refund_method       TEXT          CHECK (refund_method IN ('cash','card','store_credit')),
  credit_note_number  TEXT,
  note                TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE pos_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_pos_returns" ON pos_returns
  USING (
    organization_id = (
      SELECT organization_id FROM employees WHERE id = auth.uid() LIMIT 1
    )
  );

-- Performance indexes for QR session validation and guest item rate-limiting
CREATE INDEX IF NOT EXISTS idx_qr_sessions_token
  ON qr_order_sessions (token);

CREATE INDEX IF NOT EXISTS idx_order_items_guest
  ON pos_order_items (order_id, source, created_at)
  WHERE source = 'guest';
