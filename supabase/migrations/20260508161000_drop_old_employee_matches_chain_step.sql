-- ════════════════════════════════════════════════════════════
-- 修 20260508150000 帶來的 ambiguous function bug
--
-- 症狀：LIFF 簽核中心點核准 → 「function public._employee_matches_chain_step(integer, integer) is not unique」
--
-- Root cause：
--   PostgreSQL 函式 signature 不包含 DEFAULT 參數，所以
--   CREATE OR REPLACE FUNCTION ...(INT, INT, INT DEFAULT NULL) 沒有取代
--   舊版 ...(INT, INT) — 而是多建了一個。兩個版本共存 → 兩參數呼叫 ambiguous。
--
-- 修法：DROP 掉舊兩參數版。三參數版（DEFAULT NULL）能兼容兩參數呼叫。
-- ════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public._employee_matches_chain_step(INT, INT);

COMMIT;

NOTIFY pgrst, 'reload schema';
