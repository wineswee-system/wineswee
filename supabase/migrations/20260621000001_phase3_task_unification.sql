-- ============================================================
-- Phase 3: Task Unification
--
-- task_type column makes the task's role explicit:
--   task         = general work item (default)
--   milestone    = date marker with no duration (diamond in Timeline)
--   approval     = approval request surfaced as a task
--   process_step = a step inside a workflow SOP run
--
-- parent_task_id and section_id already exist (20260420000000).
-- This migration only adds task_type + backfills process steps.
-- ============================================================

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'task'
    CHECK (task_type IN ('task', 'milestone', 'approval', 'process_step'));

COMMENT ON COLUMN public.tasks.task_type IS
  'task=general; milestone=date marker; approval=approval request; process_step=SOP workflow step';

-- Backfill: tasks already linked to a workflow instance are process steps
UPDATE public.tasks
SET task_type = 'process_step'
WHERE workflow_instance_id IS NOT NULL
  AND (task_type IS NULL OR task_type = 'task');

CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON public.tasks(task_type);

COMMIT;
