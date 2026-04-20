-- ============================================================
-- Materialized view refresh cron
--
-- mv_daily_sales and mv_customer_revenue have been frozen since creation
-- (no refresh job). Add a refresher function and schedule it via pg_cron.
--
-- Schedule: every 30 minutes (low-traffic hours could be longer; tune later).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_materialized_views()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  mv RECORD;
BEGIN
  FOR mv IN
    SELECT n.nspname AS schema_name, c.relname AS mv_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'm' AND n.nspname = 'public'
  LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I.%I', mv.schema_name, mv.mv_name);
    EXCEPTION WHEN OTHERS THEN
      -- CONCURRENTLY requires a unique index; fall back to non-concurrent on error.
      EXECUTE format('REFRESH MATERIALIZED VIEW %I.%I', mv.schema_name, mv.mv_name);
    END;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.refresh_materialized_views() FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_materialized_views() TO postgres;

-- Schedule: every 30 minutes. Idempotent — replace any previous schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('refresh_materialized_views') FROM cron.job WHERE jobname='refresh_materialized_views';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('refresh_materialized_views', '*/30 * * * *', $cron$SELECT public.refresh_materialized_views()$cron$);

COMMIT;
