-- ============================================================
-- 未打下班卡偵測：每天凌晨 6:00 (台灣時間) 自動執行
-- Edge Function: check-missed-clockout
--
-- 排程方式（選一）：
-- 1. Supabase Dashboard → Edge Functions → check-missed-clockout → Schedule
--    Cron: 0 22 * * *  (UTC 22:00 = 台灣 06:00)
-- 2. 外部排程器 (GitHub Actions / Cloud Scheduler)
--    POST {SUPABASE_URL}/functions/v1/check-missed-clockout
-- ============================================================

-- 此 migration 僅為文件紀錄，不需要 pg_cron
SELECT 1;
