-- Pause the per-minute task_started_drain cron job.
-- Re-enable by re-running 20260428020001_task_started_drain_cron.sql or a new migration.

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('task_started_drain_1min'); EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE NOTICE 'task_started_drain_1min unscheduled';
  END IF;
END $outer$;
