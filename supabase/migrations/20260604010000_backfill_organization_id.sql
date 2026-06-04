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
BEGIN

  -- ── Core workflow / task hierarchy ──────────────────────────

  UPDATE workflow_instances
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'workflow_instances: % rows updated', ROW_COUNT;

  UPDATE tasks
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'tasks: % rows updated', ROW_COUNT;

  UPDATE task_dependencies
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'task_dependencies: % rows updated', ROW_COUNT;

  UPDATE task_activity
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'task_activity: % rows updated', ROW_COUNT;

  UPDATE task_comments
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'task_comments: % rows updated', ROW_COUNT;

  UPDATE task_attachments
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'task_attachments: % rows updated', ROW_COUNT;

  UPDATE checklists
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'checklists: % rows updated', ROW_COUNT;

  -- ── Projects ────────────────────────────────────────────────

  UPDATE project_members
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'project_members: % rows updated', ROW_COUNT;

  -- ── SOP / templates ─────────────────────────────────────────

  UPDATE sop_templates
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'sop_templates: % rows updated', ROW_COUNT;

  -- ── Approval chain ──────────────────────────────────────────

  UPDATE approval_forms
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'approval_forms: % rows updated', ROW_COUNT;

  UPDATE approval_form_steps
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'approval_form_steps: % rows updated', ROW_COUNT;

  UPDATE approval_step_history
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'approval_step_history: % rows updated', ROW_COUNT;

  -- ── HR / scheduling ─────────────────────────────────────────

  UPDATE schedules
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'schedules: % rows updated', ROW_COUNT;

  UPDATE shift_definitions
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'shift_definitions: % rows updated', ROW_COUNT;

  UPDATE leave_balances
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'leave_balances: % rows updated', ROW_COUNT;

  -- ── Finance ─────────────────────────────────────────────────

  UPDATE expenses
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'expenses: % rows updated', ROW_COUNT;

  -- Prefer inheriting org from the parent expense_request row
  UPDATE expense_request_attachments a
  SET    organization_id = COALESCE(
           (SELECT er.organization_id FROM expense_requests er WHERE er.id = a.request_id),
           org_id
         )
  WHERE  a.organization_id IS NULL;
  RAISE NOTICE 'expense_request_attachments: % rows updated', ROW_COUNT;

  -- ── CRM / inventory ─────────────────────────────────────────

  UPDATE customers
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'customers: % rows updated', ROW_COUNT;

  UPDATE skus
  SET    organization_id = org_id
  WHERE  organization_id IS NULL;
  RAISE NOTICE 'skus: % rows updated', ROW_COUNT;

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
