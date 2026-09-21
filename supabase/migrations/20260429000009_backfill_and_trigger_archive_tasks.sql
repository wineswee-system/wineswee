-- 封存流程時自動同步相關任務的 archived_at
-- 1. 補填：所有已封存（archived_at IS NOT NULL）或已完成（status='已完成'）的 workflow_instances，
--    將其關聯任務的 archived_at 設為 workflow 的封存時間（或完成時間）
-- 2. 建立 trigger：日後封存 workflow_instances 時自動 cascade 到 tasks
--
-- NOTE: Backfilled from running remote DB on 2026-04-29; was originally
-- applied via Supabase Studio SQL Editor (no migration file at the time).
-- Content matches schema_migrations.statements byte-for-byte.

-- ─── 1. Backfill ────────────────────────────────────────────
UPDATE public.tasks t
SET    archived_at = COALESCE(wi.archived_at, wi.completed_at, now())
FROM   public.workflow_instances wi
WHERE  t.workflow_instance_id = wi.id
  AND  t.archived_at IS NULL
  AND  (wi.archived_at IS NOT NULL OR wi.status = '已完成');

-- ─── 2. Trigger function ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cascade_archive_tasks_on_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fires when archived_at transitions from NULL → non-NULL
  IF (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL) THEN
    UPDATE public.tasks
    SET    archived_at = NEW.archived_at
    WHERE  workflow_instance_id = NEW.id
      AND  archived_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 3. Attach trigger to workflow_instances ─────────────────
DROP TRIGGER IF EXISTS trg_cascade_archive_tasks ON public.workflow_instances;

CREATE TRIGGER trg_cascade_archive_tasks
  AFTER UPDATE OF archived_at ON public.workflow_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_archive_tasks_on_workflow();
