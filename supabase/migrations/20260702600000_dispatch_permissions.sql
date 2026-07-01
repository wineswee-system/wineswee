-- ════════════════════════════════════════════════════════════
-- Dispatch Module — RBAC Permissions
-- 2026-07-02
--
-- Adds 2 permissions for the dispatch module:
--   dispatch.view   — see dispatch dashboard, queue, routes, tracking
--   dispatch.manage — create/assign jobs, manage fleet, run routes
--
-- Role assignments:
--   super_admin (1) — full (view + manage)
--   admin       (2) — full (view + manage)
--   manager     (3) — full (view + manage)
--   office_staff(4) — view only (read-only access to dispatch)
--   store_staff (5) — none
-- ════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('dispatch.view',   '查看物流調度',   '物流調度', true),
  ('dispatch.manage', '管理物流調度',   '物流調度', true)
ON CONFLICT (code) DO NOTHING;

-- super_admin: view + manage
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 1, id FROM public.permissions
 WHERE code IN ('dispatch.view', 'dispatch.manage')
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 1 AND rp.permission_id = permissions.id
   );

-- admin: view + manage
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 2, id FROM public.permissions
 WHERE code IN ('dispatch.view', 'dispatch.manage')
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 2 AND rp.permission_id = permissions.id
   );

-- manager: view + manage
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 3, id FROM public.permissions
 WHERE code IN ('dispatch.view', 'dispatch.manage')
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 3 AND rp.permission_id = permissions.id
   );

-- office_staff: view only
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 4, id FROM public.permissions
 WHERE code = 'dispatch.view'
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 4 AND rp.permission_id = permissions.id
   );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- Verify:
-- SELECT r.name, p.code
--   FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code LIKE 'dispatch.%'
--  ORDER BY r.level DESC, p.code;
-- ════════════════════════════════════════════════════════════
