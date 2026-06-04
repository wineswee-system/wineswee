-- ============================================================
-- Add organization_id to payroll_records
--
-- Root cause: payroll_records was missing from the phase1_2
-- org_id_completion migration's scoped lists, so send-payslips
-- and any future org-scoped payroll queries had no column to
-- filter on.
--
-- Backfill: inherit from employees via employee_id FK.
-- ============================================================

BEGIN;

ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Backfill from employees
UPDATE public.payroll_records pr
SET    organization_id = e.organization_id
FROM   public.employees e
WHERE  pr.employee_id = e.id
  AND  pr.organization_id IS NULL
  AND  e.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_records_org
  ON public.payroll_records(organization_id);

CREATE INDEX IF NOT EXISTS idx_payroll_records_org_period
  ON public.payroll_records(organization_id, pay_period);

COMMIT;
