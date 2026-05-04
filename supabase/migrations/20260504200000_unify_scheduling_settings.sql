-- =============================================
-- 統一排班設定的真相來源 to store_settings
--   - store_settings 加 variable_period_start (anchor date)
--   - 把 stores.variable_period_start 已存的值搬過去
--   - stores.working_hour_type / stores.variable_period_start
--     欄位先留著但不再被讀寫（Locations.jsx 會移掉編輯介面）
-- 演算法已經讀 store_settings.work_hour_system，不用動
-- =============================================

BEGIN;

-- ── 1. 加 anchor date 欄 ──
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS variable_period_start DATE;

-- ── 2. 把 stores 已存的 anchor 搬到 store_settings ──
-- 對已有 store_settings row 的店：直接 UPDATE
UPDATE store_settings ss
SET variable_period_start = s.variable_period_start
FROM stores s
WHERE ss.store_id = s.id
  AND s.variable_period_start IS NOT NULL
  AND ss.variable_period_start IS NULL;

-- 對沒有 store_settings row 但 stores 有設 anchor 的店：補 INSERT
INSERT INTO store_settings (store_id, organization_id, work_hour_system, variable_period_start)
SELECT s.id, COALESCE(s.organization_id, 1), '標準工時', s.variable_period_start
FROM stores s
WHERE s.variable_period_start IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM store_settings ss WHERE ss.store_id = s.id);

-- ── 3. stores 的兩個欄位先不刪（先當死欄位），等都驗證沒問題再 cleanup ──
COMMENT ON COLUMN stores.working_hour_type IS 'DEPRECATED 2026-05-04: use store_settings.work_hour_system';
COMMENT ON COLUMN stores.variable_period_start IS 'DEPRECATED 2026-05-04: use store_settings.variable_period_start';

COMMIT;
