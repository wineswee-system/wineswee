-- ============================================================
-- Phase 1.1 — Collapse tenants → organizations
--
-- Live state (verified 2026-04-20):
--   tenants:           0 rows
--   organizations:     1 row  (id=1, "威耀時代股份有限公司")
--   tables w/ tenant_id: approval_requests, benefit_policies, bonus_records,
--                        bonus_settings, inventory_lots
-- Strategy: backfill organization_id = 1 (only org); drop tenant_id; drop tenants table.
-- Risk: LOW. tenants is empty; only one org exists.
-- ============================================================

BEGIN;

-- 1. Add organization_id where missing, backfill with the single org id.
DO $$
DECLARE
  default_org_id INT;
  t RECORD;
BEGIN
  SELECT id INTO default_org_id FROM organizations ORDER BY id LIMIT 1;
  IF default_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found; cannot migrate tenant_id refs';
  END IF;

  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='tenant_id'
      AND table_name <> 'tenants'
  LOOP
    -- Add organization_id if missing
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id) ON DELETE SET NULL',
      t.table_name
    );
    -- Backfill from existing tenant_id (NULL → default), or use default_org_id outright
    EXECUTE format(
      'UPDATE public.%I SET organization_id = COALESCE(organization_id, %s) WHERE organization_id IS NULL',
      t.table_name, default_org_id
    );
    -- Drop tenant_id column. CASCADE because old RLS policies reference it;
    -- Phase 1.3 will recreate proper org-scoped policies.
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS tenant_id CASCADE', t.table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_org ON public.%I(organization_id)',
                   t.table_name, t.table_name);
  END LOOP;
END $$;

-- 2. Drop the tenants table itself.
--    The tenants_organization_id_fkey on tenants will go with it.
DROP TABLE IF EXISTS public.tenants CASCADE;

-- 3. Validation: no tenant_id columns should remain in public schema.
DO $$
DECLARE leftover INT;
BEGIN
  SELECT count(*) INTO leftover FROM information_schema.columns
  WHERE table_schema='public' AND column_name='tenant_id';
  IF leftover > 0 THEN
    RAISE EXCEPTION 'tenant_id columns remain after Phase 1.1: %', leftover;
  END IF;
END $$;

COMMIT;
