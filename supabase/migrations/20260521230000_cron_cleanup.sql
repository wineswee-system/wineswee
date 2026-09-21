-- ════════════════════════════════════════════════════════════════════════════
-- Cron 清理
--
-- 1. refresh_materialized_views 從每 30 分鐘降為每日 8am（整合進維護函式）
-- 2. refresh-holidays-jan/jul 修正 GUC（app.settings.* → supabase.*）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 更新每日維護函式，加入 MV 刷新 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_daily_8am_maintenance()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 合約狀態刷新（trigger 只在 end_date 變更時觸發，時間流逝靠這裡補）
  UPDATE public.employee_contracts
  SET    status     = CASE
                        WHEN status IN ('terminated', 'renewed') THEN status
                        WHEN CURRENT_DATE > end_date             THEN 'expired'
                        WHEN (end_date - CURRENT_DATE) <= 60    THEN 'expiring_soon'
                        ELSE 'active'
                      END,
         updated_at = now()
  WHERE  status NOT IN ('terminated', 'renewed');

  -- Materialized view 刷新（銷售/客戶報表）
  PERFORM public.refresh_materialized_views();

  -- 任務到期提醒 + 逾期 + SLA + 靜默佇列
  PERFORM net.http_post(
    url     := current_setting('supabase.url') || '/functions/v1/task-reminder',
    body    := '{"mode":"all"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.run_daily_8am_maintenance IS
  '每日 08:00 台灣（00:00 UTC）：合約狀態 + MV refresh + task-reminder(all)';


-- ─── 2. 刪掉獨立的 30 分鐘 MV cron ─────────────────────────────────────────
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('refresh_materialized_views'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $outer$;


-- ─── 3. 修正 holidays cron GUC（app.settings.* → supabase.*）───────────────
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    BEGIN PERFORM cron.unschedule('refresh-holidays-jan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'refresh-holidays-jan',
      '30 0 1 1 *',
      $$SELECT net.http_post(
        url     := current_setting('supabase.url') || '/functions/v1/refresh-holidays',
        body    := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        )
      )$$
    );

    BEGIN PERFORM cron.unschedule('refresh-holidays-jul'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'refresh-holidays-jul',
      '30 0 1 7 *',
      $$SELECT net.http_post(
        url     := current_setting('supabase.url') || '/functions/v1/refresh-holidays',
        body    := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        )
      )$$
    );

  END IF;
END $outer$;


COMMIT;
