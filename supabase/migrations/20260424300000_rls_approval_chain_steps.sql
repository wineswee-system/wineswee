-- ============================================================
-- Security fix: RLS for approval_chain_steps + tighten
--               approval_chains SELECT (was USING (true))
--
-- Gap identified: approval_chain_steps was created in
-- 20260420010500_phase2_3_relational_approval.sql with NO RLS
-- enabled and NO policies, allowing any authenticated user to
-- read every tenant's approval chain step configuration.
--
-- Simultaneously, approval_chains SELECT policy
-- "approval_chains_read" (set in 20260418000005_security_hardening)
-- was USING (true) — also a cross-tenant leak for the parent table.
--
-- Both are corrected here under the same org-isolation predicate.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. approval_chain_steps — enable RLS + org-isolation policy
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.approval_chain_steps ENABLE ROW LEVEL SECURITY;

-- FOR ALL covers SELECT / INSERT / UPDATE / DELETE in one policy.
-- USING controls which existing rows are visible/modifiable.
-- WITH CHECK controls which new/modified rows are allowed.
--
-- A step is accessible when its parent chain belongs to the
-- caller's organization, OR the caller is admin / super_admin.

DROP POLICY IF EXISTS "acs_org_isolation" ON public.approval_chain_steps;

CREATE POLICY "acs_org_isolation"
  ON public.approval_chain_steps
  FOR ALL
  TO authenticated
  USING (
    current_employee_role() IN ('admin', 'super_admin')
    OR EXISTS (
      SELECT 1
      FROM public.approval_chains ac
      WHERE ac.id = approval_chain_steps.chain_id
        AND ac.organization_id = public.current_employee_org()
    )
  )
  WITH CHECK (
    current_employee_role() IN ('admin', 'super_admin')
    OR EXISTS (
      SELECT 1
      FROM public.approval_chains ac
      WHERE ac.id = approval_chain_steps.chain_id
        AND ac.organization_id = public.current_employee_org()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 2. approval_chains SELECT — replace USING (true) with
--    org-scoped predicate (parent table, same isolation rule)
-- ─────────────────────────────────────────────────────────────

-- Drop the permissive open-read policy set in security_hardening.
DROP POLICY IF EXISTS "approval_chains_read" ON public.approval_chains;

-- Tighter SELECT: caller sees chains belonging to their org,
-- or all chains if they are admin / super_admin.
CREATE POLICY "approval_chains_read"
  ON public.approval_chains
  FOR SELECT
  TO authenticated
  USING (
    current_employee_role() IN ('admin', 'super_admin')
    OR organization_id = public.current_employee_org()
  );

-- The write policy "approval_chains_admin_write" (FOR ALL,
-- USING admin-only) introduced in the same security_hardening
-- migration is already correct; no change needed.

COMMIT;
