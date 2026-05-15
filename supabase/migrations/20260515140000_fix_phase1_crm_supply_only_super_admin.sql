-- ════════════════════════════════════════════════════════════
-- 修 Phase 1 過度授權：CRM / 供應鏈 改成只給 super_admin
-- 2026-05-15
--
-- 問題：Phase 1 migration (20260515130000) 把 nav.group.crm /
--   nav.group.supply 灌給了 admin / manager，但原本 ROLE_GROUPS
--   只有 super_admin 看得到這兩個 group（且這兩個 module 都還沒交付）。
--
-- 修正：DELETE 掉 admin 跟 manager 的這兩個 perm，
--   只留 super_admin（廠商 debug 用）。
-- ════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM public.role_permissions
 WHERE role_id IN (2, 3)  -- admin, manager
   AND permission_id IN (
     SELECT id FROM public.permissions
      WHERE code IN ('nav.group.crm', 'nav.group.supply')
   );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 驗證：
-- SELECT r.name, p.code FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code IN ('nav.group.crm', 'nav.group.supply')
--  ORDER BY r.id;
-- 期待只有 super_admin 出現
