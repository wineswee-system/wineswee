-- ============================================================
-- Phase 2.1 — Migrate workflow_steps execution rows into tasks
--
-- Live state (verified 2026-04-20):
--   workflow_instances: 7 rows
--   workflow_steps: 47 rows (43 待處理, 2 進行中, 2 已完成)
--   tasks already exists with workflow_instance_id and workflow_step_id columns.
--
-- Each workflow_step gets a corresponding task row (if not already present).
-- Idempotent via NOT EXISTS guard on (workflow_step_id).
--
-- Risk: MEDIUM. New rows in tasks; no deletion. Original workflow_steps preserved
-- until Phase 2.2.
-- ============================================================

BEGIN;

-- Insert tasks for any workflow_steps that don't already have a task linked
INSERT INTO public.tasks (
  title, description, status, assignee, due_date,
  workflow_instance_id, workflow_step_id, store, store_id,
  step_order, step_type, role, category, priority,
  reminder_at, approval_chain_id, completed_at,
  organization_id, created_at, updated_at
)
SELECT
  ws.title,
  ws.description,
  ws.status,
  ws.assignee,
  ws.due_date,
  ws.instance_id,
  ws.id,
  ws.store,
  s.id,                 -- store_id resolved from store name
  ws.step_order,
  'workflow_step',
  ws.role,
  ws.category,
  ws.priority,
  ws.reminder_at,
  ws.approval_chain_id,
  ws.completed_at,
  COALESCE(s.organization_id, (SELECT id FROM organizations ORDER BY id LIMIT 1)),
  COALESCE(ws.completed_at, now()),
  now()
FROM public.workflow_steps ws
LEFT JOIN public.stores s ON s.name = ws.store
WHERE NOT EXISTS (
  SELECT 1 FROM public.tasks t WHERE t.workflow_step_id = ws.id
);

-- Validation
DO $$
DECLARE
  unmigrated INT;
BEGIN
  SELECT count(*) INTO unmigrated
  FROM public.workflow_steps ws
  WHERE NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.workflow_step_id = ws.id);
  IF unmigrated > 0 THEN
    RAISE EXCEPTION 'Phase 2.1 incomplete: % workflow_steps unmigrated', unmigrated;
  END IF;
  RAISE NOTICE 'Phase 2.1: all workflow_steps now have task rows';
END $$;

COMMIT;
