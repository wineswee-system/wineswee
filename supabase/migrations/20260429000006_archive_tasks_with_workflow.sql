-- 封存流程時一併封存相關任務
-- tasks.archived_at: set when the parent workflow_instance is archived

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- cold path: cover archived-task lookups
CREATE INDEX IF NOT EXISTS idx_tasks_archived_at
  ON public.tasks(archived_at) WHERE archived_at IS NOT NULL;

-- hot path: getTasks() always filters archived_at IS NULL — this index covers it
CREATE INDEX IF NOT EXISTS idx_tasks_active
  ON public.tasks(created_at DESC, organization_id) WHERE archived_at IS NULL;
