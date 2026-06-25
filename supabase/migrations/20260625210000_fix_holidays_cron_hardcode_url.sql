-- ════════════════════════════════════════════════════════════════════════════
-- 修復：refresh-holidays cron 用壞掉的 GUC（同 8am 維護那支病因）
-- 2026-06-25
--
-- 2026-05-21 cron_cleanup 把 refresh-holidays-jan/jul 改成
--   current_setting('supabase.url') / ('supabase.service_role_key') —— 本專案這兩
--   個 GUC 沒設值 → URL=NULL、Authorization='Bearer null' → refresh-holidays 401。
-- 改回 hardcoded 專案 URL + anon JWT（與 task-reminder 同一驗證過的寫法）。
--
-- 影響很小：這兩支只在每年 1/1、7/1 00:30 UTC 跑（刷新國定假日表）。純重掛 cron，
-- 不動任何資料 / 函式。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

DO $outer$
DECLARE
  v_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/refresh-holidays';
  v_anon CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_hdrs CONSTANT text := format(
    $$jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s')$$, v_anon);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    BEGIN PERFORM cron.unschedule('refresh-holidays-jan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('refresh-holidays-jan', '30 0 1 1 *', format(
      $cmd$SELECT net.http_post(
        url     := %L,
        body    := '{}'::jsonb,
        params  := '{}'::jsonb,
        headers := %s,
        timeout_milliseconds := 30000)$cmd$, v_url, v_hdrs));

    BEGIN PERFORM cron.unschedule('refresh-holidays-jul'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('refresh-holidays-jul', '30 0 1 7 *', format(
      $cmd$SELECT net.http_post(
        url     := %L,
        body    := '{}'::jsonb,
        params  := '{}'::jsonb,
        headers := %s,
        timeout_milliseconds := 30000)$cmd$, v_url, v_hdrs));

  ELSE
    RAISE NOTICE 'pg_cron not available — skip refresh-holidays cron';
  END IF;
END $outer$;
