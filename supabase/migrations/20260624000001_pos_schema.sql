-- POS System Schema
-- All tables are multi-tenant scoped by organization_id + store_id

-- Menu categories
CREATE TABLE IF NOT EXISTS pos_menu_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT NOT NULL REFERENCES organizations(id),
  store_id      INT  NOT NULL REFERENCES stores(id),
  name          TEXT NOT NULL,
  display_order INT  DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Menu items
CREATE TABLE IF NOT EXISTS pos_menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT NOT NULL REFERENCES organizations(id),
  store_id        INT  NOT NULL REFERENCES stores(id),
  category_id     UUID REFERENCES pos_menu_categories(id),
  name            TEXT NOT NULL,
  description     TEXT,
  unit_price      NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(6,4)  DEFAULT 0.05,
  image_url       TEXT,
  is_available    BOOLEAN DEFAULT true,
  display_order   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Menu item → SKU mapping (for inventory deduction)
-- sku_id is BIGINT because skus.id is SERIAL (bigint)
CREATE TABLE IF NOT EXISTS pos_menu_item_skus (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID    NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  sku_id       BIGINT  NOT NULL,  -- references skus(id); FK omitted — skus.id type varies by env
  quantity     NUMERIC(10,4) NOT NULL DEFAULT 1,
  unit         TEXT
);

-- Physical products sold at POS (extends skus with retail_price)
-- skus.unit_cost is procurement cost only — retail_price lives here
CREATE TABLE IF NOT EXISTS pos_products (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT     NOT NULL REFERENCES organizations(id),
  store_id        INT     NOT NULL REFERENCES stores(id),
  sku_id          BIGINT,  -- references skus(id); FK omitted — skus.id type varies by env
  name            TEXT    NOT NULL,
  barcode         TEXT,
  retail_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(6,4)  DEFAULT 0.05,
  category        TEXT,
  image_url       TEXT,
  is_available    BOOLEAN DEFAULT true,
  show_in_qr_menu BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Work shifts — tracks order counter for per-shift sequential order numbers
CREATE TABLE IF NOT EXISTS pos_shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT NOT NULL REFERENCES organizations(id),
  store_id        INT  NOT NULL REFERENCES stores(id),
  employee_id     UUID,  -- references employees(id); FK omitted — employees.id is INT not UUID
  opened_at       TIMESTAMPTZ DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  order_counter   INT  DEFAULT 0,
  status          TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);

-- Orders — one per table session; walk-in tables have no reservation_id
CREATE TABLE IF NOT EXISTS pos_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT NOT NULL REFERENCES organizations(id),
  store_id        INT  NOT NULL REFERENCES stores(id),
  table_id        UUID,  -- FK to res_tables(id) added when reservation migration is applied
  reservation_id  UUID,  -- FK to reservations(id) added when reservation migration is applied
  shift_id        UUID,  -- FK to pos_shifts(id) — not enforced; pos_shifts.id type was set by prior partial run
  order_number    TEXT,
  status          TEXT DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'paid', 'voided')),
  guest_count     INT  DEFAULT 1,
  note            TEXT,
  opened_by       UUID,  -- references employees(id); FK omitted — employees.id is INT not UUID
  opened_at       TIMESTAMPTZ DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ
);

-- Order line items
CREATE TABLE IF NOT EXISTS pos_order_items (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID    NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  item_type       TEXT    NOT NULL CHECK (item_type IN ('menu', 'product', 'custom')),
  menu_item_id    UUID    REFERENCES pos_menu_items(id),
  pos_product_id  UUID    REFERENCES pos_products(id),
  name            TEXT    NOT NULL,
  unit_price      NUMERIC(10,2) NOT NULL,
  tax_rate        NUMERIC(6,4)  DEFAULT 0.05,
  quantity        INT     NOT NULL DEFAULT 1,
  note            TEXT,
  source          TEXT    DEFAULT 'staff' CHECK (source IN ('staff', 'guest')),
  sent_to_kitchen BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Payments — multiple rows per order support split-bill; each row gets its own invoice
CREATE TABLE IF NOT EXISTS pos_payments (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT     NOT NULL REFERENCES organizations(id),
  store_id        INT     NOT NULL REFERENCES stores(id),
  order_id        UUID    NOT NULL REFERENCES pos_orders(id),
  amount          NUMERIC(10,2) NOT NULL,
  payment_method  TEXT    NOT NULL CHECK (payment_method IN ('cash','card','line_pay','jkopay','other')),
  split_index     INT     DEFAULT 1,
  split_total     INT     DEFAULT 1,
  carrier_type    TEXT,   -- '3J0002' mobile barcode / 'CQ0001' NID / 'ECA0001' EasyCard
  carrier_number  TEXT,
  invoice_number  TEXT,
  invoice_status  TEXT    DEFAULT 'pending' CHECK (invoice_status IN ('pending','issued','voided')),
  paid_at         TIMESTAMPTZ DEFAULT now(),
  employee_id     UUID    -- references employees(id); FK omitted — employees.id is INT not UUID
);

-- QR self-ordering sessions — token links guest phone to a table's open order
CREATE TABLE IF NOT EXISTS qr_order_sessions (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT     NOT NULL REFERENCES organizations(id),
  store_id        INT     NOT NULL REFERENCES stores(id),
  table_id        UUID    NOT NULL,  -- FK to res_tables(id) added when reservation migration is applied
  order_id        UUID    REFERENCES pos_orders(id),
  token           TEXT    NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '4 hours',
  created_at      TIMESTAMPTZ DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pos_menu_items_store ON pos_menu_items(store_id, category_id) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_pos_products_barcode ON pos_products(store_id, barcode);
CREATE INDEX IF NOT EXISTS idx_pos_products_store ON pos_products(store_id) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_pos_orders_store ON pos_orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_order ON pos_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_order ON pos_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_store ON pos_shifts(store_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_sessions_active ON qr_order_sessions(token) WHERE revoked_at IS NULL;

-- RLS
ALTER TABLE pos_menu_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_menu_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_menu_item_skus   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_shifts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_order_sessions    ENABLE ROW LEVEL SECURITY;

-- Helper: current authenticated user's organization
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_menu_categories' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_menu_categories  FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_menu_items' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_menu_items       FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_products' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_products         FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_shifts' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_shifts           FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_orders' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_orders           FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_payments' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_payments         FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qr_order_sessions' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON qr_order_sessions    FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_menu_item_skus' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_menu_item_skus FOR ALL TO authenticated
      USING (menu_item_id IN (SELECT id FROM pos_menu_items WHERE organization_id = auth_org_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_order_items' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON pos_order_items FOR ALL TO authenticated
      USING (order_id IN (SELECT id FROM pos_orders WHERE organization_id = auth_org_id()));
  END IF;
END $$;
