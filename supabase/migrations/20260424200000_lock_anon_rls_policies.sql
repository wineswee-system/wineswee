-- ============================================================
-- Security Fix C-2 + M-5: Lock down anon RLS policies
--
-- PROBLEM: Many tables had `TO anon USING (true) WITH CHECK (true)`
-- policies, making them fully readable and writable to anyone
-- holding the public anon key (which is in the browser bundle).
--
-- FIX:
--   1. Drop every identified `anon_*` and named anon policy on
--      sensitive tables (by explicit name, with IF EXISTS).
--   2. Where no `authenticated` policy exists yet, create a
--      baseline `FOR ALL TO authenticated USING (true) WITH CHECK (true)`.
--      Tenant-scoped tables already have org/tenant isolation on
--      top of this, so it is an acceptable baseline.
--   3. Replace anon_organizations / anon_org_dev with a
--      SELECT-only policy scoped to authenticated users.
--   4. REVOKE DML from anon on all affected tables.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. workflow_instances, workflow_steps
--    Source: 20260409120000_add_workflow_detail_columns.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_workflow_instances ON workflow_instances;
DROP POLICY IF EXISTS anon_workflow_steps     ON workflow_steps;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workflow_instances'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_workflow_instances ON workflow_instances
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workflow_steps'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_workflow_steps ON workflow_steps
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 2. Employee detail satellite tables
--    Source: 20260409260000_employee_detail_tables.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_employee_skills         ON employee_skills;
DROP POLICY IF EXISTS anon_employee_dependents     ON employee_dependents;
DROP POLICY IF EXISTS anon_employee_transfers      ON employee_transfers;
DROP POLICY IF EXISTS anon_employee_reviews        ON employee_reviews;
DROP POLICY IF EXISTS anon_employee_schedule_prefs ON employee_schedule_prefs;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'employee_skills',
    'employee_dependents',
    'employee_transfers',
    'employee_reviews',
    'employee_schedule_prefs'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND roles @> ARRAY['authenticated'::name]
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        'auth_' || tbl, tbl
      );
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 3. Task-centric satellite tables + sop_templates
--    Source: 20260416000003_task_centric_hybrid_model.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_task_dependencies     ON task_dependencies;
DROP POLICY IF EXISTS anon_task_comments         ON task_comments;
DROP POLICY IF EXISTS anon_task_attachments      ON task_attachments;
DROP POLICY IF EXISTS anon_task_checklists       ON task_checklists;
DROP POLICY IF EXISTS anon_task_checklist_items  ON task_checklist_items;
DROP POLICY IF EXISTS anon_task_confirmations    ON task_confirmations;
DROP POLICY IF EXISTS anon_sop_templates         ON sop_templates;

-- Drop the storage bucket anon policy for task attachments
DROP POLICY IF EXISTS task_attachments_anon ON storage.objects;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'task_dependencies',
    'task_comments',
    'task_attachments',
    'task_checklists',
    'task_checklist_items',
    'task_confirmations',
    'sop_templates'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND roles @> ARRAY['authenticated'::name]
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        'auth_' || tbl, tbl
      );
    END IF;
  END LOOP;
END $$;

