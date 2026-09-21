-- ============================================================
-- Drop the per-minute cron and replace the queue-based
-- notification trigger with a direct net.http_post call.
--
-- Previously: task → 進行中 → insert task_pending_notifications
--             → task_started_drain_1min cron → task-reminder drain
--
-- Now: task → 進行中 → net.http_post task-reminder immediately
--      No queue insert. No cron. pg_net fires async HTTP within
--      seconds of TX commit.
-- ============================================================

-- Remove the per-minute drain cron
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('task_started_drain_1min');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $outer$;

CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/task-reminder';
  v_anon CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
BEGIN
  IF NEW.status = '進行中' AND (OLD.status IS DISTINCT FROM '進行中') THEN
    IF NEW.assignee_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Fire drain immediately — pg_net is async, never blocks the TX
    PERFORM net.http_post(
      url     := v_url,
      body    := '{"mode":"task_started"}'::jsonb,
      params  := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_anon
      ),
      timeout_milliseconds := 8000
    );

  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_enqueue_started_notify ON public.tasks;
CREATE TRIGGER trg_task_enqueue_started_notify
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public._task_enqueue_started_notify();

NOTIFY pgrst, 'reload schema';
