-- ════════════════════════════════════════════════════════════════════════════
-- RLS performance: evaluate helper functions once per statement, not per row
-- 2026-07-02
--
-- Problem: STABLE SECURITY DEFINER helpers (current_employee_role(),
--   current_user_org_id(), current_user_store_id(), current_employee_id(),
--   current_employee_org(), is_admin(), ...) are called BARE inside policy
--   USING/WITH CHECK clauses, so PostgreSQL re-executes them for EVERY ROW.
--   Wrapping each call as (SELECT func()) turns it into an InitPlan that runs
--   once per statement.
--
-- What this migration does:
--   1. Rewrites the identity helpers so each is a SINGLE query on employees
--      (no helper-calls-helper nesting; current_employee_role previously
--      chained through other helpers in some historical versions). The email
--      fallback is KEPT (employees not yet linked via auth_user_id would
--      otherwise be locked out) but tightened to rows whose auth_user_id IS
--      NULL — a row already linked to another auth user can no longer be
--      matched by email. Also rewrites current_user_org() (used by
--      org_visible()/set_org_default()) which nested current_employee_id().
--   2. employees SELECT → consolidated employees_select_v4 (same logic as v3
--      from 20260702300000, every helper wrapped). Drops ALL earlier employees
--      SELECT policies, including the org_scope_*_employees leftovers from
--      20260420010200 that no later migration removed — their SELECT arm
--      silently re-opened org-wide reads (defeating store scoping) and their
--      INSERT/UPDATE/DELETE arms let any same-org user write employees
--      (permissive policies OR together).
--   3. Rewrites every remaining org_scope_* policy IN PLACE. Driven by
--      pg_policies, so policies that later migrations dropped are NOT
--      resurrected, and each policy keeps its exact qual / with_check /
--      roles / cmd — only helper calls get wrapped. This preserves special
--      shapes like org_scope_delete_workflow_instances / org_scope_delete_tasks
--      ("organization_id IS NULL OR ..." from 20260501000002) exactly.
--   4. Rebuilds the attendance_records / salary_records policy sets (same
--      final semantics as 20260702100000, wrapped). Drop-all-and-rebuild, so
--      the catch-all fix lands whether or not the untracked 20260702100000
--      was applied. can_see_request(employee_id) stays bare — it takes a row
--      column and cannot be hoisted; its body (20260618210000) already
--      computes the caller's identity once into local variables at function
--      start, so no function-body change is needed.
--   5. Re-wraps payroll_records / payroll_runs / salary_structures /
--      leave_balances policies from 20260418000005 (+ leave_bal_select from
--      20260511110000) — only where they still exist under those names.
--
-- Idempotent. Safe whether or not the untracked 20260702300000 /
-- 20260702400000 migrations have been applied.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper functions: single-query bodies, no nested helper calls.
--    Signatures, STABLE, SECURITY DEFINER, search_path and return semantics
--    preserved (current_employee_role keeps COALESCE(roles.name,
--    employees.role) from 20260508000001). ACLs preserved by CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
     OR (e.auth_user_id IS NULL
         AND e.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
  ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(r.name, e.role)
  FROM public.employees e
  LEFT JOIN public.roles r ON r.id = e.role_id
  WHERE e.auth_user_id = auth.uid()
     OR (e.auth_user_id IS NULL
         AND e.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
  ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_employee_org()
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.organization_id
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
     OR (e.auth_user_id IS NULL
         AND e.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
  ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.organization_id
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
     OR (e.auth_user_id IS NULL
         AND e.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
  ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_user_store_id()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.store_id
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
     OR (e.auth_user_id IS NULL
         AND e.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
  ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

-- current_user_org() (20260618100000) previously did
--   SELECT organization_id FROM employees WHERE id = current_employee_id()
-- i.e. one helper nested in another → two queries per invocation.
-- Same return semantics, single query.
CREATE OR REPLACE FUNCTION public.current_user_org()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.organization_id::bigint
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
     OR (e.auth_user_id IS NULL
         AND e.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
  ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. employees SELECT → employees_select_v4 (v3 logic, all helpers wrapped).
--    Drop every historical employees SELECT policy so the final state is
--    deterministic regardless of which prior migrations ran, and remove the
--    org_scope_*_employees leftovers (see header). Intended write access
--    remains via the dedicated employees write policies
--    (employees_write_admin / employees_self_update, untouched here).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS employees_select_v4        ON public.employees;
DROP POLICY IF EXISTS employees_select_v3        ON public.employees;
DROP POLICY IF EXISTS employees_select_same_org  ON public.employees;
DROP POLICY IF EXISTS employees_org_sel          ON public.employees;
DROP POLICY IF EXISTS auth_employees             ON public.employees;
DROP POLICY IF EXISTS employees_select           ON public.employees;
DROP POLICY IF EXISTS org_scope_select_employees ON public.employees;
DROP POLICY IF EXISTS org_scope_insert_employees ON public.employees;
DROP POLICY IF EXISTS org_scope_modify_employees ON public.employees;
DROP POLICY IF EXISTS org_scope_delete_employees ON public.employees;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY employees_select_v4 ON public.employees
FOR SELECT TO authenticated
USING (
  -- ① Backend RPCs and Edge Functions: unrestricted
  (SELECT auth.role()) = 'service_role'

  -- ② admin / super_admin: full org visibility
  OR (SELECT public.is_admin())

  -- ③ Self: always see own row (handles NULL store_id edge cases)
  OR auth_user_id = (SELECT auth.uid())

  -- ④ office_staff: full org (HR approvals, form lookups, personnel actions)
  OR (
    (SELECT public.current_employee_role()) = 'office_staff'
    AND organization_id = (SELECT public.current_user_org_id())
  )

  -- ⑤ manager: own store only
  OR (
    (SELECT public.current_employee_role()) = 'manager'
    AND store_id = (SELECT public.current_user_store_id())
  )

  -- ⑥ store_staff: own store only (prevents cross-store employee enumeration)
  OR (
    (SELECT public.current_employee_role()) = 'store_staff'
    AND store_id = (SELECT public.current_user_store_id())
  )
);

COMMENT ON POLICY employees_select_v4 ON public.employees IS
  'v4 2026-07-02: v3 semantics with every helper call wrapped in (SELECT ...) '
  'for once-per-statement evaluation. service_role unrestricted; admin full org; '
  'self always visible; office_staff full org; manager/store_staff own store only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Rewrite remaining org_scope_* policies in place, wrapping helper calls.
--    pg_policies-driven: only policies that STILL EXIST are touched (nothing
--    dropped by later migrations gets resurrected) and each keeps its exact
--    deparsed qual/with_check — the wrapper only rewrites
--    fn() / public.fn() → (SELECT fn()) / (SELECT public.fn()).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._wrap_rls_helpers_tmp600(p_expr text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $fn$
DECLARE
  v text := p_expr;
  f text;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  FOREACH f IN ARRAY ARRAY[
    'current_employee_org','current_employee_role','current_employee_id',
    'current_employee_name','current_user_org_id','current_user_store_id',
    'current_user_org','is_admin','is_staff','is_hr_staff'
  ] LOOP
    -- Note: an occurrence that is already wrapped just gains a harmless
    -- nested scalar subquery — still evaluated once per statement.
    v := regexp_replace(v, '((?:public\.)?' || f || '\(\))', '(SELECT \1)', 'g');
  END LOOP;
  v := regexp_replace(v, '(auth\.uid\(\))',  '(SELECT \1)', 'g');
  v := regexp_replace(v, '(auth\.role\(\))', '(SELECT \1)', 'g');
  RETURN v;
END
$fn$;

DO $mig$
DECLARE
  pol record;
  v_roles text;
  v_qual  text;
  v_check text;
  v_stmt  text;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'org\_scope\_%' ESCAPE '\'
      AND tablename <> 'employees'   -- employees org_scope_* dropped in section 2
  LOOP
    BEGIN
      v_qual  := public._wrap_rls_helpers_tmp600(pol.qual);
      v_check := public._wrap_rls_helpers_tmp600(pol.with_check);
      SELECT string_agg(quote_ident(r), ', ') INTO v_roles FROM unnest(pol.roles) AS r;

      v_stmt := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                       pol.policyname, pol.schemaname, pol.tablename,
                       pol.permissive, pol.cmd, v_roles);
      IF v_qual  IS NOT NULL THEN v_stmt := v_stmt || format(' USING (%s)', v_qual); END IF;
      IF v_check IS NOT NULL THEN v_stmt := v_stmt || format(' WITH CHECK (%s)', v_check); END IF;

      EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
      EXECUTE v_stmt;
    EXCEPTION WHEN OTHERS THEN
      -- plpgsql sub-block = savepoint: on failure the DROP rolls back and the
      -- original policy survives untouched.
      RAISE WARNING 'org_scope wrap skipped for %.% (%): %',
        pol.tablename, pol.policyname, pol.cmd, SQLERRM;
    END;
  END LOOP;
END
$mig$;

DROP FUNCTION IF EXISTS public._wrap_rls_helpers_tmp600(text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. attendance_records / salary_records: rebuild full policy sets with
--    wrapped row-independent helpers (final semantics identical to
--    20260702100000). Also re-drop the auth_leave_balances catch-all.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._drop_all_policies_tmp600(p_tbl text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = p_tbl LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p_tbl);
  END LOOP;
END $fn$;

DO $mig$ BEGIN
  IF to_regclass('public.attendance_records') IS NOT NULL THEN
    PERFORM public._drop_all_policies_tmp600('attendance_records');
    ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

    -- SELECT: service_role / self / supervisor chain / store manager / HR / admin
    CREATE POLICY attendance_vsel ON public.attendance_records
      FOR SELECT USING (
        (SELECT auth.role()) = 'service_role'
        OR public.can_see_request(employee_id)   -- row column arg: stays per-row
      );

    -- INSERT: open to staff (edge-function clock-in/out; manager corrections)
    CREATE POLICY attendance_ins ON public.attendance_records
      FOR INSERT WITH CHECK (
        (SELECT auth.role()) = 'service_role' OR (SELECT public.is_staff())
      );

    CREATE POLICY attendance_upd ON public.attendance_records
      FOR UPDATE USING (
        (SELECT auth.role()) = 'service_role'
        OR public.can_see_request(employee_id)
      ) WITH CHECK (true);

    CREATE POLICY attendance_del ON public.attendance_records
      FOR DELETE USING (
        (SELECT public.is_admin()) OR (SELECT auth.role()) = 'service_role'
      );
  END IF;
END $mig$;

DO $mig$ BEGIN
  IF to_regclass('public.salary_records') IS NOT NULL THEN
    PERFORM public._drop_all_policies_tmp600('salary_records');
    ALTER TABLE public.salary_records ENABLE ROW LEVEL SECURITY;

    -- SELECT: can_see_request; WRITES: admin-only (salary is confidential)
    CREATE POLICY salary_vsel ON public.salary_records
      FOR SELECT USING (
        (SELECT auth.role()) = 'service_role'
        OR public.can_see_request(employee_id)   -- row column arg: stays per-row
      );

    CREATE POLICY salary_ins ON public.salary_records
      FOR INSERT WITH CHECK (
        (SELECT public.is_admin()) OR (SELECT auth.role()) = 'service_role'
      );

    CREATE POLICY salary_upd ON public.salary_records
      FOR UPDATE USING (
        (SELECT public.is_admin()) OR (SELECT auth.role()) = 'service_role'
      ) WITH CHECK (
        (SELECT public.is_admin()) OR (SELECT auth.role()) = 'service_role'
      );

    CREATE POLICY salary_del ON public.salary_records
      FOR DELETE USING (
        (SELECT public.is_admin()) OR (SELECT auth.role()) = 'service_role'
      );
  END IF;
END $mig$;

-- precautionary (mirrors 20260702100000 §4): the USING(true) catch-all must
-- not OR itself back over leave_bal_select / leave_balances_self_or_admin
DROP POLICY IF EXISTS auth_leave_balances ON public.leave_balances;

DROP FUNCTION IF EXISTS public._drop_all_policies_tmp600(text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 20260418000005 payroll/salary/leave policies (+ leave_bal_select from
--    20260511110000): recreate wrapped — only where the policy still exists
--    under that exact name (later migrations may have replaced them).
-- ─────────────────────────────────────────────────────────────────────────────

DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='payroll_records' AND policyname='payroll_records_self_or_admin') THEN
    DROP POLICY payroll_records_self_or_admin ON public.payroll_records;
    CREATE POLICY payroll_records_self_or_admin ON public.payroll_records
      FOR SELECT TO authenticated
      USING (
        employee_id = (SELECT public.current_employee_id())
        OR (SELECT public.current_employee_role()) IN ('admin', 'super_admin')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='payroll_records' AND policyname='payroll_records_admin_write') THEN
    DROP POLICY payroll_records_admin_write ON public.payroll_records;
    CREATE POLICY payroll_records_admin_write ON public.payroll_records
      FOR ALL TO authenticated
      USING ((SELECT public.current_employee_role()) IN ('admin', 'super_admin'))
      WITH CHECK ((SELECT public.current_employee_role()) IN ('admin', 'super_admin'));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='payroll_runs' AND policyname='payroll_runs_admin') THEN
    DROP POLICY payroll_runs_admin ON public.payroll_runs;
    CREATE POLICY payroll_runs_admin ON public.payroll_runs
      FOR ALL TO authenticated
      USING ((SELECT public.current_employee_role()) IN ('admin', 'super_admin'))
      WITH CHECK ((SELECT public.current_employee_role()) IN ('admin', 'super_admin'));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='salary_structures' AND policyname='salary_structures_self_or_admin') THEN
    DROP POLICY salary_structures_self_or_admin ON public.salary_structures;
    CREATE POLICY salary_structures_self_or_admin ON public.salary_structures
      FOR SELECT TO authenticated
      USING (
        employee_id = (SELECT public.current_employee_id())
        OR (SELECT public.current_employee_role()) IN ('admin', 'super_admin')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='salary_structures' AND policyname='salary_structures_admin_write') THEN
    DROP POLICY salary_structures_admin_write ON public.salary_structures;
    CREATE POLICY salary_structures_admin_write ON public.salary_structures
      FOR ALL TO authenticated
      USING ((SELECT public.current_employee_role()) IN ('admin', 'super_admin'))
      WITH CHECK ((SELECT public.current_employee_role()) IN ('admin', 'super_admin'));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='leave_balances' AND policyname='leave_balances_self_or_admin') THEN
    DROP POLICY leave_balances_self_or_admin ON public.leave_balances;
    CREATE POLICY leave_balances_self_or_admin ON public.leave_balances
      FOR SELECT TO authenticated
      USING (
        employee_id = (SELECT public.current_employee_id())
        OR (SELECT public.current_employee_role()) IN ('admin', 'super_admin', 'manager')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='leave_balances' AND policyname='leave_balances_admin_write') THEN
    DROP POLICY leave_balances_admin_write ON public.leave_balances;
    CREATE POLICY leave_balances_admin_write ON public.leave_balances
      FOR ALL TO authenticated
      USING ((SELECT public.current_employee_role()) IN ('admin', 'super_admin'))
      WITH CHECK ((SELECT public.current_employee_role()) IN ('admin', 'super_admin'));
  END IF;

  -- leave_bal_select (20260511110000) — original had no TO clause (public)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='leave_balances' AND policyname='leave_bal_select') THEN
    DROP POLICY leave_bal_select ON public.leave_balances;
    CREATE POLICY leave_bal_select ON public.leave_balances
      FOR SELECT
      USING (
        (SELECT public.is_admin())
        OR employee_id = (SELECT public.current_employee_id())
      );
  END IF;
END $mig$;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- Verify after applying:
--
-- SELECT tablename, policyname, cmd, qual FROM pg_policies
--  WHERE schemaname='public' AND tablename='employees' AND cmd='SELECT';
--   → ONLY employees_select_v4 (all helpers inside "(SELECT ...)").
--
-- SELECT count(*) FROM pg_policies
--  WHERE schemaname='public' AND policyname LIKE 'org\_scope\_%' ESCAPE '\'
--    AND (qual NOT LIKE '%SELECT%' AND COALESCE(with_check,'x') NOT LIKE '%SELECT%');
--   → 0 (every remaining org_scope_* policy is wrapped).
--
-- EXPLAIN ANALYZE SELECT count(*) FROM employees;  -- as a store_staff user:
--   helper functions should appear as InitPlans, not per-row filters.
-- ════════════════════════════════════════════════════════════════════════════