-- Replace storage anon policy with authenticated-only access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND policyname = 'task_attachments_authenticated'
  ) THEN
    CREATE POLICY task_attachments_authenticated ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'task-attachments')
      WITH CHECK (bucket_id = 'task-attachments');
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 4. LINE channel / account tables
--    Source: 20260416000002_multi_oa_line_channels.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_line_channels          ON line_channels;
DROP POLICY IF EXISTS anon_employee_line_accounts ON employee_line_accounts;
DROP POLICY IF EXISTS anon_line_messages          ON line_messages;
DROP POLICY IF EXISTS anon_line_command_logs      ON line_command_logs;
DROP POLICY IF EXISTS anon_line_error_logs        ON line_error_logs;
DROP POLICY IF EXISTS anon_line_groups            ON line_groups;
DROP POLICY IF EXISTS anon_line_group_members     ON line_group_members;
DROP POLICY IF EXISTS anon_line_daily_summaries   ON line_daily_summaries;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'line_channels',
    'employee_line_accounts',
    'line_messages',
    'line_command_logs',
    'line_error_logs',
    'line_groups',
    'line_group_members',
    'line_daily_summaries'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND roles @> ARRAY['authenticated'::name]
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        'auth_' || tbl, tbl
      );
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 5. LINE tables (older set)
--    Source: 20260416100004_line_tables.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_department_line_groups ON department_line_groups;
DROP POLICY IF EXISTS anon_line_weekly_summaries  ON line_weekly_summaries;
DROP POLICY IF EXISTS anon_line_monthly_summaries ON line_monthly_summaries;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'department_line_groups',
    'line_weekly_summaries',
    'line_monthly_summaries'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND roles @> ARRAY['authenticated'::name]
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        'auth_' || tbl, tbl
      );
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 6. Junction tables
--    Source: 20260416100003_junction_tables.sql
--    Note: 20260416100008 already replaced anon_user_stores and
--          anon_dept_mgr_history with org-scoped isolation policies,
--          but also added new *_dev anon variants — drop those too.
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_user_stores          ON user_stores;
DROP POLICY IF EXISTS anon_user_stores_dev      ON user_stores;
DROP POLICY IF EXISTS anon_dept_mgr_history     ON department_manager_history;
DROP POLICY IF EXISTS anon_dept_mgr_hist_dev    ON department_manager_history;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_stores'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_user_stores ON user_stores
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'department_manager_history'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_department_manager_history ON department_manager_history
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 7. org_subscriptions, org_payments
--    Source: 20260416100005_org_subscriptions.sql
--            20260416100008_rbac_org_scoping.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_org_subscriptions ON org_subscriptions;
DROP POLICY IF EXISTS anon_org_sub_dev       ON org_subscriptions;
DROP POLICY IF EXISTS anon_org_payments      ON org_payments;
DROP POLICY IF EXISTS anon_org_pay_dev       ON org_payments;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'org_subscriptions'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_org_subscriptions ON org_subscriptions
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'org_payments'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_org_payments ON org_payments
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 8. expense_requests, expense_request_attachments
--    Source: 20260416200007_expense_requests.sql
--    Note: 20260424100100 already REVOKEd anon DML; this drops the
--          policy row so it no longer appears in pg_policies.
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_expense_requests ON expense_requests;
DROP POLICY IF EXISTS anon_expense_req_att  ON expense_request_attachments;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expense_requests'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_expense_requests ON expense_requests
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expense_request_attachments'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_expense_request_attachments ON expense_request_attachments
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 9. RBAC tables (roles, permissions, role_permissions)
--    Source: 20260417000003_employees_rls_fix.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_roles            ON roles;
DROP POLICY IF EXISTS anon_permissions      ON permissions;
DROP POLICY IF EXISTS anon_role_permissions ON role_permissions;

-- Roles and permissions are readable by authenticated users (needed for
-- UI role selectors); writes are restricted in migration 20260424200001.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'roles'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_roles ON roles
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'permissions'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_permissions ON permissions
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'role_permissions'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_role_permissions ON role_permissions
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 10. employees
--     Source: 20260417000003_employees_rls_fix.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_employees ON employees;
-- auth_employees was added by 20260417000003; no recreation needed.


-- ────────────────────────────────────────────────────────────
-- 11. organizations — anon_organizations → SELECT-only authenticated
--     Source: 20260416100001_organizations_bridge.sql (anon_organizations)
--             20260416100008_rbac_org_scoping.sql (anon_org_dev)
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_organizations ON organizations;
DROP POLICY IF EXISTS anon_org_dev       ON organizations;

