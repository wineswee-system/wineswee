-- ============================================================
-- Phase 1.2 — Add organization_id to all tenant-data tables
--
-- Goal: every table holding org-owned data has an organization_id FK
-- so RLS in Phase 1.3 can scope by org uniformly.
--
-- Backfill strategies (in priority order):
--   1. Via store_id  → stores.organization_id
--   2. Via employee_id → employees.organization_id
--   3. Default to single existing org (id=1)
--
-- Risk: LOW. Adding nullable columns is non-blocking.
-- ============================================================

BEGIN;

DO $$
DECLARE
  default_org_id INT;
  rec RECORD;
  store_scoped TEXT[] := ARRAY[
    'attendance_records','tasks','task_attachments','task_comments',
    'task_checklists','task_dependencies','task_confirmations',
    'task_activity','task_mentions','task_watchers',
    'task_custom_field_values','task_checklist_items',
    'sop_templates','pos_shifts','pos_transactions','checklists',
    'schedule_publish_status','shift_definitions','store_events',
    'store_settings','store_staffing','store_time_slots','user_stores',
    'punch_corrections','schedules','off_requests','approval_forms',
    'approval_chains','approval_form_steps','workflow_instances',
    'workflow_steps','employee_availability','fatigue_scores',
    'scheduling_rules_snapshot','employee_schedule_prefs',
    'employee_shift_preferences','clock_corrections','expense_request_attachments'
  ];
  employee_scoped TEXT[] := ARRAY[
    'leave_requests','overtime_requests','salary_records',
    'leave_balances','leave_records','leave_entitlements',
    'leave_settlements','salary_revisions','salary_structures',
    'overtime_records','employee_dependents','employee_reviews',
    'employee_skills','employee_transfers','bonus_records',
    'business_trips','performance_goals','performance_reviews'
  ];
  tname TEXT;
BEGIN
  SELECT id INTO default_org_id FROM organizations ORDER BY id LIMIT 1;
  IF default_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found';
  END IF;

  -- store-scoped tables
  FOREACH tname IN ARRAY store_scoped LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=tname) THEN
      RAISE NOTICE 'Skipping missing table: %', tname;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id) ON DELETE SET NULL',
      tname
    );

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=tname AND column_name='store_id') THEN
      EXECUTE format($q$
        UPDATE public.%I AS t SET organization_id = s.organization_id
        FROM public.stores s
        WHERE t.store_id = s.id AND t.organization_id IS NULL AND s.organization_id IS NOT NULL
      $q$, tname);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=tname AND column_name='employee_id') THEN
      EXECUTE format($q$
        UPDATE public.%I AS t SET organization_id = e.organization_id
        FROM public.employees e
        WHERE t.employee_id = e.id AND t.organization_id IS NULL AND e.organization_id IS NOT NULL
      $q$, tname);
    END IF;

    EXECUTE format('UPDATE public.%I SET organization_id = %s WHERE organization_id IS NULL',
                   tname, default_org_id);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_org ON public.%I(organization_id)',
                   tname, tname);
  END LOOP;

  -- employee-scoped tables
  FOREACH tname IN ARRAY employee_scoped LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=tname) THEN
      RAISE NOTICE 'Skipping missing table: %', tname;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id) ON DELETE SET NULL',
      tname
    );
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=tname AND column_name='employee_id') THEN
      EXECUTE format($q$
        UPDATE public.%I AS t SET organization_id = e.organization_id
        FROM public.employees e
        WHERE t.employee_id = e.id AND t.organization_id IS NULL AND e.organization_id IS NOT NULL
      $q$, tname);
    END IF;
    EXECUTE format('UPDATE public.%I SET organization_id = %s WHERE organization_id IS NULL',
                   tname, default_org_id);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_org ON public.%I(organization_id)',
                   tname, tname);
  END LOOP;
END $$;

-- Validation: every targeted table must now have organization_id
DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(table_name, ', ') INTO missing
  FROM information_schema.tables t
  WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
    AND t.table_name IN (
      'attendance_records','tasks','approval_forms','approval_chains',
      'pos_transactions','leave_requests','overtime_requests','salary_records'
    )
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=t.table_name
        AND c.column_name='organization_id'
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Tables still missing organization_id: %', missing;
  END IF;
END $$;

COMMIT;
