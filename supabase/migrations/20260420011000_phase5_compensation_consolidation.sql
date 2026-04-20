-- ============================================================
-- Phase 5 — Compensation consolidation
--
-- Live state to verify before destructive action:
--   - benefit_policies (tenant_id → org_id, migrated in Phase 1.1)
--   - bonus_records, bonus_settings (tenant_id → org_id, migrated in Phase 1.1)
--   - employee_multi_store_insurance (from migration 20260409300000)
--   - salary_records (canonical monthly compensation)
--
-- Strategy:
--   1. If employee_multi_store_insurance is empty, drop it.
--   2. Add bonus_records.salary_record_id FK so monthly bonuses link to payroll.
--   3. Confirm benefit_policies has org_id (added in Phase 1.1) and add
--      a unique constraint per (organization_id, name) for clarity.
--
-- Risk: LOW for the FK addition; the table drop is conditional on emptiness.
-- ============================================================

BEGIN;

-- 1. Conditionally drop employee_multi_store_insurance if it has no rows
DO $$
DECLARE
  exists_tab BOOLEAN;
  row_count INT;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='employee_multi_store_insurance'
  ) INTO exists_tab;

  IF exists_tab THEN
    EXECUTE 'SELECT count(*) FROM public.employee_multi_store_insurance' INTO row_count;
    IF row_count = 0 THEN
      DROP TABLE public.employee_multi_store_insurance CASCADE;
      RAISE NOTICE 'Dropped empty employee_multi_store_insurance';
    ELSE
      RAISE NOTICE 'employee_multi_store_insurance has % rows; left in place', row_count;
    END IF;
  END IF;
END $$;

-- 2. Link bonus_records to salary_records (when both exist for same employee/month)
ALTER TABLE public.bonus_records
  ADD COLUMN IF NOT EXISTS salary_record_id INT
    REFERENCES public.salary_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bonus_salary_record
  ON public.bonus_records(salary_record_id);

-- Backfill: match bonus_records.employee_id + month to salary_records
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='bonus_records' AND column_name='month')
  AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='salary_records' AND column_name='month') THEN
    UPDATE public.bonus_records br
    SET salary_record_id = sr.id
    FROM public.salary_records sr
    WHERE br.employee_id = sr.employee_id
      AND br.month = sr.month
      AND br.salary_record_id IS NULL;
  END IF;
END $$;

-- 3. Unique constraint on benefit_policies (organization_id, name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'benefit_policies_org_name_unique'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='benefit_policies' AND column_name='organization_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='benefit_policies' AND column_name='name'
  ) THEN
    ALTER TABLE public.benefit_policies
      ADD CONSTRAINT benefit_policies_org_name_unique UNIQUE (organization_id, name);
  END IF;
END $$;

COMMIT;
