-- 封存流程時一併封存相關任務
-- tasks.archived_at: set when the parent workflow_instance is archived

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_archived_at
  ON public.tasks(archived_at) WHERE archived_at IS NOT NULL;
