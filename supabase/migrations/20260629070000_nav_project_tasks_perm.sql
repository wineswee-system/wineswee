-- ── 任務頁獨立權限碼 nav.project.tasks ─────────────────────────────────────
-- 讓「任務」可在權限頁個別開關，預設 admin+ 才看得到
-- （之前共用 nav.project.work 連 manager/staff 都看得到）

-- 1. 新增權限碼（idempotent）
INSERT INTO public.permissions (code, name, module, is_active)
VALUES ('nav.project.tasks', 'Sidebar：任務管理', '導航', true)
ON CONFLICT (code) DO NOTHING;

-- 2. 預設授予 super_admin（1）+ admin（2）
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM (VALUES (1), (2)) AS rp(role_id)
CROSS JOIN public.permissions p
WHERE p.code = 'nav.project.tasks'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
     WHERE x.role_id = rp.role_id AND x.permission_id = p.id
  );

NOTIFY pgrst, 'reload schema';
