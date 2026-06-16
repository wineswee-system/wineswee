-- ════════════════════════════════════════════════════════════════════════════
-- 全員開啟「可開店 / 可關店」資格（can_open / can_close = true）
-- 2026-06-16
--
-- 背景：多數門市的開店資格只設了 1 個人 → 排班演算法為了「每天有人開店」被迫天天
--   排那一個人（H3 連續上班超 6 天違規），且他休假當天就無人能開店（S8 警告）。
--   依需求：全員可開可關，讓演算法能輪流排開店、不再壓榨單一員工。
--
-- 變更前狀態：134 位員工中有 41 人 can_open 或 can_close = false
--   （變更前完整名單已備份於 scripts/_canopen_before.json，供日後個別調整/復原參考）。
--
-- idempotent：WHERE 過濾掉已是 true 的列，重跑無副作用。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.employees
   SET can_open = true,
       can_close = true
 WHERE can_open  IS DISTINCT FROM true
    OR can_close IS DISTINCT FROM true;

COMMIT;
