-- ============================================================
-- 20260704100000_pos_drawer_events.sql
-- 錢箱開啟稽核紀錄
--
-- 錢箱經 RJ45/RJ12 接收據機踢出埠，由印表機 ESC/POS 脈衝開啟；
-- 每次開箱（收款 / 現金校正 / 退款 / 其他）都留一筆紀錄供對帳。
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_drawer_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT  NOT NULL REFERENCES organizations(id),
  store_id        INT  NOT NULL REFERENCES stores(id),
  order_id        UUID REFERENCES pos_orders(id),
  reason          TEXT NOT NULL CHECK (reason IN ('sale', 'correction', 'refund', 'other')),
  note            TEXT,
  opened_by       UUID,  -- auth uid（同 pos_orders.opened_by 慣例，不設 FK）
  opened_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawer_events_store ON pos_drawer_events(store_id, opened_at DESC);

ALTER TABLE pos_drawer_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_drawer_events' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_drawer_events FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
END $$;
