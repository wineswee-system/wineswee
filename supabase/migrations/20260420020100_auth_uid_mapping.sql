-- ============================================================
-- Auth mapping via auth.users.id (UUID), not email
--
-- Current state:
--   - employees.email is the only join key to auth.users
--   - 111 of 113 employees have NULL email → can't be RLS-mapped
--   - Email change in auth would silently break their data access
--
-- New design:
--   - Add employees.auth_user_id UUID REFERENCES auth.users(id)
--   - Backfill via existing email matches (only the 2 real users)
--   - Helper functions prefer auth_user_id; fall back to email so
--     email-mapped users still work during transition
--
-- After this migration, new sign-ups need an admin step:
--   UPDATE employees SET auth_user_id = '<auth-uid>' WHERE id = <emp-id>
-- (or build an "invite + auto-link" flow in the app)
--
-- Risk: LOW for read paths. The fallback preserves current behavior.
-- ============================================================

BEGIN;

-- 1. Add the column + unique index
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_auth_user_id_unique
  ON public.employees(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- 2. Backfill from existing email matches
UPDATE public.employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE e.email IS NOT NULL
  AND u.email = e.email
  AND e.auth_user_id IS NULL;

-- 3. Rewrite helpers: auth_user_id first, then email fallback.
--    Marked STABLE so the planner can reuse the result within a query.
--    SECURITY DEFINER + locked search_path (consistent with phase 020000).
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.employees
  WHERE auth_user_id = auth.uid()
     OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.employees
  WHERE auth_user_id = auth.uid()
     OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_employee_org()
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_id FROM public.employees
  WHERE auth_user_id = auth.uid()
     OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_role() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_org() TO authenticated, anon;

-- Validation: real users (those with both email + auth account) should be linked
DO $$
DECLARE
  unlinked INT;
BEGIN
  SELECT count(*) INTO unlinked
  FROM auth.users u
  WHERE EXISTS (SELECT 1 FROM public.employees e WHERE e.email = u.email)
    AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.auth_user_id = u.id);
  IF unlinked > 0 THEN
    RAISE WARNING 'auth_user_id backfill incomplete: % auth users still unlinked', unlinked;
  END IF;
END $$;

COMMIT;
