-- ============================================================
-- 20260627000000_pos_feature_expansion.sql
-- POS Feature Expansion
--
-- 1. Course management     — pos_order_items.course column
-- 2. Combo products        — pos_menu_combos, pos_menu_combo_items
-- 3. Product variants      — pos_menu_item_variants
-- 4. House account         — members.credit_balance, pos_house_account_txns
-- 5. RLS for all new tables
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1. COURSE MANAGEMENT
-- course: 1 = 第一輪, 2 = 第二輪, 3 = 第三輪
-- ═══════════════════════════════════════════════════════════

ALTER TABLE pos_order_items
  ADD COLUMN IF NOT EXISTS course int NOT NULL DEFAULT 1;

-- ═══════════════════════════════════════════════════════════
-- 2. COMBO PRODUCTS
-- organization_id + store_id follow the same INT type as the
-- rest of the POS schema (stores.id is SERIAL/INT).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pos_menu_combos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  INT         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id         INT         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  description      TEXT,
  price            NUMERIC(10,2) NOT NULL,
  image_url        TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  display_order    INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_menu_combo_items (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id      UUID  NOT NULL REFERENCES pos_menu_combos(id) ON DELETE CASCADE,
  menu_item_id  UUID  NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  quantity      INT   NOT NULL DEFAULT 1,
  sort_order    INT   NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pos_menu_combos_store
  ON pos_menu_combos(store_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pos_menu_combo_items_combo
  ON pos_menu_combo_items(combo_id);

-- ═══════════════════════════════════════════════════════════
-- 3. PRODUCT VARIANTS
-- options format:
--   [{"id":"<uuid>","label":"小","price_delta":0},
--    {"id":"<uuid>","label":"大","price_delta":10}]
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pos_menu_item_variants (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID        NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  group_name    TEXT        NOT NULL,
  options       JSONB       NOT NULL DEFAULT '[]',
  is_required   BOOLEAN     NOT NULL DEFAULT false,
  sort_order    INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_menu_item_variants_item
  ON pos_menu_item_variants(menu_item_id);

-- ═══════════════════════════════════════════════════════════
-- 4. HOUSE ACCOUNT
-- members.id is SERIAL (INT), confirmed from init schema.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS pos_house_account_txns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        INT         NOT NULL REFERENCES members(id),
  amount           NUMERIC(10,2) NOT NULL,
  balance_after    NUMERIC(10,2) NOT NULL,
  reference_type   TEXT,
  reference_id     UUID,
  note             TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_house_account_txns_member
  ON pos_house_account_txns(member_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- 5. RLS
--
-- Pattern mirrors pos_menu_items / pos_menu_categories:
--   - Tables with organization_id: policy "staff" FOR ALL TO authenticated
--     USING (organization_id = auth_org_id())
--   - Child/junction tables without organization_id: subquery via parent
-- ═══════════════════════════════════════════════════════════

-- pos_menu_combos — has organization_id directly
ALTER TABLE pos_menu_combos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pos_menu_combos' AND policyname = 'staff'
  ) THEN
    CREATE POLICY "staff" ON pos_menu_combos
      FOR ALL TO authenticated
      USING (organization_id = auth_org_id());
  END IF;
END $$;

-- pos_menu_combo_items — child of pos_menu_combos; resolve org via combo
ALTER TABLE pos_menu_combo_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pos_menu_combo_items' AND policyname = 'staff'
  ) THEN
    CREATE POLICY "staff" ON pos_menu_combo_items
      FOR ALL TO authenticated
      USING (
        combo_id IN (
          SELECT id FROM pos_menu_combos WHERE organization_id = auth_org_id()
        )
      );
  END IF;
END $$;

-- pos_menu_item_variants — child of pos_menu_items; resolve org via menu item
ALTER TABLE pos_menu_item_variants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pos_menu_item_variants' AND policyname = 'staff'
  ) THEN
    CREATE POLICY "staff" ON pos_menu_item_variants
      FOR ALL TO authenticated
      USING (
        menu_item_id IN (
          SELECT id FROM pos_menu_items WHERE organization_id = auth_org_id()
        )
      );
  END IF;
END $$;

-- pos_house_account_txns — resolve org via members table
ALTER TABLE pos_house_account_txns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pos_house_account_txns' AND policyname = 'staff'
  ) THEN
    CREATE POLICY "staff" ON pos_house_account_txns
      FOR ALL TO authenticated
      USING (
        member_id IN (
          SELECT id FROM members WHERE organization_id = auth_org_id()
        )
      );
  END IF;
END $$;
