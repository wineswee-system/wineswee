-- ── 補打卡編輯權限 clock.correction_edit ─────────────────────────────────────
-- 預設 admin/super_admin 可編輯任意員工的補打卡申請
-- 一般員工仍可編輯自己的申請（前端靠 c.employee === profile.name 判斷）

-- 1. 新增權限碼（idempotent）
INSERT INTO public.permissions (code, name, module, is_active)
VALUES ('clock.correction_edit', '補打卡編輯（任意員工）', '出勤與請假', true)
ON CONFLICT (code) DO NOTHING;

-- 2. 預設授予 super_admin（1）+ admin（2）
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM (VALUES (1), (2)) AS rp(role_id)
CROSS JOIN public.permissions p
WHERE p.code = 'clock.correction_edit'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
     WHERE x.role_id = rp.role_id AND x.permission_id = p.id
  );

NOTIFY pgrst, 'reload schema';
