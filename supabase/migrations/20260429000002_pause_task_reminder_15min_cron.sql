-- Pause the every-15-min task reminder cron job.
-- Re-enable by re-running the schedule in 20260418000004_cron_and_payroll_calc.sql or a new migration.

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('task_reminder_15min'); EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE NOTICE 'task_reminder_15min unscheduled';
  END IF;
END $outer$;
