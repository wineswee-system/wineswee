-- Fix: workflow_instances and tasks DELETE was blocked by org-scoped RLS
-- from phase1_3_org_scoped_rls. If current_employee_org() returns NULL
-- (email not found in employees), the USING clause evaluates to NULL (not TRUE)
-- and silently deletes 0 rows — UI updates but data survives on reload.
--
-- Fix: replace DELETE policy to also permit org_id IS NULL records
-- and any authenticated user whose org matches or has admin/super_admin role.

-- workflow_instances
DROP POLICY IF EXISTS org_scope_delete_workflow_instances ON public.workflow_instances;
CREATE POLICY org_scope_delete_workflow_instances ON public.workflow_instances
  FOR DELETE TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- tasks
DROP POLICY IF EXISTS org_scope_delete_tasks ON public.tasks;
CREATE POLICY org_scope_delete_tasks ON public.tasks
  FOR DELETE TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
