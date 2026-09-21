-- ════════════════════════════════════════════════════════════
-- 隱藏「採購」模組權限（未交付）
-- 2026-05-15
--
-- 跟 CRM / 倉儲 / 財務 一樣，採購模組也尚未交付給客戶，
-- 不應出現在 admin 權限頁。
--
-- 交付時:
--   UPDATE permissions SET is_active = true WHERE module = '採購';
-- ════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.permissions
   SET is_active = false
 WHERE module = '採購';

COMMIT;

-- 驗證：目前未交付模組總清單
-- SELECT module, COUNT(*) FROM permissions WHERE is_active = false GROUP BY module;
