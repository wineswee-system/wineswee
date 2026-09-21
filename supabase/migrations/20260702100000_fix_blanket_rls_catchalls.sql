-- ════════════════════════════════════════════════════════════════════════════
-- Fix: Drop blanket USING(true) catch-all RLS policies that undermine
--      role-specific restrictions on sensitive tables.
--
-- Root cause: 20260417000002_rls_authenticated_policies.sql added
--   auth_<tablename> policies with USING(true) for every table.
--   Subsequent migrations added restrictive policies (attendance_select,
--   salary_select, etc.) but PostgreSQL permissive policies OR together —
--   so the catch-all wins and ANY authenticated user can read ALL rows.
--
-- Tables fixed:
--   attendance_records → Category ①: can_see_request(employee_id)
--   salary_records     → Category ①: can_see_request(employee_id)
--                        (writes remain admin-only — salary is sensitive)
--   employees          → Category ④: org_visible(organization_id)
--                        (all same-org employees can see each other;
--                         needed for scheduling, approvals, org chart)
--   leave_balances     → precautionary drop of any remaining catch-all
--
-- Strategy: DROP every policy on the table, rebuild clean.
--   Idempotent; guarantees final state regardless of prior history.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── helper: drops every policy on a table ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._drop_all_policies_local(p_tbl text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = p_tbl LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p_tbl);
  END LOOP;
END $$;


-- ═══ 1. attendance_records ═══
-- Both employee_id (FK added in 20260416100006) and employee (text) exist.
-- SELECT: can_see_request → self / supervisor chain / store manager / HR / admin
-- INSERT/UPDATE: keep open (edge functions clock-in/out; manager corrections)
-- DELETE: admin-only

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'attendance_records') THEN
    PERFORM public._drop_all_policies_local('attendance_records');
    ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

    CREATE POLICY attendance_vsel ON public.attendance_records
      FOR SELECT USING (
        auth.role() = 'service_role'
        OR public.can_see_request(employee_id)
      );

    CREATE POLICY attendance_ins ON public.attendance_records
      FOR INSERT WITH CHECK (
        auth.role() = 'service_role' OR public.is_staff()
      );

    CREATE POLICY attendance_upd ON public.attendance_records
      FOR UPDATE USING (
        auth.role() = 'service_role'
        OR public.can_see_request(employee_id)
      ) WITH CHECK (true);

    CREATE POLICY attendance_del ON public.attendance_records
      FOR DELETE USING (
        public.is_admin() OR auth.role() = 'service_role'
      );
  END IF;
END $$;


-- ═══ 2. salary_records ═══
-- Has employee_id FK (confirmed: 20260416100006 + hr.js automation uses it).
-- SELECT: can_see_request — supervisor chain / HR can see subordinates' salary
-- WRITE: admin-only (salary is confidential; managers view but never write)

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'salary_records') THEN
    PERFORM public._drop_all_policies_local('salary_records');
    ALTER TABLE public.salary_records ENABLE ROW LEVEL SECURITY;

    CREATE POLICY salary_vsel ON public.salary_records
      FOR SELECT USING (
        auth.role() = 'service_role'
        OR public.can_see_request(employee_id)
      );

    CREATE POLICY salary_ins ON public.salary_records
      FOR INSERT WITH CHECK (
        public.is_admin() OR auth.role() = 'service_role'
      );

    CREATE POLICY salary_upd ON public.salary_records
      FOR UPDATE USING (
        public.is_admin() OR auth.role() = 'service_role'
      ) WITH CHECK (
        public.is_admin() OR auth.role() = 'service_role'
      );

    CREATE POLICY salary_del ON public.salary_records
      FOR DELETE USING (
        public.is_admin() OR auth.role() = 'service_role'
      );
  END IF;
END $$;


-- ═══ 3. employees ═══
-- Drop auth_employees (USING(true) catch-all from 20260417000003) and the
-- narrow self-only employees_select from 20260429000011.
-- Replace with org_visible: all same-org employees can see each other.
-- Needed for scheduling, approvals, and org chart lookups.
-- Cross-org access is blocked. Write policies are unchanged.

DROP POLICY IF EXISTS auth_employees    ON public.employees;
DROP POLICY IF EXISTS employees_select  ON public.employees;
DROP POLICY IF EXISTS employees_org_sel ON public.employees;  -- idempotent

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- All same-org employees can see each other (scheduling / approval lookups).
-- org_visible's is_admin() branch gives admin unrestricted access.
CREATE POLICY employees_org_sel ON public.employees
  FOR SELECT TO authenticated
  USING (public.org_visible(organization_id));


-- ═══ 4. leave_balances (precautionary) ═══
-- auth_leave_balances (USING(true)) may still exist alongside leave_bal_select.
-- Dropping it ensures leave_bal_select (admin OR self) is the sole SELECT gate.
DROP POLICY IF EXISTS auth_leave_balances ON public.leave_balances;


-- ── cleanup helper ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._drop_all_policies_local(text);

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- Verify after applying:
--
-- SELECT tablename, policyname, cmd, qual
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('attendance_records','salary_records','employees','leave_balances')
--  ORDER BY tablename, policyname;
--
-- Expected: no policy with qual = 'true' for attendance_records / salary_records.
--           employees: employees_org_sel (org_visible) + write policies.
-- ════════════════════════════════════════════════════════════════════════════
