-- ════════════════════════════════════════════════════════════
-- Phase 1：建立 Sidebar Navigation 權限對照
-- 2026-05-15
--
-- 目標：把 Sidebar.jsx 寫死的 ROLE_ALLOWED_PATHS 邏輯
--      改成 DB-driven perm 系統。
--
-- ★ 本 migration 只「灌資料」，不動 Sidebar.jsx
-- ★ Phase 2 才會把 Sidebar 切換到 perm 判斷
-- ★ 灌的 role_permissions 跟現在 ROLE_ALLOWED_PATHS 一模一樣
--   → 即便提早 ship Phase 2，行為也跟今天等同（向下相容）
--
-- 設計：17 個 nav.* perm 覆蓋 4 個 tier 的差異化
--   Tier 1（全員可見）：個人 HR 功能 → 不設 perm（一律顯示）
--   Tier 2（office_staff+）：薪資查看 / 排班 / 內部資料 / 流程基本
--   Tier 3（manager+）：完整薪酬 / 人才 / 行政 / CRM / 供應鏈
--   Tier 4（admin+）：系統 / 分析 / 簽核設定
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 新增 17 個 nav.* perm ═══
INSERT INTO public.permissions (code, name, module, is_active) VALUES
  -- ── 群組層級（決定 sidebar 大分類是否顯示）──
  ('nav.group.crm',          'Sidebar：CRM 群組',          '導航', false),  -- 未交付
  ('nav.group.supply',       'Sidebar：供應鏈群組',        '導航', false),  -- 未交付
  ('nav.group.analytics',    'Sidebar：分析群組',          '導航', true),
  ('nav.group.system',       'Sidebar：系統群組',          '導航', true),
  ('nav.group.super_admin',  'Sidebar：超管群組',          '導航', true),

  -- ── people group 內細項（決定 sidebar section 是否顯示）──
  ('nav.org.full',           'Sidebar：組織完整管理（總覽/組織/公司/組織圖）', '導航', true),
  ('nav.org.internal',       'Sidebar：組織內部資料（員工/部門/門市）',         '導航', true),
  ('nav.schedule.basic',     'Sidebar：排班與假日',        '導航', true),
  ('nav.schedule.config',    'Sidebar：排班規則 / 工時設定','導航', true),
  ('nav.salary.basic',       'Sidebar：薪資查看與發放',    '導航', true),
  ('nav.salary.advanced',    'Sidebar：進階薪資（資遣/法扣/績效）','導航', true),
  ('nav.salary.law',         'Sidebar：法令工資設定',      '導航', true),
  ('nav.talent',             'Sidebar：人才發展',          '導航', true),
  ('nav.experience_mgr',     'Sidebar：員工體驗管理',      '導航', true),
  ('nav.admin_office',       'Sidebar：行政庶務',          '導航', true),
  ('nav.hr_form.builder',    'Sidebar：表單建立器',        '導航', true),

  -- ── project group 內細項 ──
  ('nav.project.work',       'Sidebar：專案工作管理（總覽/任務/流程）', '導航', true),
  ('nav.project.admin',      'Sidebar：專案設定 / AI 助理','導航', true);


-- ═══ 2. role_permissions 補進 nav.* perm（對齊 ROLE_ALLOWED_PATHS 現行行為）═══

-- super_admin: 全部
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 1, id FROM public.permissions
 WHERE code LIKE 'nav.%'
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 1 AND rp.permission_id = permissions.id
   );

-- admin: 全部 nav.* 除了 super_admin 專屬
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 2, id FROM public.permissions
 WHERE code IN (
   'nav.group.crm', 'nav.group.supply', 'nav.group.analytics', 'nav.group.system',
   'nav.org.full', 'nav.org.internal',
   'nav.schedule.basic', 'nav.schedule.config',
   'nav.salary.basic', 'nav.salary.advanced', 'nav.salary.law',
   'nav.talent', 'nav.experience_mgr', 'nav.admin_office',
   'nav.hr_form.builder',
   'nav.project.work', 'nav.project.admin'
 )
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 2 AND rp.permission_id = permissions.id
   );

-- manager: Tier 2 + Tier 3 (不含 schedule.config / admin 專屬的)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 3, id FROM public.permissions
 WHERE code IN (
   'nav.group.crm', 'nav.group.supply',                  -- 看得到 CRM/供應鏈
   'nav.org.full', 'nav.org.internal',                   -- 看得到完整組織
   'nav.schedule.basic',                                  -- 排班/假日
   'nav.salary.basic', 'nav.salary.advanced', 'nav.salary.law',  -- 全薪酬區塊
   'nav.talent', 'nav.experience_mgr', 'nav.admin_office',
   'nav.hr_form.builder',
   'nav.project.work'                                     -- 不含 project.admin (簽核設定)
 )
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 3 AND rp.permission_id = permissions.id
   );

-- office_staff: Tier 2（對齊現行 ROLE_ALLOWED_PATHS）
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 4, id FROM public.permissions
 WHERE code IN (
   'nav.org.internal',          -- /org/employees, /org/departments, /org/locations
   'nav.schedule.basic',         -- /hr/schedule, /hr/holidays
   'nav.salary.basic',           -- /hr/salary, /hr/salary-structures, /hr/payroll
   'nav.salary.law',             -- /hr/labor-law-rates, /hr/insurance-grade
   'nav.project.work'            -- /process/overview, /tasks, /workflows
 )
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 4 AND rp.permission_id = permissions.id
   );

-- store_staff: 不給 nav.* 任何 perm（只看 Tier 1 不設 perm 的個人 HR）


COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- 驗證：各角色拿到的 nav.* perm
-- SELECT r.name AS role, COUNT(*) AS nav_perm_count
--   FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code LIKE 'nav.%'
--  GROUP BY r.name ORDER BY nav_perm_count DESC;
--
-- 期待結果：
--   super_admin: 17 (全部)
--   admin:       17
--   manager:     13 (排除 schedule.config / project.admin / analytics / system / super_admin)
--   office_staff: 5
--   store_staff:  0
-- ════════════════════════════════════════════════════════════
