-- ============================================================
-- RLS Security Fixes — 2026-05-01
--
-- Fixes three issues left after the phase 1.3 org-scope refactor:
--
-- 1. Drop blanket auth_read_* SELECT policies that phase 1.3 section 5
--    added to tables without organization_id. These coexist (with OR
--    semantics) with the restrictive policies from security_hardening
--    (payroll: self-or-admin; LINE: admin-only), making them ineffective.
--
-- 2. Tighten current_employee_role() to scope the role lookup to the
--    caller's own organization, so an admin in org A cannot pass an
--    admin check when accessing org B data via the OR bypass path.
--
-- 3. Add an auth.users INSERT trigger that auto-links a new Supabase
--    auth user to their employee record on sign-up (by email match).
--    Fixes the gap noted in 20260420020100: employees with NULL
--    auth_user_id return NULL from current_employee_org(), blocking
--    all RLS-protected reads until an admin manually stamps the UUID.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Drop blanket auth_read_* policies on sensitive tables
-- ─────────────────────────────────────────────────────────────

-- Payroll — security_hardening created self-or-admin / admin-only policies;
-- phase 1.3 section 5 added these blanket reads which OR them into always-true.
DROP POLICY IF EXISTS "auth_read_payroll_records"   ON public.payroll_records;
DROP POLICY IF EXISTS "auth_read_payroll_runs"      ON public.payroll_runs;
DROP POLICY IF EXISTS "auth_read_salary_structures" ON public.salary_structures;
DROP POLICY IF EXISTS "auth_read_leave_balances"    ON public.leave_balances;

-- LINE — security_hardening created admin-only SELECT policies;
-- same OR-override problem applies.
DROP POLICY IF EXISTS "auth_read_line_groups"        ON public.line_groups;
DROP POLICY IF EXISTS "auth_read_line_group_members" ON public.line_group_members;
DROP POLICY IF EXISTS "auth_read_line_messages"      ON public.line_messages;
DROP POLICY IF EXISTS "auth_read_line_command_logs"  ON public.line_command_logs;
DROP POLICY IF EXISTS "auth_read_line_error_logs"    ON public.line_error_logs;

-- ─────────────────────────────────────────────────────────────
-- 2. Tighten current_employee_role() to be org-scoped
--
--    Before: returned role for whichever employee row matched
--            auth_uid first, regardless of organization.
--    After:  role lookup is AND-filtered by current_employee_org()
--            so an admin in org A cannot pass role checks for org B.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.employees
  WHERE (auth_user_id = auth.uid()
         OR email = (SELECT email FROM auth.users WHERE id = auth.uid()))
    AND organization_id = public.current_employee_org()
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. Auto-link auth.users → employees on sign-up
--
--    On every new auth.users row, find the matching employee by
--    email and stamp auth_user_id. Ensures current_employee_org()
--    resolves correctly from first login without a manual admin step.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.employees
  SET auth_user_id = NEW.id
  WHERE email = NEW.email
    AND auth_user_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

NOTIFY pgrst, 'reload schema';

COMMIT;
