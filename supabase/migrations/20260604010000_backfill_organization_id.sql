-- ============================================================
-- Backfill NULL organization_id across all tenant-data tables
--
-- Root cause: several insert paths in the frontend and early
-- migrations did not stamp organization_id at write time.
-- This migration fills every NULL using the only existing org (id=1).
--
-- Safety guard: aborts if more than one organization exists so
-- this migration cannot silently mis-assign data in a multi-tenant
-- scenario.
--
-- Tables deliberately skipped:
--   permissions, roles — system-level RBAC, intentionally org-agnostic
-- ============================================================

BEGIN;

DO $$
DECLARE
  org_count INT;
  org_id    INT;
BEGIN
  SELECT COUNT(*), MIN(id) INTO org_count, org_id FROM organizations;
  IF org_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 organization, found %. Aborting backfill.', org_count;
  END IF;
  RAISE NOTICE 'Single org confirmed: id=%, proceeding with backfill.', org_id;
END $$;

DO $$
DECLARE
  org_id INT := (SELECT id FROM organizations LIMIT 1);
  n      BIGINT;
BEGIN

  -- ── Core workflow / task hierarchy ──────────────────────────

  UPDATE workflow_instances
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'workflow_instances: % rows updated', n;

  UPDATE tasks
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'tasks: % rows updated', n;

  UPDATE task_dependencies
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'task_dependencies: % rows updated', n;

  UPDATE task_activity
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'task_activity: % rows updated', n;

  UPDATE task_comments
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'task_comments: % rows updated', n;

  UPDATE task_attachments
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'task_attachments: % rows updated', n;

  UPDATE checklists
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'checklists: % rows updated', n;

  -- ── Projects ────────────────────────────────────────────────

  UPDATE project_members
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'project_members: % rows updated', n;

  -- ── SOP / templates ─────────────────────────────────────────

  UPDATE sop_templates
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'sop_templates: % rows updated', n;

  -- ── Approval chain ──────────────────────────────────────────

  UPDATE approval_forms
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'approval_forms: % rows updated', n;

  UPDATE approval_form_steps
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'approval_form_steps: % rows updated', n;

  UPDATE approval_step_history
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'approval_step_history: % rows updated', n;

  -- ── HR / scheduling ─────────────────────────────────────────

  UPDATE schedules
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'schedules: % rows updated', n;

  UPDATE shift_definitions
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'shift_definitions: % rows updated', n;

  UPDATE leave_balances
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'leave_balances: % rows updated', n;

  -- ── Finance ─────────────────────────────────────────────────

  UPDATE expenses
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'expenses: % rows updated', n;

  -- Prefer inheriting org from the parent expense_request row
  UPDATE expense_request_attachments a
  SET    organization_id = COALESCE(
           (SELECT er.organization_id FROM expense_requests er WHERE er.id = a.request_id),
           org_id
         )
  WHERE  a.organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'expense_request_attachments: % rows updated', n;

  -- ── CRM / inventory ─────────────────────────────────────────

  UPDATE customers
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'customers: % rows updated', n;

  UPDATE skus
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'skus: % rows updated', n;

END $$;

-- ── Verification ────────────────────────────────────────────────
DO $$
DECLARE
  rec       RECORD;
  remaining INT;
BEGIN
  FOR rec IN
    SELECT unnest(ARRAY[
      'workflow_instances','tasks','task_dependencies','task_activity',
      'task_comments','task_attachments','checklists','project_members',
      'sop_templates','approval_forms','approval_form_steps',
      'approval_step_history','schedules','shift_definitions','leave_balances',
      'expenses','expense_request_attachments','customers','skus'
    ]) AS tbl
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE organization_id IS NULL', rec.tbl) INTO remaining;
    IF remaining > 0 THEN
      RAISE WARNING 'Still % NULL org rows in %', remaining, rec.tbl;
    END IF;
  END LOOP;
  RAISE NOTICE 'Backfill verification complete.';
END $$;

COMMIT;
