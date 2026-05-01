-- Fix: revert current_employee_role() org-scope that broke DELETE for employees
-- with organization_id = NULL.
--
-- 20260501000003 added AND organization_id = current_employee_org() to the WHERE.
-- If the employee's own organization_id is NULL, current_employee_org() returns NULL,
-- the AND clause is always false, the function returns NULL, and every RLS DELETE
-- policy that checks current_employee_role() IN ('admin','super_admin') silently
-- blocks the delete — returning no error, deleting 0 rows.
--
-- The org-scope was meant to prevent cross-org role leakage, which is not a
-- realistic threat in single-tenant deployments and is outweighed by the regression.
-- The email/auth_uid lookup already uniquely identifies the employee.

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.employees
  WHERE auth_user_id = auth.uid()
     OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1
$$;

NOTIFY pgrst, 'reload schema';
