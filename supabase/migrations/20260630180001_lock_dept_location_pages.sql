-- 部門（/org/departments）和門市（/org/locations）改用獨立權限碼，
-- 只給 super_admin / admin（同員工管理邏輯）。

INSERT INTO public.permissions (code, name, module, is_active)
VALUES
  ('nav.org.departments', 'Sidebar：部門管理', '導航', true),
  ('nav.org.locations',   'Sidebar：門市管理', '導航', true)
ON CONFLICT (code) DO NOTHING;

-- 只給 super_admin (1)、admin (2)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r, p.id
  FROM public.permissions p, (VALUES (1),(2)) AS t(r)
 WHERE p.code IN ('nav.org.departments', 'nav.org.locations')
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = t.r AND rp.permission_id = p.id
   );

NOTIFY pgrst, 'reload schema';
