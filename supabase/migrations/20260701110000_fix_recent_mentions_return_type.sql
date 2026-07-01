-- web_get_my_recent_mentions 加 workflow_instance_id / project_id
-- CREATE OR REPLACE 無法改 return type → 先 DROP 再建
-- idempotent: DROP IF EXISTS + CREATE
-- 2026-07-01

DROP FUNCTION IF EXISTS public.web_get_my_recent_mentions();

CREATE FUNCTION public.web_get_my_recent_mentions()
RETURNS TABLE (
  mention_id           int,
  task_id              int,
  task_title           text,
  mentioned_by         text,
  comment_content      text,
  occurred_at          timestamptz,
  seen_at              timestamptz,
  workflow_instance_id int,
  project_id           int
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    tm.id                      AS mention_id,
    tm.task_id,
    t.title                    AS task_title,
    tm.mentioned_by,
    tc.content                 AS comment_content,
    COALESCE(tc.created_at, tm.notified_at) AS occurred_at,
    tm.seen_at,
    t.workflow_instance_id,
    t.project_id
  FROM public.task_mentions tm
  LEFT JOIN public.tasks         t  ON t.id  = tm.task_id
  LEFT JOIN public.task_comments tc ON tc.id = tm.comment_id
  WHERE tm.mentioned_employee_id = (
    SELECT id FROM public.employees WHERE email = auth.email() LIMIT 1
  )
  ORDER BY COALESCE(tc.created_at, tm.notified_at) DESC NULLS LAST
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION public.web_get_my_recent_mentions() TO authenticated;

NOTIFY pgrst, 'reload schema';
