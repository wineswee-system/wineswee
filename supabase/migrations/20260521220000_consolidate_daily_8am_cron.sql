-- ════════════════════════════════════════════════════════════════════════════
-- 整合每日 08:00 台灣（00:00 UTC）的三個 cron 為單一 function
--
-- 移除：
--   task_reminder_daily         (extensions.http_post → 已知不存在)
--   drain_quiet_notif_8am_tw    (extensions.http_post → 已知不存在)
--   daily-contract-status-sync  (純 SQL UPDATE)
--
-- 新增：
--   run_daily_8am_maintenance()  function（net.http_post + SQL）
--   daily-8am-maintenance        一支 cron 搞定
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 整合函式 ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_daily_8am_maintenance()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 1. 合約狀態刷新
  --    trigger 只在 end_date 欄位變更時觸發；時間流逝的狀態轉換靠這裡補
  UPDATE public.employee_contracts
  SET    status     = CASE
                        WHEN status IN ('terminated', 'renewed') THEN status
                        WHEN CURRENT_DATE > end_date             THEN 'expired'
                        WHEN (end_date - CURRENT_DATE) <= 60    THEN 'expiring_soon'
                        ELSE 'active'
                      END,
         updated_at = now()
  WHERE  status NOT IN ('terminated', 'renewed');

  -- 2. 任務到期提醒（task-reminder Edge Function, mode=all）
  PERFORM net.http_post(
    url     := current_setting('supabase.url') || '/functions/v1/task-reminder',
    body    := '{"mode":"all"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
    )
  );

  -- 3. 靜默佇列排水（task-reminder Edge Function, mode=drain_quiet_queue）
  PERFORM net.http_post(
    url     := current_setting('supabase.url') || '/functions/v1/task-reminder',
    body    := '{"mode":"drain_quiet_queue"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.run_daily_8am_maintenance IS
  '每日 08:00 台灣（00:00 UTC）統一維護：合約狀態刷新 + task-reminder(all) + task-reminder(drain_quiet_queue)';


-- ─── cron 整合 ────────────────────────────────────────────────────────────
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- 移除舊的三支
    BEGIN PERFORM cron.unschedule('task_reminder_daily');        EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('drain_quiet_notif_8am_tw');   EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('daily-contract-status-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 新增單一整合 cron
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
