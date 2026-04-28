-- ============================================================
-- Fix: task-reminder cron jobs were calling extensions.http_post,
-- which does not exist on this DB. pg_net 0.20.0 is installed in
-- the public schema, so the real function is net.http_post with
-- signature (url, body, params, headers, timeout_milliseconds).
--
-- Also: supabase.url / supabase.service_role_key GUCs are not set,
-- so URL was building as NULL and Authorization as "Bearer null".
-- Hardcode the project URL + anon JWT (anon is public-safe — already
-- shipped to the browser via .env). Edge Function uses the SERVICE
-- ROLE key from its own Deno env for DB access; the cron only needs
-- a valid JWT to pass verify_jwt.
--
-- Net effect: 'task_started_drain_1min' will actually drain the
-- task_pending_notifications queue and push LINE to the next person
-- in cascade workflows.
-- ============================================================

DO $outer$
DECLARE
  v_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/task-reminder';
  v_anon  CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_hdrs  CONSTANT text := format(
    $$jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s')$$, v_anon);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed, skipping cron setup';
    RETURN;
  END IF;

  -- 1. cascade-started drain — every minute
  BEGIN PERFORM cron.unschedule('task_started_drain_1min'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('task_started_drain_1min', '* * * * *', format(
    $cmd$SELECT net.http_post(
      url     := %L,
      body    := '{"mode":"task_started"}'::jsonb,
      params  := '{}'::jsonb,
      headers := %s,
      timeout_milliseconds := 8000)$cmd$, v_url, v_hdrs));

  -- 2. reminder_at sweep — every 15 min
  BEGIN PERFORM cron.unschedule('task_reminder_15min'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('task_reminder_15min', '*/15 * * * *', format(
    $cmd$SELECT net.http_post(
      url     := %L,
      body    := '{"mode":"reminders"}'::jsonb,
      params  := '{}'::jsonb,
      headers := %s,
      timeout_milliseconds := 30000)$cmd$, v_url, v_hdrs));

  -- 3. daily full sweep — 00:00 UTC = 08:00 Taipei
  BEGIN PERFORM cron.unschedule('task_reminder_daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('task_reminder_daily', '0 0 * * *', format(
    $cmd$SELECT net.http_post(
      url     := %L,
      body    := '{"mode":"all"}'::jsonb,
      params  := '{}'::jsonb,
      headers := %s,
      timeout_milliseconds := 60000)$cmd$, v_url, v_hdrs));
END $outer$;
