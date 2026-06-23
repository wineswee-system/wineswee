-- Per-store POS / QR settings
-- One row per store; created via upsert on first save from QRSettings page

CREATE TABLE pos_store_settings (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID    NOT NULL REFERENCES organizations(id),
  store_id              UUID    NOT NULL REFERENCES stores(id),
  qr_ordering_enabled   BOOLEAN DEFAULT false,
  -- 'manual'  — staff sees 🔔 notification and taps confirm before kitchen print
  -- 'auto'    — guest items go straight to kitchen without staff tap
  qr_approval_mode      TEXT    DEFAULT 'manual' CHECK (qr_approval_mode IN ('auto', 'manual')),
  -- how many minutes a QR session token stays valid (from table seated time)
  qr_session_minutes    INT     DEFAULT 240,
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, store_id)
);

ALTER TABLE pos_store_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff" ON pos_store_settings FOR ALL TO authenticated
  USING (organization_id = auth_org_id());
