-- 補 task_attachments 既有表的缺漏欄位（CREATE TABLE IF NOT EXISTS 不會 alter 既有 schema）

ALTER TABLE public.task_attachments
  ADD COLUMN IF NOT EXISTS file_name           TEXT,
  ADD COLUMN IF NOT EXISTS storage_path        TEXT,
  ADD COLUMN IF NOT EXISTS file_size           INT,
  ADD COLUMN IF NOT EXISTS file_type           TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by_emp_id  INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS uploaded_by         TEXT,
  ADD COLUMN IF NOT EXISTS organization_id     INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_task_att_task ON public.task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_att_org  ON public.task_attachments(organization_id);

-- 重 grant + reload 確保 PostgREST 看到
NOTIFY pgrst, 'reload schema';
