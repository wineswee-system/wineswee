-- 刪除 store_id=NULL 的「全域」班別範本 — 2026-07-07
-- 背景：18 個 shift_definitions 沒綁門市(store_id=NULL)，是舊種子重複灌的(其中 9 個還是彼此重複)。
--       前端「門市設定」顯示「本店 + 全域(null)」→ 這 18 個疊在每家自己的清單上，
--       造成「所有門市班別都一樣 + 同一班別出現好幾行」。
-- 安全：每家門市都已各自有 store_id 綁定的班別；且排班用「自由文字」存班別名(actual_start/end)，
--       225/234 種用到的班別名根本不在 shift_definitions → 刪全域不影響任何排班/計薪。
--       shift_definitions 僅為排班畫面的快捷按鈕範本。
-- idempotent：刪過再跑刪 0 筆。DELETE 不可逆，但這些是無門市歸屬的冗餘範本。

DELETE FROM public.shift_definitions
 WHERE store_id IS NULL;

-- 刪完各店只剩自己的班別。若某些店班別太少想補標準班（可選、預設不做）：
-- 用該店自己的 store_id 複製，別再灌 store_id=NULL。
