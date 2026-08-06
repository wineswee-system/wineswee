-- 招募候選人履歷:存原始檔名(含中文) — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:候選人上傳履歷,storage key 把中文濾成 _(正確),但只存 resume_url,
--   顯示「已上傳」時從 URL 拆檔名 → 拆到被吃掉中文的 key(1234_.pdf)。
-- 修:加 resume_filename 存原始中文檔名供顯示/下載。storage key 維持 ASCII。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS resume_filename text;
