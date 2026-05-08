-- Fix: current_employee_role() should COALESCE roles.name (via role_id) with
-- employees.role text column. Migration 20260501000004 reverted the COALESCE
-- fix from 20260426040001 while removing org-scoping, losing the JOIN fallback.
--
-- Symptom: Organizations page shows 0 stores and 0 employees because the
-- super admin's employees.role text column is NULL (role is stored in role_id
-- only), so current_employee_role() returns NULL, failing all RLS checks.

-- 1. Fix the function: COALESCE(roles.name, employees.role) with auth_user_id lookup
CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(r.name, e.role)
  FROM public.employees e
  LEFT JOIN public.roles r ON r.id = e.role_id
  WHERE e.auth_user_id = auth.uid()
     OR e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ORDER BY (e.auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.current_employee_role() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_employee_role() FROM anon;

-- 2. Backfill employees.role text from roles.name where they diverge
UPDATE public.employees e
SET role = r.name
FROM public.roles r
WHERE e.role_id = r.id
  AND (e.role IS NULL OR e.role <> r.name);

NOTIFY pgrst, 'reload schema';
