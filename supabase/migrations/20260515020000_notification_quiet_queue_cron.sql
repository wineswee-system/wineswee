-- ============================================================
-- Cron: drain notification_quiet_queue at 08:00 Taiwan daily
-- 08:00 Taiwan (UTC+8) = 00:00 UTC
-- ============================================================

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    BEGIN PERFORM cron.unschedule('drain_quiet_notif_8am_tw'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'drain_quiet_notif_8am_tw',
      '0 0 * * *',
      $$SELECT extensions.http_post(
        url := current_setting('supabase.url') || '/functions/v1/task-reminder',
        body := '{"mode":"drain_quiet_queue"}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        )
      )$$
    );

  END IF;
END $outer$;
