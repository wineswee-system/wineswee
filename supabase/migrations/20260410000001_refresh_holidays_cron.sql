-- ══════════════════════════════════════════════════════════════
--  Migration: 假日與排班規則自動刷新 (每半年 Cron Job)
--  - scheduling_rules_snapshot 表：存放排班規則快照
--  - pg_cron 排程：每年 1/1 與 7/1 自動呼叫 Edge Function
--  - triggers 表新增記錄
-- ══════════════════════════════════════════════════════════════

-- ── 1. 排班規則快照表 ──
CREATE TABLE IF NOT EXISTS scheduling_rules_snapshot (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,           -- 工時/加班/輪班/休息/薪資/夜間
  rule_key TEXT NOT NULL,           -- 唯一識別鍵 (e.g. daily_max)
  title TEXT NOT NULL,              -- 規則名稱
  value TEXT NOT NULL,              -- 規則值
  law_ref TEXT,                     -- 法條引用
  effective_year INT NOT NULL,      -- 適用年份
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (rule_key, effective_year)
);

-- 索引加速查詢
CREATE INDEX IF NOT EXISTS idx_scheduling_rules_year
  ON scheduling_rules_snapshot (effective_year);
CREATE INDEX IF NOT EXISTS idx_scheduling_rules_category
  ON scheduling_rules_snapshot (category, effective_year);

-- ── 2. holidays 表補上 multiplier 欄位（如尚未存在） ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'holidays' AND column_name = 'multiplier'
  ) THEN
    ALTER TABLE holidays ADD COLUMN multiplier NUMERIC DEFAULT 2;
  END IF;
END $$;

-- holidays 加上 unique constraint 避免重複
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'holidays_name_date_unique'
  ) THEN
    ALTER TABLE holidays ADD CONSTRAINT holidays_name_date_unique UNIQUE (name, date);
  END IF;
END $$;

-- ── 3. RLS ──
ALTER TABLE scheduling_rules_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheduling_rules_read" ON scheduling_rules_snapshot;
CREATE POLICY "scheduling_rules_read"
  ON scheduling_rules_snapshot FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "scheduling_rules_write" ON scheduling_rules_snapshot;
CREATE POLICY "scheduling_rules_write"
  ON scheduling_rules_snapshot FOR ALL
  USING (auth.role() = 'service_role');

-- ── 4. triggers 表新增刷新排程記錄 ──
INSERT INTO triggers (name, type, schedule, status, action)
VALUES (
  '假日與排班規則刷新',
  '排程',
  '每半年（1/1, 7/1）',
  '啟用',
  '自動刷新當年及隔年國定假日 + 排班規則快照（呼叫 refresh-holidays Edge Function）'
) ON CONFLICT DO NOTHING;

-- ── 5. pg_cron 排程（需要 Supabase Pro 方案或自架 PostgreSQL） ──
-- 每年 1 月 1 日 00:30 執行
-- 每年 7 月 1 日 00:30 執行
--
-- 注意：pg_cron 需要啟用 extension，若環境不支援可改用外部排程器
-- (e.g. GitHub Actions, Cloud Scheduler, Vercel Cron)

DO $$
BEGIN
  -- 檢查 pg_cron extension 是否可用
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- 每年 1/1 00:30 UTC 刷新
    PERFORM cron.schedule(
      'refresh-holidays-jan',
      '30 0 1 1 *',
      $task$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/refresh-holidays',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $task$
    );

    -- 每年 7/1 00:30 UTC 刷新
    PERFORM cron.schedule(
      'refresh-holidays-jul',
      '30 0 1 7 *',
      $task$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/refresh-holidays',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $task$
    );

    RAISE NOTICE 'pg_cron jobs created: refresh-holidays-jan, refresh-holidays-jul';
  ELSE
    RAISE NOTICE 'pg_cron not available — use external scheduler (GitHub Actions / Cloud Scheduler) to call refresh-holidays Edge Function on 1/1 and 7/1';
  END IF;
END $$;
