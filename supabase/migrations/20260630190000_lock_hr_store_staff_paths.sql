-- 補 10 個 HR 路徑的 sidebar gate，讓 store_staff 看不到管理功能。
--
-- 現有 perm 重用（不異動 role_permissions，各角色既有授予不變）：
--   nav.schedule.config  → super_admin / admin
--   nav.schedule.basic   → super_admin / admin / manager / office_staff
--   nav.hr_form.builder  → super_admin / admin / manager
--   nav.org.full         → super_admin / admin / manager
--
-- 新增：nav.lms.admin → super_admin / admin 限定
--   covers: /system/offer-letter-templates, /lms/admin

INSERT INTO public.permissions (code, name, module, is_active)
VALUES ('nav.lms.admin', 'Sidebar：LMS 課程管理 / 通知書範本（限 admin）', '導航', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r, p.id
  FROM public.permissions p, (VALUES (1),(2)) AS t(r)
 WHERE p.code = 'nav.lms.admin'
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = t.r AND rp.permission_id = p.id
   );

NOTIFY pgrst, 'reload schema';
