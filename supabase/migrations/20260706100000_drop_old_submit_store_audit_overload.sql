-- ════════════════════════════════════════════════════════════════════════════
-- DROP 舊版 submit_store_audit(int, jsonb) — 消除 overload 分裂
-- 2026-07-06
--
-- 20260701240000 用 CREATE OR REPLACE 建了新版 submit_store_audit(text, int, jsonb)
-- （多前置 p_line_user_id + 認得 △partial），但沒 DROP 舊 2 參數版
-- submit_store_audit(int, jsonb)（5 月版，未評核檢查只看 passed IS NULL、不認 partial）。
-- 兩版並存 → 前端只傳 2 參數時命中舊版 → 所有 △ 被當未評核 → ITEMS_NOT_EVALUATED
-- 送不出。前端已補 p_line_user_id 命中新版；這裡清掉舊版避免未來再被誤命中。
--
-- 只 DROP (integer, jsonb) 簽名（舊版）。新版是 (text, integer, jsonb)，不受影響。
-- 對齊 memory 鐵則 feedback_pg_function_overload_ambiguity：新建改參數版必先 DROP 舊版。
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.submit_store_audit(integer, jsonb);

NOTIFY pgrst, 'reload schema';
