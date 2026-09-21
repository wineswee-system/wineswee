-- ============================================================
-- 20260621150000_survey_send_cron.sql
-- Sprint 4 — Survey dispatch cron
--
-- process_pending_survey_invitations()
--   Called by pg_cron every hour.
--   Marks pending invitations as 'sent' when send_after <= now().
--   Updates pilot_runs.sent_count for pilot rows.
--   (Actual LINE/SMS push done by Edge Function polling 'sent' rows.)
--
-- expire_overdue_survey_invitations()
--   Called by pg_cron daily.
--   Marks 'pending' or 'sent' invitations as 'expired' once expires_at < now().
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. process_pending_survey_invitations
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.process_pending_survey_invitations()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.survey_invitations
  SET    status  = 'sent',
         sent_at = now()
  WHERE  status     = 'pending'
    AND  send_after <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Keep pilot_runs.sent_count in sync
  UPDATE public.pilot_runs pr
  SET    sent_count  = (
           SELECT COUNT(*) FROM public.survey_invitations
           WHERE pilot_run_id = pr.id AND status IN ('sent','responded')
         ),
         updated_at = now()
  WHERE  pr.id IN (
    SELECT DISTINCT pilot_run_id FROM public.survey_invitations
    WHERE  status   = 'sent'
      AND  sent_at >= (now() - INTERVAL '2 hours')
      AND  pilot_run_id IS NOT NULL
  );

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.process_pending_survey_invitations() TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 2. expire_overdue_survey_invitations
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expire_overdue_survey_invitations()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.survey_invitations
  SET    status = 'expired'
  WHERE  status     IN ('pending', 'sent')
    AND  expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.expire_overdue_survey_invitations() TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 3. pg_cron jobs (conditional on extension)
-- ═══════════════════════════════════════════════════════════

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Hourly: dispatch pending invitations
    BEGIN PERFORM cron.unschedule('survey-dispatch-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'survey-dispatch-hourly',
      '0 * * * *',
      $$ SELECT public.process_pending_survey_invitations() $$
    );

    -- Daily 03:00 UTC: expire overdue invitations
    BEGIN PERFORM cron.unschedule('survey-expire-daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'survey-expire-daily',
      '0 3 * * *',
      $$ SELECT public.expire_overdue_survey_invitations() $$
    );

  END IF;
END $outer$;

COMMIT;
