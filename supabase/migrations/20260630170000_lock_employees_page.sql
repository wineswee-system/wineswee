-- 員工管理頁（/org/employees）改用獨立權限碼 nav.org.employees，
-- 只給 super_admin / admin / manager；
-- office_staff 保留 nav.org.internal（部門/門市仍可看）但不能進員工管理。

INSERT INTO public.permissions (code, name, module, is_active)
VALUES ('nav.org.employees', 'Sidebar：員工管理', '導航', true)
ON CONFLICT (code) DO NOTHING;

-- 只給 super_admin (1)、admin (2)；manager / office_staff 不開
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r, id FROM public.permissions, (VALUES (1),(2)) AS t(r)
 WHERE code = 'nav.org.employees'
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = t.r AND rp.permission_id = permissions.id
   );

NOTIFY pgrst, 'reload schema';
