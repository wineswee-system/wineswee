-- ============================================================
-- Phase 5: Organization Subscriptions + Payments
-- Purpose: SaaS billing, plan management, and payment tracking
-- ============================================================

-- ─── Org Subscriptions ───

CREATE TABLE IF NOT EXISTS org_subscriptions (
  id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',        -- free, starter, pro, enterprise
  status TEXT NOT NULL DEFAULT 'active',    -- active, cancelled, expired, past_due
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  price_monthly NUMERIC(10,2) DEFAULT 0,
  max_users INT DEFAULT 5,
  max_stores INT DEFAULT 1,
  features TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org ON org_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_status ON org_subscriptions(status);

-- ─── Org Payments ───

CREATE TABLE IF NOT EXISTS org_payments (
  id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id INT REFERENCES org_subscriptions(id),
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TWD',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending, paid, failed, refunded
  payment_method TEXT,                       -- credit_card, bank_transfer, etc.
  invoice_number TEXT,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_payments_org ON org_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_payments_status ON org_payments(status);

-- ─── Seed free subscription for existing organizations ───

INSERT INTO org_subscriptions (organization_id, plan, status, current_period_start, max_users, max_stores)
SELECT id, 'free', 'active', now(), 5, 1
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM org_subscriptions s WHERE s.organization_id = organizations.id
);

-- ─── RLS ───

ALTER TABLE org_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_org_subscriptions ON org_subscriptions
  FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE org_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_org_payments ON org_payments
  FOR ALL TO anon USING (true) WITH CHECK (true);