-- Replace with SELECT-only for authenticated users.
-- org_isolation / org_tenant_isolation handle row-level scoping.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organizations'
      AND policyname = 'auth_organizations_select'
  ) THEN
    CREATE POLICY auth_organizations_select ON organizations
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 12. store_events — drop the four separate anon CRUD policies
--     Source: 20260413000001_store_events.sql
--     "Allow all for authenticated" already exists; keep it.
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow anon read"   ON store_events;
DROP POLICY IF EXISTS "Allow anon insert" ON store_events;
DROP POLICY IF EXISTS "Allow anon update" ON store_events;
DROP POLICY IF EXISTS "Allow anon delete" ON store_events;


-- ────────────────────────────────────────────────────────────
-- 13. Task collaboration tables
--     Source: 20260420000000_task_collaboration_and_views.sql
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS anon_task_watchers            ON task_watchers;
DROP POLICY IF EXISTS anon_task_mentions            ON task_mentions;
DROP POLICY IF EXISTS anon_project_members          ON project_members;
DROP POLICY IF EXISTS anon_project_sections         ON project_sections;
DROP POLICY IF EXISTS anon_project_custom_fields    ON project_custom_fields;
DROP POLICY IF EXISTS anon_task_custom_field_values ON task_custom_field_values;
DROP POLICY IF EXISTS anon_task_activity            ON task_activity;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'task_watchers',
    'task_mentions',
    'project_members',
    'project_sections',
    'project_custom_fields',
    'task_custom_field_values',
    'task_activity'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND roles @> ARRAY['authenticated'::name]
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        'auth_' || tbl, tbl
      );
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 14. Workflow detail satellite tables
--     Source: 20260409140000_workflow_task_detail_system.sql
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'workflow_step_dependencies','workflow_step_comments',
    'workflow_step_attachments','workflow_step_checklists',
    'approval_chains','approval_forms','approval_form_steps'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=tbl)
    THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'anon_'||tbl, tbl);
  END LOOP;
END $$;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'workflow_step_dependencies',
    'workflow_step_comments',
    'workflow_step_attachments',
    'workflow_step_checklists',
    'approval_chains',
    'approval_forms',
    'approval_form_steps'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN CONTINUE; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND roles @> ARRAY['authenticated'::name]
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        'auth_' || tbl, tbl
      );
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────
-- 15. checklist_items
--     Source: 20260409170000_checklist_items_table.sql
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='checklist_items')
  THEN RETURN; END IF;
  EXECUTE 'DROP POLICY IF EXISTS anon_checklist_items ON checklist_items';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'checklist_items'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    CREATE POLICY auth_checklist_items ON checklist_items
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 16. Final: REVOKE anon DML on all affected tables
--     Belt-and-suspenders complement to the policy drops above.
--     Tables that no longer exist are skipped via IF EXISTS guards
--     in Postgres (REVOKE on non-existent table is an error, so
--     we use a DO block).
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'workflow_instances', 'workflow_steps',
    'employee_skills', 'employee_dependents', 'employee_transfers',
    'employee_reviews', 'employee_schedule_prefs',
    'task_dependencies', 'task_comments', 'task_attachments',
    'task_checklists', 'task_checklist_items', 'task_confirmations',
    'sop_templates',
    'line_channels', 'employee_line_accounts', 'line_messages',
    'line_command_logs', 'line_error_logs', 'line_groups',
    'line_group_members', 'line_daily_summaries',
    'department_line_groups', 'line_weekly_summaries', 'line_monthly_summaries',
    'user_stores', 'department_manager_history',
    'org_subscriptions', 'org_payments',
    'expense_requests', 'expense_request_attachments',
    'roles', 'permissions', 'role_permissions',
    'organizations', 'checklist_items',
    'workflow_step_dependencies', 'workflow_step_comments',
    'workflow_step_attachments', 'workflow_step_checklists',
    'approval_chains', 'approval_forms', 'approval_form_steps',
    'task_watchers', 'task_mentions', 'project_members',
    'project_sections', 'project_custom_fields',
    'task_custom_field_values', 'task_activity'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN CONTINUE; END IF;

    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON %I FROM anon', tbl
    );
  END LOOP;
END $$;

COMMIT;
