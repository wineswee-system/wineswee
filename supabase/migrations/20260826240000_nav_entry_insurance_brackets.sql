-- 補建「投保級距表」逐入口權限(對齊健保級距監控/法令工資設定),不然 navLive 下看不到
INSERT INTO public.permissions (code, name, module, is_system, is_active)
SELECT 'nav.entry.hr.insurance-brackets', '人員組織 · 投保級距表',
       (SELECT module FROM public.permissions WHERE code='nav.entry.hr.insurance-grade' LIMIT 1), true, true
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE code='nav.entry.hr.insurance-brackets');

-- 發給與「健保級距監控」相同的角色
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p2.id
FROM public.role_permissions rp
JOIN public.permissions p1 ON p1.id=rp.permission_id AND p1.code='nav.entry.hr.insurance-grade'
JOIN public.permissions p2 ON p2.code='nav.entry.hr.insurance-brackets'
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id=rp.role_id AND x.permission_id=p2.id);
