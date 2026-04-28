-- ============================================================
-- Drain RPC for cascade-started LINE notifications.
--
-- Why: tasks/workflow_instances/employee_line_accounts all have
-- RLS policies scoped to the `authenticated` role only. The
-- task-reminder Edge Function authenticates as service_role,
-- which has no matching policy → silently sees zero rows.
--
-- We can't ALTER ROLE service_role BYPASSRLS on Supabase (it's
-- a reserved role). The project convention (per liff_* RPCs)
-- is SECURITY DEFINER functions that join across RLS boundaries
-- in one shot. This migration adds two such RPCs:
--
--   drain_task_started_notifications()   — returns up-to-50
--      pending rows joined with tasks + workflow_instances +
--      v_employee_line_resolved (so the function gets line_user_id
--      pre-resolved; no separate roundtrip).
--
--   mark_task_notification_sent(p_queue_id) — flips sent_at.
--      Service-role can already UPDATE task_pending_notifications
--      directly, but routing through SECURITY DEFINER keeps the
--      Edge Function's auth concerns centralised.
-- ============================================================

CREATE OR REPLACE FUNCTION public.drain_task_started_notifications()
RETURNS TABLE(
  queue_id                  INT,
  task_id                   INT,
  task_title                TEXT,
  task_priority             TEXT,
  task_due_date             TIMESTAMPTZ,
  task_store                TEXT,
  task_assignee_id          INT,
  task_workflow_instance_id INT,
  instance_template_name    TEXT,
  line_user_id              TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    q.id                        AS queue_id,
    t.id                        AS task_id,
    t.title                     AS task_title,
    t.priority                  AS task_priority,
    t.due_date                  AS task_due_date,
    t.store                     AS task_store,
    t.assignee_id               AS task_assignee_id,
    t.workflow_instance_id      AS task_workflow_instance_id,
    wi.template_name            AS instance_template_name,
    le.line_user_id
  FROM task_pending_notifications q
  LEFT JOIN tasks t                   ON t.id  = q.task_id
  LEFT JOIN workflow_instances wi     ON wi.id = t.workflow_instance_id
  LEFT JOIN LATERAL (
    SELECT v.line_user_id
      FROM v_employee_line_resolved v
     WHERE v.employee_id = t.assignee_id
     ORDER BY v.is_primary DESC NULLS LAST
     LIMIT 1
  ) le ON true
  WHERE q.sent_at IS NULL
    AND q.notif_type = 'task_started'
  ORDER BY q.id
  LIMIT 50;
$$;


CREATE OR REPLACE FUNCTION public.mark_task_notification_sent(p_queue_id INT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.task_pending_notifications
     SET sent_at = NOW()
   WHERE id = p_queue_id;
$$;


GRANT EXECUTE ON FUNCTION public.drain_task_started_notifications()  TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_task_notification_sent(INT)    TO service_role, authenticated, anon;

NOTIFY pgrst, 'reload schema';
