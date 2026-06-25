-- ============================================================
-- 20260626100000_coupons.sql
-- Sprint 2 — Coupon Engine
--
-- 1. coupons          — coupon templates (create once, issue many)
-- 2. coupon_assignments — per-member issuance + redemption record
-- 3. RLS on both tables
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. COUPONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.coupons (
  id                      BIGSERIAL PRIMARY KEY,
  organization_id         BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identity
  code                    TEXT NOT NULL,
  name                    TEXT NOT NULL,
  description             TEXT,

  -- Discount type & value
  type                    TEXT NOT NULL DEFAULT 'pct_off'
    CHECK (type IN ('pct_off','fixed_off','free_item','bogo','points_2x')),
  value                   NUMERIC(10,2) DEFAULT 0,   -- % for pct_off, NT$ for fixed_off, multiplier for points_2x
  free_item_product_id    INT REFERENCES public.skus(id) ON DELETE SET NULL,

  -- Redemption constraints
  min_purchase            NUMERIC(10,2) DEFAULT 0,
  product_filter_json     JSONB,              -- optional category / product whitelist
  min_level_rank          INT DEFAULT 0,      -- 0 = open to all; N = requires level.rank >= N

  -- Validity window
  valid_from              TIMESTAMPTZ DEFAULT now(),
  valid_until             TIMESTAMPTZ,

  -- Usage limits
  usage_limit_total       INT,               -- null = unlimited
  usage_limit_per_member  INT DEFAULT 1,     -- null = unlimited
  used_count              INT NOT NULL DEFAULT 0,    -- running total, incremented on redemption

  -- Stacking rules
  combinable              BOOLEAN NOT NULL DEFAULT FALSE,

  -- Lifecycle
  status                  TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','expired')),

  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),

  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_org    ON public.coupons(organization_id);
CREATE INDEX IF NOT EXISTS idx_coupons_status ON public.coupons(status);

-- ═══════════════════════════════════════════════════════════
-- 2. COUPON_ASSIGNMENTS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.coupon_assignments (
  id                  BIGSERIAL PRIMARY KEY,
  coupon_id           BIGINT NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  member_id           INT    NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  organization_id     BIGINT NOT NULL,   -- denorm for fast org-scoped queries

  assigned_at         TIMESTAMPTZ DEFAULT now(),
  assigned_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assignment_reason   TEXT DEFAULT 'individual'
    CHECK (assignment_reason IN (
      'broadcast','segment','individual','level_up','birthday','referral','challenge','pilot'
    )),

  -- Redemption
  used_at             TIMESTAMPTZ,
  used_at_purchase_id BIGINT,   -- FK added below once member_purchases exists

  -- Expiry can be overridden per assignment (falls back to coupon.valid_until)
  expires_at          TIMESTAMPTZ,

  UNIQUE (coupon_id, member_id)   -- one assignment per member per coupon template
);

CREATE INDEX IF NOT EXISTS idx_ca_coupon ON public.coupon_assignments(coupon_id);
CREATE INDEX IF NOT EXISTS idx_ca_member ON public.coupon_assignments(member_id);
CREATE INDEX IF NOT EXISTS idx_ca_org    ON public.coupon_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_ca_used   ON public.coupon_assignments(used_at) WHERE used_at IS NULL;

-- ═══════════════════════════════════════════════════════════
-- 3. FK BACK-REFS (deferred — tables now exist)
-- ═══════════════════════════════════════════════════════════

-- member_levels.welcome_coupon_id → coupons (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'member_levels')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ml_welcome_coupon')
  THEN
    ALTER TABLE public.member_levels
      ADD CONSTRAINT fk_ml_welcome_coupon
      FOREIGN KEY (welcome_coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;
  END IF;
END $$;

-- birthday_reward_config.coupon_id → coupons (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'birthday_reward_config')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_brc_coupon')
  THEN
    ALTER TABLE public.birthday_reward_config
      ADD CONSTRAINT fk_brc_coupon
      FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;
  END IF;
END $$;

-- coupon_assignments.used_at_purchase_id → member_purchases (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'member_purchases')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ca_purchase')
  THEN
    ALTER TABLE public.coupon_assignments
      ADD CONSTRAINT fk_ca_purchase
      FOREIGN KEY (used_at_purchase_id) REFERENCES public.member_purchases(id) ON DELETE SET NULL;
  END IF;
END $$;

-- member_purchases.coupon_id → coupon_assignments (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'member_purchases')
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mp_coupon')
  THEN
    ALTER TABLE public.member_purchases
      ADD CONSTRAINT fk_mp_coupon
      FOREIGN KEY (coupon_id) REFERENCES public.coupon_assignments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 4. RLS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coupons_sel ON public.coupons;
CREATE POLICY coupons_sel ON public.coupons
  FOR SELECT USING (org_visible(organization_id));

DROP POLICY IF EXISTS coupons_ins ON public.coupons;
CREATE POLICY coupons_ins ON public.coupons
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS coupons_upd ON public.coupons;
CREATE POLICY coupons_upd ON public.coupons
  FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);

DROP POLICY IF EXISTS coupons_del ON public.coupons;
CREATE POLICY coupons_del ON public.coupons
  FOR DELETE USING (org_visible(organization_id));

ALTER TABLE public.coupon_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ca_sel ON public.coupon_assignments;
CREATE POLICY ca_sel ON public.coupon_assignments
  FOR SELECT USING (org_visible(organization_id));

DROP POLICY IF EXISTS ca_ins ON public.coupon_assignments;
CREATE POLICY ca_ins ON public.coupon_assignments
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS ca_upd ON public.coupon_assignments;
CREATE POLICY ca_upd ON public.coupon_assignments
  FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);

DROP POLICY IF EXISTS ca_del ON public.coupon_assignments;
CREATE POLICY ca_del ON public.coupon_assignments
  FOR DELETE USING (org_visible(organization_id));

-- ═══════════════════════════════════════════════════════════
-- 5. UPDATED_AT TRIGGER
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_coupons_updated_at ON public.coupons;
CREATE TRIGGER trg_coupons_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
