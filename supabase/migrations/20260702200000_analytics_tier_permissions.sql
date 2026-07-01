-- ════════════════════════════════════════════════════════════════════════════
-- Analytics Tier Permissions (2026-07-02)
--
-- Replaces the hardcoded TIER_1_ROLES / TIER_2_ROLES arrays in
-- AnalyticsRouteGuard.jsx with proper permission codes so analytics access
-- can be managed via the DB like every other permission.
--
--   analytics.tier_1  全部分析頁（舊 TIER_1：admin + manager; super_admin 自動通過）
--   analytics.tier_2  門市相關頁（舊 TIER_2：+ store_staff）
--
-- Note: office_staff is intentionally excluded from both tiers (unchanged
-- from the previous hardcoded behaviour).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('analytics.tier_1', '分析 — 全部分析頁',     '分析報表', true),
  ('analytics.tier_2', '分析 — 門市相關分析頁', '分析報表', true)
ON CONFLICT (code) DO UPDATE SET
  name      = EXCLUDED.name,
  module    = EXCLUDED.module,
  is_active = EXCLUDED.is_active;

-- analytics.tier_1 → super_admin(1), admin(2), manager(3)
-- analytics.tier_2 → super_admin(1), admin(2), manager(3), store_staff(5)
-- (super_admin always passes hasPermission() client-side, but include for completeness)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.code = 'analytics.tier_1'
  AND r.name IN ('super_admin', 'admin', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.code = 'analytics.tier_2'
  AND r.name IN ('super_admin', 'admin', 'manager', 'store_staff')
ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- Verify
-- SELECT r.name, p.code
-- FROM role_permissions rp
-- JOIN roles r ON r.id = rp.role_id
-- JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code IN ('analytics.tier_1', 'analytics.tier_2')
-- ORDER BY p.code, r.level DESC;
-- ════════════════════════════════════════════════════════════════════════════
