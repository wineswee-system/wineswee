-- ============================================================
-- Phase 1.3 — Real org-scoped RLS replacing 490 blanket-true policies
--
-- Strategy:
--   1. Add helper current_employee_org() = organization_id of caller
--   2. Drop ALL blanket-true policies (qual='true' or NULL)
--   3. Recreate with org-scoped USING clause
--   4. Enable RLS on the 26 tables that have it OFF
--
-- Risk: HIGH. If current_employee_id() returns NULL for a logged-in user
-- (no matching email in employees), they lose all data access.
--
-- Pre-flight check the deploy script runs:
--   SELECT count(*) FROM employees WHERE email IN (SELECT email FROM auth.users);
--   should equal count(*) of auth.users you expect to use the system.
-- ============================================================

BEGIN;

-- 1. Helper: org-id of current user (cached per query via STABLE).
CREATE OR REPLACE FUNCTION public.current_employee_org()
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.employees
  WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.current_employee_org() TO authenticated, anon;

-- 2. Drop blanket-true policies across the public schema.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND (
        (qual IS NOT NULL AND btrim(qual, '() ') = 'true')
        OR (qual IS NULL AND with_check IS NOT NULL AND btrim(with_check, '() ') = 'true')
        OR (qual IS NULL AND with_check IS NULL)
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- 3. Enable RLS on tables where it's currently OFF.
DO $$
DECLARE
  t TEXT;
  candidates TEXT[] := ARRAY[
    'roles','permissions','role_permissions','approval_requests','approval_rules',
    'leave_records','leave_entitlements','leave_settlements','salary_revisions',
    'overtime_records','fatigue_scores','employee_availability',
    'schedule_publish_status','store_time_slots','ecommerce_connections',
    'ecommerce_sync_logs','onboarding_plans','offboarding_plans','tax_filings',
    'sales_returns','referral_codes','referral_redemptions','inventory_lots',
    'bins','event_outbox'
  ];
BEGIN
  FOREACH t IN ARRAY candidates LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- 4. Apply org-scoped policies to tables that have organization_id.
--    Pattern:
--      - SELECT/UPDATE/DELETE: row.organization_id = caller.org
--      - INSERT: with_check on organization_id = caller.org
--    Admin/super_admin (per existing current_employee_role()) bypasses scoping.
DO $$
DECLARE
  t TEXT;
  has_org BOOLEAN;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tab USING (table_schema, table_name)
    WHERE c.table_schema='public' AND c.column_name='organization_id'
      AND tab.table_type='BASE TABLE'
      AND c.table_name NOT IN ('organizations','tenants')
  LOOP
    -- Drop any pre-existing org-scoped policy with our names so re-runs are idempotent.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_scope_select_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_scope_modify_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_scope_insert_'||t, t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- SELECT
    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (
        organization_id = public.current_employee_org()
        OR public.current_employee_role() IN ('admin','super_admin')
      )
    $q$, 'org_scope_select_'||t, t);

    -- INSERT
    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (
        organization_id = public.current_employee_org()
        OR public.current_employee_role() IN ('admin','super_admin')
      )
    $q$, 'org_scope_insert_'||t, t);

    -- UPDATE + DELETE combined
    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (
        organization_id = public.current_employee_org()
        OR public.current_employee_role() IN ('admin','super_admin')
      )
      WITH CHECK (
        organization_id = public.current_employee_org()
        OR public.current_employee_role() IN ('admin','super_admin')
      )
    $q$, 'org_scope_modify_'||t, t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (
        organization_id = public.current_employee_org()
        OR public.current_employee_role() IN ('admin','super_admin')
      )
    $q$, 'org_scope_delete_'||t, t);
  END LOOP;
END $$;

-- 5. Tables WITHOUT organization_id: keep them readable by any authenticated user
--    but require admin to mutate. Examples: shared lookup tables, audit logs.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tab.table_name
    FROM information_schema.tables tab
    WHERE tab.table_schema='public' AND tab.table_type='BASE TABLE'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=tab.table_name
          AND column_name='organization_id'
      )
      -- Skip sequences, mat-views, internal tables
      AND tab.table_name NOT IN ('organizations')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   'auth_read_'||t.table_name, t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   'admin_write_'||t.table_name, t.table_name);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)
    $q$, 'auth_read_'||t.table_name, t.table_name);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.current_employee_role() IN ('admin','super_admin'))
      WITH CHECK (public.current_employee_role() IN ('admin','super_admin'))
    $q$, 'admin_write_'||t.table_name, t.table_name);
  END LOOP;
END $$;

-- 6. Special case: organizations itself. Read-all (single-tenant deployment),
--    admin-only write.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_read_organizations ON public.organizations;
DROP POLICY IF EXISTS admin_write_organizations ON public.organizations;
CREATE POLICY auth_read_organizations ON public.organizations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY admin_write_organizations ON public.organizations
  FOR ALL TO authenticated
  USING (public.current_employee_role() IN ('admin','super_admin'))
  WITH CHECK (public.current_employee_role() IN ('admin','super_admin'));

COMMIT;

-- ============================================================
-- Post-apply sanity test (run as authenticated user via app):
--   SELECT count(*) FROM employees;
--   Expected: rows where organization_id matches current user's org.
-- ============================================================
