-- ════════════════════════════════════════════════════════════════════════════
-- Fix: Consolidate employees SELECT policies into one authoritative rule.
--
-- Root cause (both migrations are in the same commit):
--   20260702000000 created employees_select_same_org (store-scoped: manager /
--   store_staff see own store only, office_staff sees full org).
--   20260702100000 then created employees_org_sel via org_visible(), which
--   returns TRUE for any same-org user regardless of role.
--   Because PostgreSQL ORs permissive policies, employees_org_sel overrides the
--   store-scoped restriction — store_staff can still see all same-org employees.
--
--   Additionally, 20260702100000 dropped employees_select (from 20260429000011),
--   which was the only policy covering is_admin(). Admin access now relies solely
--   on employees_org_sel — so we can't simply remove it without also adding admin
--   coverage to the store-scoped policy.
--
-- Fix:
--   Drop both conflicting policies. Replace with a single consolidated policy
--   that correctly handles every role including admin and self-access.
--
-- Final SELECT rule per actor:
--   service_role  → unrestricted (backend RPCs, edge functions)
--   is_admin()    → full org (admin / super_admin)
--   self          → own row always visible (safety net for NULL store_id edge cases)
--   office_staff  → full org (HR operations: approvals, form JOINs, personnel actions)
--   manager       → own store only
--   store_staff   → own store only
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop both conflicting policies from prior migrations
DROP POLICY IF EXISTS employees_select_same_org ON public.employees;
DROP POLICY IF EXISTS employees_org_sel          ON public.employees;

-- Single consolidated SELECT policy
CREATE POLICY employees_select_v3 ON public.employees
FOR SELECT TO authenticated
USING (
  -- ① Backend RPCs and Edge Functions: unrestricted
  auth.role() = 'service_role'

  -- ② admin / super_admin: full org visibility
  OR public.is_admin()

  -- ③ Self: always see own row (handles NULL store_id edge cases)
  OR auth_user_id = auth.uid()

  -- ④ office_staff: full org (HR approvals, form lookups, personnel actions)
  OR (
    public.current_employee_role() = 'office_staff'
    AND organization_id = public.current_user_org_id()
  )

  -- ⑤ manager: own store only
  OR (
    public.current_employee_role() = 'manager'
    AND store_id = public.current_user_store_id()
  )

  -- ⑥ store_staff: own store only (prevents cross-store employee enumeration)
  OR (
    public.current_employee_role() = 'store_staff'
    AND store_id = public.current_user_store_id()
  )
);

COMMENT ON POLICY employees_select_v3 ON public.employees IS
  'v3 2026-07-02 consolidated: service_role unrestricted; admin full org; '
  'self always visible; office_staff full org; manager/store_staff own store only.';

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- Verify after applying:
--
-- SELECT tablename, policyname, cmd, qual
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'employees'
--    AND cmd = 'SELECT'
--  ORDER BY policyname;
--
-- Expected: ONLY employees_select_v3 for SELECT
--           (employees_select_same_org and employees_org_sel should be gone).
--
-- Smoke test per role (run as each user):
--   SELECT count(*) FROM employees;
--   -- store_staff: should see only own-store employees + self
--   -- manager:     should see only own-store employees + self
--   -- office_staff: should see all same-org employees
--   -- admin/super_admin: should see all same-org employees
-- ════════════════════════════════════════════════════════════════════════════
