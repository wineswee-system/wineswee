-- ════════════════════════════════════════════════════════════════════════════
-- 緊急：取消 rfm_nightly_score cron
-- 2026-06-26
--
-- rfm_scoring migration (20260626110000) 排了一支每天 00:15 UTC (08:15 台灣)
-- 的 cron，在 NANO compute 上跑 NTILE window function + 全表 UPDATE，
-- 今天把 DB CPU 打爆導致 compute exhausted。先砍掉，之後再評估改用
-- Edge Function 分批跑或換 MICRO compute 後再排。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rfm_nightly_score')
  THEN
    PERFORM cron.unschedule('rfm_nightly_score');
    RAISE NOTICE 'rfm_nightly_score unscheduled';
  ELSE
    RAISE NOTICE 'rfm_nightly_score not found or pg_cron not available — skip';
  END IF;
END $$;

-- 確認目前 cron 清單
SELECT jobname, schedule FROM cron.job ORDER BY jobname;
