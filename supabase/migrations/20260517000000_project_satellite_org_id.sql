-- ============================================================
-- Add organization_id to project satellite tables that were
-- created in task_collaboration migration but never included
-- in Phase 1.2 org_id backfill.
--
-- Tables: project_sections, project_members, project_custom_fields
--
-- Strategy: backfill via parent project.organization_id,
-- then create indexes and apply org-scoped RLS (mirrors Phase 1.3).
-- ============================================================

BEGIN;

-- project_sections
ALTER TABLE public.project_sections
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE public.project_sections s
SET organization_id = p.organization_id
FROM public.projects p
WHERE s.project_id = p.id
  AND s.organization_id IS NULL
  AND p.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_sections_org ON public.project_sections(organization_id);

-- project_members
ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE public.project_members m
SET organization_id = p.organization_id
FROM public.projects p
WHERE m.project_id = p.id
  AND m.organization_id IS NULL
  AND p.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_members_org ON public.project_members(organization_id);

-- project_custom_fields
ALTER TABLE public.project_custom_fields
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE public.project_custom_fields f
SET organization_id = p.organization_id
FROM public.projects p
WHERE f.project_id = p.id
  AND f.organization_id IS NULL
  AND p.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_custom_fields_org ON public.project_custom_fields(organization_id);

-- Apply org-scoped RLS policies (mirrors Phase 1.3 pattern)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_sections','project_members','project_custom_fields'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Drop any prior blanket or org policies so re-runs are idempotent
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_read_'||t,        t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admin_write_'||t,      t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_scope_select_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_scope_insert_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_scope_modify_'||t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_scope_delete_'||t, t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (organization_id = public.current_employee_org()
             OR public.current_employee_role() IN ('admin','super_admin'))
    $q$, 'org_scope_select_'||t, t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (organization_id = public.current_employee_org()
                  OR public.current_employee_role() IN ('admin','super_admin'))
    $q$, 'org_scope_insert_'||t, t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (organization_id = public.current_employee_org()
             OR public.current_employee_role() IN ('admin','super_admin'))
      WITH CHECK (organization_id = public.current_employee_org()
                  OR public.current_employee_role() IN ('admin','super_admin'))
    $q$, 'org_scope_modify_'||t, t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (organization_id = public.current_employee_org()
             OR public.current_employee_role() IN ('admin','super_admin'))
    $q$, 'org_scope_delete_'||t, t);
  END LOOP;
END $$;

-- Validation: all three tables must now have organization_id
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(table_name, ', ') INTO missing
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_name IN ('project_sections','project_members','project_custom_fields')
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t.table_name
        AND c.column_name = 'organization_id'
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Tables still missing organization_id: %', missing;
  END IF;
END $$;

COMMIT;
