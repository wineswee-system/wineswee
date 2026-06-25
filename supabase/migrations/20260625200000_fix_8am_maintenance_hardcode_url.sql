-- ════════════════════════════════════════════════════════════════════════════
-- 修復：每日 8am 任務逾期通知自 2026-05-21 起失效
-- 2026-06-25
--
-- 病因：
--   task-reminder 的「逾期通知」只在 mode=all 那輪跑，而 mode=all 只有每日 8am
--   的 cron 會呼叫。2026-05-21 的 cron 整合/清理（consolidate_daily_8am_cron +
--   cron_cleanup）把原本 hardcoded、能動的 task_reminder_daily 砍掉，改叫
--   run_daily_8am_maintenance()，而該函式用 current_setting('supabase.url') /
--   ('supabase.service_role_key') GUC —— 本專案這兩個 GUC 沒設值，URL 變 NULL、
--   Authorization 變 'Bearer null' → task-reminder 回 401 → 逾期 LINE 完全不發。
--   （此事 2026-04-28 的 fix_task_cron_http_post 已踩過並改 hardcoded，5/21 又退回去）
--
-- 修法：
--   重寫 run_daily_8am_maintenance()，net.http_post 改用 hardcoded 專案 URL +
--   anon JWT（anon 是公開安全的，本來就出現在前端 .env；Edge Function 內自帶
--   service_role 連 DB，cron 只需合法 JWT 過 verify_jwt）。
--   合約刷新 + MV 刷新兩步維持不變（純 SQL，本來就正常）。
--   再重掛 daily-8am-maintenance cron（idempotent），確保排程存在且指向修好的函式。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.run_daily_8am_maintenance()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/task-reminder';
  v_anon CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
BEGIN
  -- 1. 合約狀態刷新（trigger 只在 end_date 變更時觸發，時間流逝靠這裡補）
  UPDATE public.employee_contracts
  SET    status     = CASE
                        WHEN status IN ('terminated', 'renewed') THEN status
                        WHEN CURRENT_DATE > end_date             THEN 'expired'
                        WHEN (end_date - CURRENT_DATE) <= 60    THEN 'expiring_soon'
                        ELSE 'active'
                      END,
         updated_at = now()
  WHERE  status NOT IN ('terminated', 'renewed');

  -- 2. Materialized view 刷新（銷售/客戶報表）
  PERFORM public.refresh_materialized_views();

  -- 3. 任務到期提醒 + 逾期 + due_soon（mode=all）— hardcoded URL + anon JWT
  PERFORM net.http_post(
    url     := v_url,
    body    := '{"mode":"all"}'::jsonb,
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    timeout_milliseconds := 60000
  );
END;
$fn$;

COMMENT ON FUNCTION public.run_daily_8am_maintenance IS
  '每日 08:00 台灣（00:00 UTC）：合約狀態 + MV refresh + task-reminder(all/含逾期)。net.http_post 用 hardcoded URL+anon（GUC 不可用）';

-- 重掛 cron（idempotent）：確保排程存在且指向修好的函式
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('daily-8am-maintenance'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'daily-8am-maintenance',
      '0 0 * * *',
      'SELECT public.run_daily_8am_maintenance()'
    );
  ELSE
    RAISE NOTICE 'pg_cron not available — skip daily-8am-maintenance';
  END IF;
END $outer$;

COMMIT;
