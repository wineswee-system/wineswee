-- ════════════════════════════════════════════════════════════════════════════
-- @mention 可見性：Web 通知鈴鐺 + LIFF 被標記任務可讀
-- idempotent: ALTER TABLE IF NOT EXISTS / CREATE OR REPLACE
-- 2026-07-01
-- ════════════════════════════════════════════════════════════════════════════

-- 1. task_mentions 加 seen_at（Web 鈴鐺已讀標記）
ALTER TABLE public.task_mentions
  ADD COLUMN IF NOT EXISTS seen_at timestamptz;

-- ── 2. web_get_my_unread_mention_count ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.web_get_my_unread_mention_count()
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::int
  FROM public.task_mentions
  WHERE mentioned_employee_id = (
    SELECT id FROM public.employees WHERE email = auth.email() LIMIT 1
  )
  AND seen_at IS NULL
$$;
GRANT EXECUTE ON FUNCTION public.web_get_my_unread_mention_count() TO authenticated;

-- ── 3. web_get_my_recent_mentions（最近 50 筆，不分已讀未讀）────────────
CREATE OR REPLACE FUNCTION public.web_get_my_recent_mentions()
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

-- ── 4. web_mark_my_mentions_seen ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.web_mark_my_mentions_seen()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.task_mentions
  SET seen_at = now()
  WHERE mentioned_employee_id = (
    SELECT id FROM public.employees WHERE email = auth.email() LIMIT 1
  )
  AND seen_at IS NULL
$$;
GRANT EXECUTE ON FUNCTION public.web_mark_my_mentions_seen() TO authenticated;

-- ── 5. liff_get_task_for_mentioned（被標記員工的唯讀任務視圖）───────────
CREATE OR REPLACE FUNCTION public.liff_get_task_for_mentioned(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp     public.employees;
  v_task  public.tasks;
  v_comments jsonb;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 必須在此任務的 task_mentions 裡才能看
  IF NOT EXISTS (
    SELECT 1 FROM public.task_mentions
    WHERE task_id = p_task_id AND mentioned_employee_id = emp.id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',         tc.id,
      'author',     tc.author,
      'content',    tc.content,
      'created_at', tc.created_at
    ) ORDER BY tc.created_at
  ) INTO v_comments
  FROM public.task_comments tc
  WHERE tc.task_id = p_task_id;

  RETURN json_build_object(
    'ok',          true,
    'read_only',   true,
    'id',          v_task.id,
    'title',       v_task.title,
    'status',      v_task.status,
    'priority',    v_task.priority,
    'due_date',    v_task.due_date,
    'due_time',    v_task.due_time,
    'description', v_task.description,
    'store',       v_task.store,
    'assignee',    v_task.assignee,
    'comments',    COALESCE(v_comments, '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.liff_get_task_for_mentioned(text, int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
