-- 投保級距表收斂成 admin 以上:移除 manager/office_staff
DELETE FROM public.role_permissions rp
USING public.permissions p, public.roles r
WHERE rp.permission_id = p.id AND rp.role_id = r.id
  AND p.code = 'nav.entry.hr.insurance-brackets'
  AND r.name IN ('manager', 'office_staff');
