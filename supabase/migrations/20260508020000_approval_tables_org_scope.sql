-- Add organization_id to approval_rules and approval_requests,
-- apply org-scoped RLS policies to match the rest of the schema.

-- 1. Add organization_id columns
ALTER TABLE approval_rules
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);

-- 2. Enable RLS (safe to re-run)
ALTER TABLE approval_rules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- 3. Drop old catch-all policies if any, then create org-scoped ones
DROP POLICY IF EXISTS org_scope_select_approval_rules    ON approval_rules;
DROP POLICY IF EXISTS org_scope_modify_approval_rules    ON approval_rules;
DROP POLICY IF EXISTS org_scope_insert_approval_rules    ON approval_rules;
DROP POLICY IF EXISTS org_scope_select_approval_requests ON approval_requests;
DROP POLICY IF EXISTS org_scope_modify_approval_requests ON approval_requests;
DROP POLICY IF EXISTS org_scope_insert_approval_requests ON approval_requests;

-- approval_rules
CREATE POLICY org_scope_select_approval_rules ON approval_rules
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

CREATE POLICY org_scope_modify_approval_rules ON approval_rules
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- approval_requests
CREATE POLICY org_scope_select_approval_requests ON approval_requests
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

CREATE POLICY org_scope_modify_approval_requests ON approval_requests
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );
