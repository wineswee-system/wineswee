-- 加 cron：每分鐘 drain task_pending_notifications queue
-- 讓 cascade 啟動的任務馬上推 LINE 給負責人

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- 每 1 分鐘 drain queue（task_started 模式）
    BEGIN PERFORM cron.unschedule('task_started_drain_1min'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'task_started_drain_1min',
      '* * * * *',
      $$SELECT extensions.http_post(
        url := current_setting('supabase.url') || '/functions/v1/task-reminder',
        body := '{"mode":"task_started"}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        )
      )$$
    );

  END IF;
END $outer$;
