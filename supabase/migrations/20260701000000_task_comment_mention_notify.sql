-- ════════════════════════════════════════════════════════════════════════════
-- web_create_task_comment_with_mentions
-- 插入 task_comments + task_mentions，並對每位被 @mention 的員工推 LINE 通知
-- idempotent: CREATE OR REPLACE
-- 2026-07-01
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.web_create_task_comment_with_mentions(
  p_task_id          int,
  p_author           text,
  p_content          text,
  p_author_emp_id    int,
  p_mention_ids      int[]   -- 被 @tag 的 employee id 陣列
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comment_id   int;
  v_task_title   text;
  v_service_key  text;
  v_notify_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_emp_id       int;
  v_payload      jsonb;
BEGIN
  -- 1. 插入評論
  INSERT INTO public.task_comments (task_id, author, content, source)
  VALUES (p_task_id, p_author, p_content, 'web')
  RETURNING id INTO v_comment_id;

  -- 2. 沒有被 mention 就直接回
  IF p_mention_ids IS NULL OR array_length(p_mention_ids, 1) IS NULL THEN
    RETURN json_build_object('id', v_comment_id);
  END IF;

  -- 3. 取 task 標題（用於通知卡片）
  SELECT title INTO v_task_title FROM public.tasks WHERE id = p_task_id;

  -- 4. 取 service_role key（vault）
  BEGIN
    SELECT decrypted_secret INTO v_service_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  -- 5. 逐一處理每個被 mention 的員工
  FOREACH v_emp_id IN ARRAY p_mention_ids LOOP
    -- 不允許 mention 自己（避免自通知）
    CONTINUE WHEN v_emp_id = p_author_emp_id;

    -- 5a. 寫入 task_mentions
    INSERT INTO public.task_mentions (
      task_id, comment_id, mentioned_employee_id,
      mentioned_by, notified
    ) VALUES (
      p_task_id, v_comment_id, v_emp_id,
      p_author, false
    ) ON CONFLICT DO NOTHING;

    -- 5b. 推 LINE 通知
    IF v_service_key IS NOT NULL THEN
      v_payload := jsonb_build_object(
        'employee_id', v_emp_id,
        'type', 'task_mentioned',
        'details', jsonb_build_object(
          'task_id',    p_task_id,
          'task_title', COALESCE(v_task_title, '（未命名任務）'),
          'author',     p_author,
          'content',    LEFT(p_content, 120)
        )
      );

      PERFORM net.http_post(
        url     := v_notify_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := v_payload
      );

      -- 5c. 標記 notified
      UPDATE public.task_mentions
         SET notified = true, notified_at = now()
       WHERE comment_id = v_comment_id
         AND mentioned_employee_id = v_emp_id;
    END IF;
  END LOOP;

  RETURN json_build_object('id', v_comment_id, 'mentions', array_length(p_mention_ids, 1));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[web_create_task_comment_with_mentions] %', SQLERRM;
  RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.web_create_task_comment_with_mentions(int, text, text, int, int[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
