-- ============================================================
-- Fix: LINE-login users can't see their own employees row
--
-- Existing RLS on employees relies on email match:
--   employees.email = auth.jwt() ->> 'email'
-- For LINE-login users, employees.email is NULL while auth.users.email
-- is a synthetic 'line_<uid>@sme-ops.local' — they never match,
-- so AuthContext.loadProfile() returns null and Sidebar falls back
-- to userRole='store_staff' regardless of the row's actual role.
--
-- Fix: add auth_user_id = auth.uid() as a third OR-branch (NOT
-- replacing the email branch). Standard Supabase row-ownership pattern.
--
-- Same change applied to is_admin() so admin checks also work for
-- LINE-login users.
-- ============================================================

BEGIN;

-- ── 1. employees SELECT policy ────────────────────────────────
DROP POLICY IF EXISTS employees_select ON public.employees;

CREATE POLICY employees_select ON public.employees
FOR SELECT USING (
  is_admin()
  OR auth_user_id = auth.uid()              -- new: row owner can read self
  OR email = (auth.jwt() ->> 'email')        -- legacy: keep email match
);

-- ── 2. is_admin() also matches by auth_user_id ───────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
      JOIN roles r ON r.id = e.role_id
     WHERE (e.auth_user_id = auth.uid()
            OR e.email = auth.jwt() ->> 'email')
       AND r.name IN ('super_admin', 'admin')
  );
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
