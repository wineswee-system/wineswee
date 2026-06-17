-- ════════════════════════════════════════════════════════════════════════════
-- 把每位員工的「可支援門市」(additional_stores) 全部打開 — 跨店代班免臨時調整
-- 2026-06-17
--
-- additional_stores 存「門市名稱」陣列（text[]）。設成 org1 內「除總部外」的全部門市。
-- 排除「威士威企業總部」（總部，非可代班門市；與員工編輯頁的可支援門市清單一致）。
-- 動態從 stores 撈，不寫死清單（門市增減自動跟上）。
--
-- 注意：會覆蓋現有 additional_stores（這正是「全部打開」的意圖）。
-- idempotent：重跑得到同一結果。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.employees e
SET additional_stores = COALESCE((
  SELECT array_agg(s.name ORDER BY s.id)
  FROM stores s
  WHERE s.organization_id = 1
    AND s.name <> '威士威企業總部'
), '{}'::text[])
WHERE e.organization_id = 1;

COMMIT;
