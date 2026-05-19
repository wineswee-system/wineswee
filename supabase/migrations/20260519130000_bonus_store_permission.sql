-- ════════════════════════════════════════════════════════════════════════════
-- 新增「門市業績獎金」業務權限
-- ────────────────────────────────────────────────────────────────────────────
-- 設計：
--   - 新增 bonus.store.compute（計算/編輯門市業績獎金，跟既有 bonus.compute
--     的「績效獎金」拆開）
--   - 只 grant 給 super_admin + admin
--   - manager 不能進（業務上店長只能透過 LIFF/薪資頁查自己的，不該管整店獎金）
--   - office_staff / store_staff 同樣不能進
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. 新增 permission
INSERT INTO public.permissions (code, label, module, is_active)
VALUES ('bonus.store.compute', '計算 / 編輯門市業績獎金', '薪酬與福利', true)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  module = EXCLUDED.module,
  is_active = EXCLUDED.is_active;

-- 2. grant 給 super_admin (role_id=1) + admin (role_id=2)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.code = 'bonus.store.compute'
ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
