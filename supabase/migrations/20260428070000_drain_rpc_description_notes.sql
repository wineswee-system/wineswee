-- ============================================================
-- Cascade LINE drain — include description + notes in payload
-- so the flex card can render them under 到期.
--
-- Return signature changes (added 2 columns) → DROP + CREATE.
-- ============================================================

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
    t.assignee_id           AS task_assignee_id,
    t.workflow_instance_id  AS task_workflow_instance_id,
    wi.template_name        AS instance_template_name,
    le.line_user_id,
    le.channel_code
  FROM task_pending_notifications q
  LEFT JOIN tasks t                ON t.id  = q.task_id
  LEFT JOIN workflow_instances wi  ON wi.id = t.workflow_instance_id
  LEFT JOIN LATERAL (
    SELECT v.line_user_id, v.channel_code
      FROM v_employee_line_resolved v
     WHERE v.employee_id = t.assignee_id
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
