-- tasks 加 created_by，記錄任務建立者
-- idempotent
-- 2026-07-01

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS created_by text;

NOTIFY pgrst, 'reload schema';
