-- ============================================================
-- 對齊 performance_goals 進度欄位
--
-- 背景：schema 設計是 `progress NUMERIC`，但主系統 Performance.jsx 一直用 `current`
-- 寫入。如果 DB 有 current 欄位（可能是之前手動加的），就會正常運作；
-- 但 LIFF RPC liff_list_my_goals / liff_update_goal_progress 都讀 progress，
-- 兩邊不一致。
--
-- 這支做：
--   1. 兩個欄位都確保存在（IF NOT EXISTS）
--   2. 把 current 的值同步到 progress（如果 progress 是 NULL 而 current 有值）
--   3. 之後 code 改用 progress 為主，current 保留供既有資料相容
-- ============================================================

ALTER TABLE public.performance_goals
  ADD COLUMN IF NOT EXISTS progress NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "current" NUMERIC DEFAULT 0;

-- 同步既有資料：current 有值但 progress 沒值 → 拷過去
UPDATE public.performance_goals
SET progress = "current"
WHERE (progress IS NULL OR progress = 0)
  AND "current" IS NOT NULL
  AND "current" > 0;

-- 反向也補：progress 有值但 current 沒 → 拷過去（保持兩邊一致）
UPDATE public.performance_goals
SET "current" = progress
WHERE ("current" IS NULL OR "current" = 0)
  AND progress IS NOT NULL
  AND progress > 0;

COMMENT ON COLUMN public.performance_goals.progress IS
  '進度（schema 主欄位，新 code 一律讀寫這個）';
COMMENT ON COLUMN public.performance_goals."current" IS
  '進度 legacy 欄位，保留給舊資料/舊 code 相容；新 code 請用 progress';
