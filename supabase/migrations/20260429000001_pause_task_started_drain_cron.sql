-- Pause the per-minute task_started_drain cron job.
-- Re-enable by re-running 20260428020001_task_started_drain_cron.sql or a new migration.

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('task_started_drain_1min');
      RAISE NOTICE 'task_started_drain_1min unscheduled';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'unschedule skipped (may already be absent): %', SQLERRM;
    END;
  END IF;
END $outer$;
