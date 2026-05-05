-- =============================================
-- 停掉 refresh_materialized_views cron（每 30 分鐘空跑）
--
-- 確認：
--   - DB 裡 0 張真正的 materialized view（pg_class.relkind='m'）
--   - 那兩張同名空殼 TABLE 沒人寫入，前端有 live query fallback
--   - 函數本身的迴圈每次掃 0 張 MV → 純空跑
--
-- 保守做法：只停 cron 排程，保留函數本體與空殼 TABLE。
-- 未來若決定建真的 MV，直接重排即可。
-- =============================================

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh_materialized_views')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_materialized_views');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMIT;
