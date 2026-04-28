-- ============================================================
-- 任務啟動通知 queue
-- ----------------------------------------------------------
-- DB trigger 沒辦法直接呼 LINE API → 寫到 queue 表，由 Edge Function
-- (task-reminder) 定期 drain，推 LINE 給負責人。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.task_pending_notifications (
  id           SERIAL PRIMARY KEY,
  task_id      INT NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  notif_type   TEXT NOT NULL DEFAULT 'task_started',
  created_at   TIMESTAMPTZ DEFAULT now(),
  sent_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_pending_unsent
  ON public.task_pending_notifications(sent_at, created_at)
  WHERE sent_at IS NULL;

-- Trigger：tasks.status 變 '進行中' 時 enqueue
CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = '進行中' AND (OLD.status IS DISTINCT FROM '進行中') THEN
    -- 只在有 assignee 時 enqueue（沒人可推就不要寫）
    IF NEW.assignee_id IS NOT NULL THEN
      INSERT INTO public.task_pending_notifications (task_id, notif_type)
      VALUES (NEW.id, 'task_started');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_enqueue_started_notify ON public.tasks;
CREATE TRIGGER trg_task_enqueue_started_notify
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public._task_enqueue_started_notify();


-- ── 一次性補：把目前狀態 '進行中' 但沒人通知過的任務也加進 queue ──
-- 這樣 instance 233 的 step 3 (Molly) 也會被推
INSERT INTO public.task_pending_notifications (task_id, notif_type)
SELECT id, 'task_started'
  FROM public.tasks
 WHERE status = '進行中'
   AND assignee_id IS NOT NULL
   AND workflow_instance_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.task_pending_notifications p
      WHERE p.task_id = tasks.id AND p.sent_at IS NOT NULL
   );

NOTIFY pgrst, 'reload schema';
