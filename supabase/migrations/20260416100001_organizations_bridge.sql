-- ============================================================
-- Phase 1: Organizations Table + Tenant Bridge
-- Purpose: Add root organization entity for multi-tenant SaaS hierarchy
-- Hierarchy: Organization → Company → Store → Department → Employee
-- ============================================================

-- ─── 1. Create organizations table ───

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tax_id TEXT,
  contact_person TEXT,
  phone TEXT,
  address TEXT,
  logo_url TEXT,
  status TEXT DEFAULT 'active',       -- active, suspended, archived
  plan TEXT DEFAULT 'free',           -- free, starter, pro, enterprise
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- ─── 2. Bridge tenants → organizations ───

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);

-- Backfill: create one organization per existing tenant
INSERT INTO organizations (name, slug)
SELECT
  name,
  COALESCE(slug, 'org-' || id)
FROM tenants
WHERE NOT EXISTS (
  SELECT 1 FROM organizations o WHERE o.slug = COALESCE(tenants.slug, 'org-' || tenants.id)
);

-- Link tenants to their organizations
UPDATE tenants t
SET organization_id = o.id
FROM organizations o
WHERE o.slug = COALESCE(t.slug, 'org-' || t.id)
  AND t.organization_id IS NULL;

-- ─── 3. Helper functions ───

CREATE OR REPLACE FUNCTION get_organization_id(p_tenant_id INT)
RETURNS INT AS $$
  SELECT organization_id FROM tenants WHERE id = p_tenant_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_tenant_id(p_org_id INT)
RETURNS INT AS $$
  SELECT id FROM tenants WHERE organization_id = p_org_id;
$$ LANGUAGE sql STABLE;

-- ─── 4. RLS for organizations ───

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Allow access when org matches the current tenant's organization
CREATE POLICY org_isolation ON organizations
  FOR ALL USING (
    id = (SELECT organization_id FROM tenants WHERE id::text = coalesce(current_setting('app.tenant_id', true), ''))
  );

-- Anon fallback for development
CREATE POLICY anon_organizations ON organizations
  FOR ALL TO anon USING (true) WITH CHECK (true);
