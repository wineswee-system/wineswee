-- ============================================================
-- Fix two bugs introduced in 20260429000005:
--
-- Bug 1: Queue INSERT was removed, so drain_task_started_notifications()
--        always returns 0 rows → no LINE push ever fires.
--        Fix: re-add the INSERT.
--
-- Bug 2: Trigger returned early when assignee_id IS NULL.
--        Tasks created via workflow cascade have assignee (name)
--        but no assignee_id → silently skipped every time.
--        Fix: fall back to employees.name lookup when assignee_id is null.
--
-- Also fix drain_task_started_notifications() to resolve line_user_id
-- by employee_name when assignee_id is null (same root cause).
-- ============================================================

-- ── 1. Fix trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url         CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/task-reminder';
  v_anon        CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_assignee_id INT;
BEGIN
  IF NEW.status = '進行中' AND (OLD.status IS DISTINCT FROM '進行中') THEN

    -- Resolve assignee_id: use stored FK or fall back to name lookup
    v_assignee_id := NEW.assignee_id;
    IF v_assignee_id IS NULL AND NEW.assignee IS NOT NULL THEN
      SELECT id INTO v_assignee_id
        FROM public.employees
       WHERE name = NEW.assignee
       LIMIT 1;
    END IF;

    -- No employee resolved at all → nothing to notify
    IF v_assignee_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Insert to queue (drain RPC reads from here)
    INSERT INTO public.task_pending_notifications (task_id, notif_type)
    VALUES (NEW.id, 'task_started');

    -- Fire drain immediately via pg_net (async, never blocks the TX)
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


-- ── 2. Fix drain RPC — fall back to name lookup when assignee_id is null ──
DROP FUNCTION IF EXISTS public.drain_task_started_notifications();

CREATE OR REPLACE FUNCTION public.drain_task_started_notifications()
RETURNS TABLE(
  queue_id                  INT,
  task_id                   INT,
  task_title                TEXT,
  task_description          TEXT,
  task_notes                TEXT,
  task_priority             TEXT,
  task_due_date             TIMESTAMPTZ,
  task_store                TEXT,
  task_assignee             TEXT,
  task_assignee_id          INT,
  task_workflow_instance_id INT,
  instance_template_name    TEXT,
  line_user_id              TEXT,
  channel_code              TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    q.id                    AS queue_id,
    t.id                    AS task_id,
    t.title                 AS task_title,
    t.description           AS task_description,
    t.notes                 AS task_notes,
    t.priority              AS task_priority,
    t.due_date              AS task_due_date,
    t.store                 AS task_store,
    COALESCE(t.assignee, e.name) AS task_assignee,
    t.assignee_id           AS task_assignee_id,
    t.workflow_instance_id  AS task_workflow_instance_id,
    wi.template_name        AS instance_template_name,
    le.line_user_id,
    le.channel_code
  FROM task_pending_notifications q
  LEFT JOIN tasks t               ON t.id  = q.task_id
  LEFT JOIN employees e           ON e.id  = t.assignee_id
  LEFT JOIN workflow_instances wi ON wi.id = t.workflow_instance_id
  LEFT JOIN LATERAL (
    -- Prefer workflow channel; fall back to is_primary.
    -- When assignee_id is null, resolve by employee_name instead.
    SELECT v.line_user_id, v.channel_code
      FROM v_employee_line_resolved v
     WHERE (t.assignee_id IS NOT NULL AND v.employee_id   = t.assignee_id)
        OR (t.assignee_id IS NULL     AND v.employee_name = t.assignee)
     ORDER BY
       (v.channel_code = 'workflow') DESC,
       v.is_primary DESC NULLS LAST
     LIMIT 1
  ) le ON true
  WHERE q.sent_at IS NULL
    AND q.notif_type = 'task_started'
  ORDER BY q.id
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.drain_task_started_notifications() TO service_role, authenticated, anon;

NOTIFY pgrst, 'reload schema';
