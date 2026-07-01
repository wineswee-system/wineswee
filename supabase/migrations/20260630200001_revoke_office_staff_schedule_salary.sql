-- office_staff 不需要看排班管理 / 薪酬管理，撤掉這兩個 nav perm。
-- 撤後 office_staff 仍保留：
--   nav.org.internal（員工/部門/門市列表）
--   nav.salary.law（法令工資/健保級距，合規查看）
--   nav.project.work（專案流程）
--   所有無 gate 的個人 HR（打卡/請假/補休/HR表單中心/我的提交）

DELETE FROM public.role_permissions
 WHERE role_id = 4
   AND permission_id IN (
     SELECT id FROM public.permissions
      WHERE code IN ('nav.schedule.basic', 'nav.salary.basic')
   );

NOTIFY pgrst, 'reload schema';
