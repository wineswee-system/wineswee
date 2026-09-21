-- 補建「測驗批閱」逐入口權限 nav.entry.lms.review
-- 症狀:sidebar 有此入口(navEntryCode('/lms/review')='nav.entry.lms.review'),
--       但 permissions 表從未建立此碼 → navLive 下 admin 過不了(super_admin 靠繞過看得到),
--       且權限頁的開關無 permission_id 可綁。
-- 修法:比照課程管理(nav.entry.lms.admin, id 313)建立權限,並預設發給 admin/super_admin。
--       建立後,權限頁「人員組織 · 測驗批閱」開關即可逐人開通(非 admin 的訓練負責人亦可)。

INSERT INTO permissions (code, name, module, is_system, is_active)
SELECT 'nav.entry.lms.review', '人員組織 · 測驗批閱', '導航 · 人員組織', true, true
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'nav.entry.lms.review');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code = 'nav.entry.lms.review'
  AND r.name IN ('admin', 'super_admin')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
