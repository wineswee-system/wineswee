-- ============================================================
-- Security Fix C-3 (partial): super_admin RLS enforcement
--
-- PROBLEM: The roles, permissions, and role_permissions tables
-- control the entire RBAC system. Any authenticated user could
-- mutate them (INSERT/UPDATE/DELETE) because only blanket
-- `FOR ALL TO authenticated USING (true)` policies existed.
--
-- FIX:
--   1. Ensure anon has no access to RBAC tables.
--   2. Keep SELECT open to authenticated (needed for permission
--      checks, role dropdowns, etc.).
--   3. Restrict INSERT / UPDATE / DELETE on roles, permissions,
--      role_permissions to super_admin only.
--
-- NOTE: current_employee_role() was created in
-- 20260418000005_security_hardening.sql and improved in
-- 20260424100100_security_hardening.sql. We reuse it here.
-- A safe fallback CREATE is included in case the function is
-- somehow missing.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Ensure current_employee_role() exists (idempotent fallback)
--    Does NOT overwrite the improved version from 20260424100100.
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_employee_role'
  ) THEN
    EXECUTE $func$
      CREATE FUNCTION public.current_employee_role()
      RETURNS TEXT
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $inner$
        SELECT r.name
        FROM public.employees e
        JOIN public.roles r ON r.id = e.role_id
        WHERE e.auth_user_id = auth.uid()
           OR e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
        ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
        LIMIT 1
      $inner$
    $func$;
    GRANT EXECUTE ON FUNCTION public.current_employee_role() TO authenticated, anon;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 2. Ensure RLS is enabled on all three RBAC tables
-- ────────────────────────────────────────────────────────────

ALTER TABLE roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 3. Revoke all anon access (belt-and-suspenders on top of
--    the REVOKE statements in 20260424200000)
-- ────────────────────────────────────────────────────────────

REVOKE ALL ON roles            FROM anon;
REVOKE ALL ON permissions      FROM anon;
REVOKE ALL ON role_permissions FROM anon;


-- ────────────────────────────────────────────────────────────
-- 4. roles table policies
--    SELECT  : any authenticated user (needed for role dropdowns)
--    INSERT/UPDATE/DELETE : super_admin only
-- ────────────────────────────────────────────────────────────

-- Remove any previously created blanket policies that would
-- allow all authenticated users to write
DROP POLICY IF EXISTS anon_roles                     ON roles;
DROP POLICY IF EXISTS auth_roles                     ON roles;
DROP POLICY IF EXISTS roles_select_authenticated     ON roles;
DROP POLICY IF EXISTS roles_write_superadmin         ON roles;
DROP POLICY IF EXISTS restrict_anon_roles            ON roles;

CREATE POLICY roles_select_authenticated ON roles
  FOR SELECT TO authenticated
  USING (true);

-- super_admin-only writes
CREATE POLICY roles_write_superadmin ON roles
  FOR ALL TO authenticated
  USING (
    current_employee_role() = 'super_admin'
  )
  WITH CHECK (
    current_employee_role() = 'super_admin'
  );


-- ────────────────────────────────────────────────────────────
-- 5. permissions table policies
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_permissions                  ON permissions;
DROP POLICY IF EXISTS auth_permissions                  ON permissions;
DROP POLICY IF EXISTS permissions_select_authenticated  ON permissions;
DROP POLICY IF EXISTS permissions_write_superadmin      ON permissions;
DROP POLICY IF EXISTS restrict_anon_permissions         ON permissions;

CREATE POLICY permissions_select_authenticated ON permissions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY permissions_write_superadmin ON permissions
  FOR ALL TO authenticated
  USING (
    current_employee_role() = 'super_admin'
  )
  WITH CHECK (
    current_employee_role() = 'super_admin'
  );


-- ────────────────────────────────────────────────────────────
-- 6. role_permissions table policies
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_role_permissions                  ON role_permissions;
DROP POLICY IF EXISTS auth_role_permissions                  ON role_permissions;
DROP POLICY IF EXISTS role_permissions_select_authenticated  ON role_permissions;
DROP POLICY IF EXISTS role_permissions_write_superadmin      ON role_permissions;
DROP POLICY IF EXISTS restrict_anon_role_permissions         ON role_permissions;

CREATE POLICY role_permissions_select_authenticated ON role_permissions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY role_permissions_write_superadmin ON role_permissions
  FOR ALL TO authenticated
  USING (
    current_employee_role() = 'super_admin'
  )
  WITH CHECK (
    current_employee_role() = 'super_admin'
  );


-- ────────────────────────────────────────────────────────────
-- 7. Ensure authenticated has table-level privileges so the RLS
--    policies above can fire (Postgres requires the privilege
--    gate to pass before RLS is evaluated; non-super_admin users
--    are then blocked by the USING clause, not by privilege denial)
-- ────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON roles            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON permissions      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO authenticated;

COMMIT;
