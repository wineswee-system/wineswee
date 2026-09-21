-- Performance indexes for web_list_my_pending_approval_ids
-- All subqueries filter on (organization_id, status) but only single-column indexes existed.
-- Name-based employee lookups in business_trips/clock_corrections/expenses lacked a composite index.

BEGIN;

-- ── HR request tables: composite (org, status) for the main WHERE filter ──────

CREATE INDEX IF NOT EXISTS idx_leave_requests_org_status
  ON public.leave_requests(organization_id, status)
  WHERE status = '待審核';

CREATE INDEX IF NOT EXISTS idx_overtime_requests_org_status
  ON public.overtime_requests(organization_id, status)
  WHERE status = '待審核';

CREATE INDEX IF NOT EXISTS idx_business_trips_org_status
  ON public.business_trips(organization_id, status)
  WHERE status = '待審核';

CREATE INDEX IF NOT EXISTS idx_clock_corrections_org_status
  ON public.clock_corrections(organization_id, status)
  WHERE status = '待審核';

CREATE INDEX IF NOT EXISTS idx_expenses_org_status
  ON public.expenses(organization_id, status)
  WHERE status = '待審核';

CREATE INDEX IF NOT EXISTS idx_expense_requests_org_status
  ON public.expense_requests(organization_id, status)
  WHERE status = '待審核';

-- ── approval_chain_id on tables that were missing it ─────────────────────────
-- Used in LEFT JOIN approval_chain_steps cs ON cs.chain_id = t.approval_chain_id

CREATE INDEX IF NOT EXISTS idx_leave_requests_chain
  ON public.leave_requests(approval_chain_id) WHERE approval_chain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_overtime_requests_chain
  ON public.overtime_requests(approval_chain_id) WHERE approval_chain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_trips_chain
  ON public.business_trips(approval_chain_id) WHERE approval_chain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clock_corrections_chain
  ON public.clock_corrections(approval_chain_id) WHERE approval_chain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_chain
  ON public.expenses(approval_chain_id) WHERE approval_chain_id IS NOT NULL;

-- ── employees(organization_id, name): used in name-based LATERAL joins ────────
-- business_trips, clock_corrections, expenses join employees WHERE name = t.employee

CREATE INDEX IF NOT EXISTS idx_employees_name_org
  ON public.employees(organization_id, name);

COMMIT;
