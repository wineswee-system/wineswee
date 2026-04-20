-- ============================================================
-- Phase 2.2 — Drop empty workflow_step satellite tables
--
-- Live state (verified 2026-04-20):
--   task_dependencies: 0 rows                workflow_step_dependencies: 0 rows
--   task_comments: 0 rows                    workflow_step_comments: 0 rows
--   task_checklists: 0 rows                  workflow_step_checklists: 0 rows
--   task_attachments: 0 rows                 workflow_step_attachments: 0 rows
--   workflow_step_checklist_items: 0 rows
--
-- All satellites are empty. Keep the task_* tables (Phase 2.1 migration target);
-- drop the workflow_step_* duplicates.
--
-- workflow_steps execution columns (status, assignee, completed_at, etc.) are NOT
-- yet stripped — Phase 2.1 just copied data into tasks. We keep the columns until
-- frontend code is updated to read from tasks instead. Add a deprecation comment.
--
-- Risk: LOW. All targets are empty; no app code can be reading data from them.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS public.workflow_step_dependencies CASCADE;
DROP TABLE IF EXISTS public.workflow_step_comments CASCADE;
DROP TABLE IF EXISTS public.workflow_step_checklist_items CASCADE;
DROP TABLE IF EXISTS public.workflow_step_checklists CASCADE;
DROP TABLE IF EXISTS public.workflow_step_attachments CASCADE;

COMMENT ON TABLE public.workflow_steps IS
  'DEPRECATED for execution: use tasks (workflow_step_id FK). Keep as template-only or remove after frontend migration.';

COMMIT;
