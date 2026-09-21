-- ============================================================
-- 20260621100000_membership_org_company_scoping.sql
-- Sprint 0 — Membership Foundation
--
-- 1. Configurable member_levels (replaces hard-coded TIER_RULES)
-- 2. member_level_history audit log
-- 3. birthday_reward_config
-- 4. member_purchases + member_purchase_lines
-- 5. company_memberships
-- 6. ALTER members: org_id, level_id, auth_uid, type, lifetime_spend,
--                   qr_token, referral_code, inferred_prefs_json, company_id
-- 7. ALTER point_transactions: org_id, expires_at
-- 8. ALTER skus: CRM/wine attributes
-- 9. Seed default 4-tier levels for existing orgs
-- 10. RLS on all new + modified tables
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. MEMBER_LEVELS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_levels (
  id                        BIGSERIAL PRIMARY KEY,
  organization_id           BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  rank                      INT NOT NULL DEFAULT 0,          -- 0 = lowest; higher = better
  color                     TEXT DEFAULT '#6b7280',
  icon                      TEXT DEFAULT '⭐',
  criteria_type             TEXT NOT NULL DEFAULT 'lifetime_spend'
    CHECK (criteria_type IN ('lifetime_spend','visit_count','lifetime_points','manual')),
  criteria_value            NUMERIC(14,2) DEFAULT 0,
  point_multiplier          NUMERIC(4,2) DEFAULT 1.0,
  birthday_multiplier       NUMERIC(4,2) DEFAULT 2.0,
  welcome_points            INT DEFAULT 0,
  welcome_coupon_id         INT,                             -- FK added once coupons table exists
  downgrade_inactive_months INT DEFAULT 12,
  is_default                BOOLEAN DEFAULT FALSE,           -- exactly one per org (entry tier)
  created_at                TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_member_levels_org ON public.member_levels(organization_id);

-- ═══════════════════════════════════════════════════════════
-- 2. MEMBER_LEVEL_HISTORY
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_level_history (
  id               BIGSERIAL PRIMARY KEY,
  member_id        INT NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  organization_id  BIGINT NOT NULL,
  from_level_id    INT REFERENCES public.member_levels(id) ON DELETE SET NULL,
  to_level_id      INT NOT NULL REFERENCES public.member_levels(id) ON DELETE CASCADE,
  from_level_name  TEXT,
  to_level_name    TEXT,
  reason           TEXT,    -- 'upgrade' | 'downgrade' | 'manual' | 'welcome'
  changed_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mlh_member ON public.member_level_history(member_id);

-- ═══════════════════════════════════════════════════════════
-- 3. BIRTHDAY_REWARD_CONFIG
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.birthday_reward_config (
  id                  BIGSERIAL PRIMARY KEY,
  organization_id     BIGINT NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled             BOOLEAN DEFAULT TRUE,
  reward_type         TEXT DEFAULT 'points'
    CHECK (reward_type IN ('points','coupon','both')),
  points_amount       INT DEFAULT 0,
  coupon_id           INT,
  send_days_before    INT DEFAULT 7,
  valid_days          INT DEFAULT 30,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════
-- 4. MEMBER_PURCHASES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_purchases (
  id               BIGSERIAL PRIMARY KEY,
  member_id        INT NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  organization_id  BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id         INT REFERENCES public.stores(id) ON DELETE SET NULL,
  transaction_id   INT REFERENCES public.pos_transactions(id) ON DELETE SET NULL,
  purchased_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method   TEXT CHECK (payment_method IN (
    'cash','card','line_pay','apple_pay','transfer','voucher','mixed'
  )),
  points_earned    INT DEFAULT 0,
  coupon_id        INT,     -- FK to coupon_assignments once table exists
  survey_id        INT,     -- FK to surveys once table exists
  survey_score     NUMERIC(3,1),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_member    ON public.member_purchases(member_id);
CREATE INDEX IF NOT EXISTS idx_mp_org       ON public.member_purchases(organization_id);
CREATE INDEX IF NOT EXISTS idx_mp_store     ON public.member_purchases(store_id);
CREATE INDEX IF NOT EXISTS idx_mp_purchased ON public.member_purchases(purchased_at DESC);

-- ═══════════════════════════════════════════════════════════
-- 5. MEMBER_PURCHASE_LINES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_purchase_lines (
  id               BIGSERIAL PRIMARY KEY,
  purchase_id      BIGINT NOT NULL REFERENCES public.member_purchases(id) ON DELETE CASCADE,
  product_id       INT REFERENCES public.skus(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  product_category TEXT CHECK (product_category IN (
    'wine','beer','spirits','non_alcoholic','food','accessory'
  )),
  product_type     TEXT,
  qty              NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mpl_purchase  ON public.member_purchase_lines(purchase_id);
CREATE INDEX IF NOT EXISTS idx_mpl_product   ON public.member_purchase_lines(product_id);
CREATE INDEX IF NOT EXISTS idx_mpl_category  ON public.member_purchase_lines(product_category);

-- ═══════════════════════════════════════════════════════════
-- 6. COMPANY_MEMBERSHIPS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.company_memberships (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id       INT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  pooled_points    INT DEFAULT 0,
  level_id         INT REFERENCES public.member_levels(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, company_id)
);

-- ═══════════════════════════════════════════════════════════
-- 7. ALTER MEMBERS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS organization_id    BIGINT REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS level_id           INT REFERENCES public.member_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auth_uid           UUID UNIQUE,
  ADD COLUMN IF NOT EXISTS type               TEXT DEFAULT 'consumer'
    CHECK (type IN ('consumer','corporate','vip','staff','trade')),
  ADD COLUMN IF NOT EXISTS lifetime_spend     NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_points    INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qr_token           TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referral_code      TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS inferred_prefs_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS company_id         INT REFERENCES public.customers(id) ON DELETE SET NULL;

-- Backfill organization_id for existing rows
UPDATE public.members
SET organization_id = (SELECT MIN(id) FROM public.organizations)
WHERE organization_id IS NULL;

-- Backfill lifetime fields from existing columns
UPDATE public.members
SET
  lifetime_spend  = COALESCE(total_spent, 0),
  lifetime_points = COALESCE(total_points, 0)
WHERE lifetime_spend = 0;

-- Generate stable QR token for existing members
UPDATE public.members
SET qr_token = 'QR-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT FROM 1 FOR 8))
WHERE qr_token IS NULL;

-- Composite unique: one phone per org (skips if constraint already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'members_phone_org_unique'
  ) THEN
    ALTER TABLE public.members
      ADD CONSTRAINT members_phone_org_unique UNIQUE (phone, organization_id);
  END IF;
END $$;

-- Auto-fill org on new inserts using the shared trigger from 20260618 migration
DROP TRIGGER IF EXISTS trg_members_set_org ON public.members;
CREATE TRIGGER trg_members_set_org
  BEFORE INSERT ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

-- ═══════════════════════════════════════════════════════════
-- 8. ALTER POINT_TRANSACTIONS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.point_transactions
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ;

UPDATE public.point_transactions pt
SET organization_id = m.organization_id
FROM public.members m
WHERE m.id = pt.member_id AND pt.organization_id IS NULL;

-- ═══════════════════════════════════════════════════════════
-- 9. ALTER SKUS — CRM / wine attributes
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS product_category  TEXT
    CHECK (product_category IN ('wine','beer','spirits','non_alcoholic','food','accessory')),
  ADD COLUMN IF NOT EXISTS product_type      TEXT,
  ADD COLUMN IF NOT EXISTS selling_price     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS image_url         TEXT,
  ADD COLUMN IF NOT EXISTS description       TEXT,
  ADD COLUMN IF NOT EXISTS short_name        TEXT,
  ADD COLUMN IF NOT EXISTS wine_vintage      SMALLINT,
  ADD COLUMN IF NOT EXISTS wine_region       TEXT,
  ADD COLUMN IF NOT EXISTS wine_variety      TEXT,
  ADD COLUMN IF NOT EXISTS alcohol_pct       NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS producer          TEXT,
  ADD COLUMN IF NOT EXISTS country_of_origin TEXT;

-- ═══════════════════════════════════════════════════════════
-- 10. SEED DEFAULT MEMBER LEVELS per org
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE v_org BIGINT;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP
    IF EXISTS (SELECT 1 FROM public.member_levels WHERE organization_id = v_org) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.member_levels
      (organization_id, name, rank, color, icon, criteria_type, criteria_value,
       point_multiplier, birthday_multiplier, welcome_points, downgrade_inactive_months, is_default)
    VALUES
      (v_org, '一般會員', 0, '#6b7280', '🪙', 'lifetime_spend',      0, 1.0, 2.0,    0, 12, TRUE),
      (v_org, '銀級會員', 1, '#94a3b8', '🥈', 'lifetime_spend',  10000, 1.2, 2.0,  200, 12, FALSE),
      (v_org, '金級會員', 2, '#f59e0b', '🥇', 'lifetime_spend',  30000, 1.5, 2.5,  500, 12, FALSE),
      (v_org, '鑽石會員', 3, '#22d3ee', '💎', 'lifetime_spend', 100000, 2.0, 3.0, 1500, 18, FALSE);
  END LOOP;
END $$;

-- Backfill members.level_id from existing text level column
UPDATE public.members m SET level_id = ml.id
FROM public.member_levels ml
WHERE ml.organization_id = m.organization_id AND ml.is_default = TRUE
  AND m.level_id IS NULL AND (m.level IN ('一般','一般會員') OR m.level IS NULL);

UPDATE public.members m SET level_id = ml.id
FROM public.member_levels ml
WHERE ml.organization_id = m.organization_id AND ml.name = '銀級會員'
  AND m.level_id IS NULL AND m.level IN ('銀卡','銀級','銀卡會員');

UPDATE public.members m SET level_id = ml.id
FROM public.member_levels ml
WHERE ml.organization_id = m.organization_id AND ml.name = '金級會員'
  AND m.level_id IS NULL AND m.level IN ('金卡','金級','金卡會員');

UPDATE public.members m SET level_id = ml.id
FROM public.member_levels ml
WHERE ml.organization_id = m.organization_id AND ml.name = '鑽石會員'
  AND m.level_id IS NULL AND m.level IN ('白金','鑽石','鑽石會員');

-- Any remaining → default level
UPDATE public.members m SET level_id = (
  SELECT id FROM public.member_levels
  WHERE organization_id = m.organization_id AND is_default = TRUE LIMIT 1
)
WHERE m.level_id IS NULL AND m.organization_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 11. RLS
-- ═══════════════════════════════════════════════════════════

-- members
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_org_sel ON public.members;
CREATE POLICY members_org_sel ON public.members
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS members_ins ON public.members;
CREATE POLICY members_ins ON public.members
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS members_upd ON public.members;
CREATE POLICY members_upd ON public.members
  FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);

-- member_levels
ALTER TABLE public.member_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_levels_sel ON public.member_levels;
CREATE POLICY member_levels_sel ON public.member_levels
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS member_levels_ins ON public.member_levels;
CREATE POLICY member_levels_ins ON public.member_levels
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS member_levels_upd ON public.member_levels;
CREATE POLICY member_levels_upd ON public.member_levels
  FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);
DROP POLICY IF EXISTS member_levels_del ON public.member_levels;
CREATE POLICY member_levels_del ON public.member_levels
  FOR DELETE USING (org_visible(organization_id));

-- member_level_history
ALTER TABLE public.member_level_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mlh_sel ON public.member_level_history;
CREATE POLICY mlh_sel ON public.member_level_history
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS mlh_ins ON public.member_level_history;
CREATE POLICY mlh_ins ON public.member_level_history
  FOR INSERT WITH CHECK (true);

-- birthday_reward_config
ALTER TABLE public.birthday_reward_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brc_sel ON public.birthday_reward_config;
CREATE POLICY brc_sel ON public.birthday_reward_config
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS brc_write ON public.birthday_reward_config;
CREATE POLICY brc_write ON public.birthday_reward_config
  FOR ALL WITH CHECK (true);

-- member_purchases
ALTER TABLE public.member_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mp_sel ON public.member_purchases;
CREATE POLICY mp_sel ON public.member_purchases
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS mp_ins ON public.member_purchases;
CREATE POLICY mp_ins ON public.member_purchases
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS mp_upd ON public.member_purchases;
CREATE POLICY mp_upd ON public.member_purchases
  FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);

-- member_purchase_lines (access via parent purchase)
ALTER TABLE public.member_purchase_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mpl_sel ON public.member_purchase_lines;
CREATE POLICY mpl_sel ON public.member_purchase_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_purchases mp
      WHERE mp.id = purchase_id AND org_visible(mp.organization_id)
    )
  );
DROP POLICY IF EXISTS mpl_ins ON public.member_purchase_lines;
CREATE POLICY mpl_ins ON public.member_purchase_lines
  FOR INSERT WITH CHECK (true);

-- company_memberships
ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_sel ON public.company_memberships;
CREATE POLICY cm_sel ON public.company_memberships
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS cm_write ON public.company_memberships;
CREATE POLICY cm_write ON public.company_memberships
  FOR ALL WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- 12. INDEXES
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_members_org      ON public.members(organization_id);
CREATE INDEX IF NOT EXISTS idx_members_level    ON public.members(level_id);
CREATE INDEX IF NOT EXISTS idx_members_auth_uid ON public.members(auth_uid);
CREATE INDEX IF NOT EXISTS idx_members_qr       ON public.members(qr_token);
CREATE INDEX IF NOT EXISTS idx_pt_org           ON public.point_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_pt_expires       ON public.point_transactions(expires_at)
  WHERE expires_at IS NOT NULL;

COMMIT;
