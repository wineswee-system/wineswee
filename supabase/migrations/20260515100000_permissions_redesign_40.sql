-- ════════════════════════════════════════════════════════════
-- 權限表全面重構：15 → 40 個權限（A 方案：砍重建）
-- 2026-05-15
--
-- 依 104 設計法則：大分類 → 主功能 → 細項動作
-- 「查看自己」不入表（預設給）；scope 用獨立 perm；只標敏感動作
--
-- 共 10 分類：
--   組織架構 / 出勤與請假 / 排班管理 / HR 表單 / 薪酬與福利 /
--   人才發展 / 員工體驗 / 行政庶務 / 專案流程 / 系統設定
--
-- 兼容性：保留 4 個還在被前端引用的舊 code (finance.view / finance.edit /
--   audit.view / system.admin)，這 4 個 code 不會變，前端 0 改動。
--
-- 其他 11 個舊 code 都沒人 hardcode 引用過，砍掉沒影響。
--
-- is_active 規則：
--   - 已交付 module → true
--   - 未交付 (CRM / 倉儲 / 採購 / 財務) → false（admin 看不到，super_admin 看得到）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 砍掉舊 role_permissions + employee_permissions + permissions ═══
-- TRUNCATE CASCADE 會自動清光 FK 關聯的表
TRUNCATE public.permissions RESTART IDENTITY CASCADE;


-- ═══ 2. 重新塞 40 個權限 ═══
INSERT INTO public.permissions (code, name, module, is_active) VALUES
  -- ── 1. 組織架構（5）──
  ('org.employee.view',       '查看員工基本資料',                   '組織架構', true),
  ('org.employee.view_full',  '查看完整個資（薪資/身分證/聯絡）',   '組織架構', true),
  ('org.employee.edit',       '編輯員工資料',                       '組織架構', true),
  ('org.employee.delete',     '刪除員工 / 標離職',                  '組織架構', true),
  ('org.structure.edit',      '編輯部門 / 門市 / 組織架構',         '組織架構', true),

  -- ── 2. 出勤與請假（6）──
  ('attendance.view_all',     '查看全公司打卡',                     '出勤與請假', true),
  ('attendance.edit',         '編輯 / 補登打卡',                    '出勤與請假', true),
  ('leave.approve',           '審核假單',                           '出勤與請假', true),
  ('ot.approve',              '審核加班',                           '出勤與請假', true),
  ('trip.approve',            '審核出差',                           '出勤與請假', true),
  ('leave_type.edit',         '編輯假別設定 / 額度',                '出勤與請假', true),

  -- ── 3. 排班管理（4）──
  ('schedule.view_all',       '查看全公司班表',                     '排班管理', true),
  ('schedule.edit',           '編輯排班',                           '排班管理', true),
  ('schedule.algo',           '執行排班演算法',                     '排班管理', true),
  ('schedule.rule_edit',      '編輯排班規則 / 班別',                '排班管理', true),

  -- ── 4. HR 表單（2）──
  ('hr_form.approve',         '審核 HR 表單（離職 / 留停 / 異動）', 'HR 表單', true),
  ('hr_form.template_edit',   '建立 / 編輯表單範本',                'HR 表單', true),

  -- ── 5. 薪酬與福利 ⭐ 高敏感（9）──
  ('salary.view_dept',        '查看部門薪資',                       '薪酬與福利', true),
  ('salary.view_all',         '查看全公司薪資',                     '薪酬與福利', true),
  ('salary.edit',             '編輯薪資結構',                       '薪酬與福利', true),
  ('salary.compute',          '執行批次計薪',                       '薪酬與福利', true),
  ('salary.pay',              '執行薪資發放',                       '薪酬與福利', true),
  ('severance.execute',       '執行資遣作業',                       '薪酬與福利', true),
  ('legal_deduction.edit',    '編輯法扣',                           '薪酬與福利', true),
  ('bonus.compute',           '計算 / 編輯績效獎金',                '薪酬與福利', true),
  ('insurance_rate.edit',     '編輯勞健保級距',                     '薪酬與福利', true),

  -- ── 6. 人才發展（3）──
  ('recruit.manage',          '招募管理（履歷 / offer）',           '人才發展', true),
  ('training.manage',         '教育訓練編輯',                       '人才發展', true),
  ('probation.evaluate',      '試用期評核',                         '人才發展', true),

  -- ── 7. 員工體驗（2）──
  ('survey.view_result',      '查看滿意度調查結果',                 '員工體驗', true),
  ('ai_attrition.view',       '查看 AI 離職預測',                   '員工體驗', true),

  -- ── 8. 行政庶務（4）──
  ('expense.approve',         '審核費用申請',                       '行政庶務', true),
  ('expense.settle',          '核銷費用（審核實際花費 / 撥款）',    '行政庶務', true),
  ('expense.account_edit',    '編輯會計科目',                       '行政庶務', true),
  ('doc.delete',              '刪除文件',                           '行政庶務', true),

  -- ── 9. 專案流程（3）──
  ('project.manage',          '編輯專案',                           '專案流程', true),
  ('task.assign',             '指派任務',                           '專案流程', true),
  ('approval_chain.edit',     '編輯簽核鏈設定',                     '專案流程', true),

  -- ── 10. 系統設定 ⭐ 最高敏感（4 個新 + 1 個前端兼容）──
  ('system.user_manage',      '使用者管理（改角色）',               '系統設定', true),
  ('system.permission_manage','員工個別權限管理',                   '系統設定', true),
  ('audit.view',              '查看操作紀錄',                       '系統設定', true),  -- ★ 保留舊 code (App.jsx /analytics)
  ('system.admin',            '編輯系統設定',                       '系統設定', true),  -- ★ 保留舊 code (App.jsx /system)
  ('system.tenant_manage',    '租戶管理',                           '系統設定', true),

  -- ── X. 未交付模組（4 個前端兼容 + 預留位）──
  -- finance.view / finance.edit 還在被 App.jsx + Expenses.jsx 引用，保留 code
  -- is_active=false → admin 看不到，但 hasPermission() 查得到（回 false 給 caller，畫面也不顯示）
  ('finance.view',            '查看財務（未交付）',                 '財務', false),
  ('finance.edit',            '編輯傳票（未交付）',                 '財務', false);


-- ═══ 3. role_permissions 重新對應 ═══
-- super_admin: 全部
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 1, id FROM public.permissions;

-- admin: 大部分敏感操作，除了 super_admin 專屬
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 2, id FROM public.permissions
 WHERE code IN (
   'org.employee.view', 'org.employee.view_full', 'org.employee.edit', 'org.employee.delete',
   'org.structure.edit',
   'attendance.view_all', 'attendance.edit',
   'leave.approve', 'ot.approve', 'trip.approve', 'leave_type.edit',
   'schedule.view_all', 'schedule.edit', 'schedule.algo', 'schedule.rule_edit',
   'hr_form.approve', 'hr_form.template_edit',
   'salary.view_dept', 'salary.view_all', 'salary.edit', 'salary.compute', 'salary.pay',
   'severance.execute', 'legal_deduction.edit', 'bonus.compute',
   'recruit.manage', 'training.manage', 'probation.evaluate',
   'survey.view_result', 'ai_attrition.view',
   'expense.approve', 'expense.settle', 'expense.account_edit', 'doc.delete',
   'project.manage', 'task.assign', 'approval_chain.edit',
   'system.user_manage', 'system.permission_manage', 'audit.view', 'system.admin'
   -- ★ 排除：insurance_rate.edit / system.tenant_manage (super_admin only)
 );

-- manager: 部門範圍內審核 + 編輯排班
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 3, id FROM public.permissions
 WHERE code IN (
   'org.employee.view',
   'leave.approve', 'ot.approve', 'trip.approve',
   'schedule.edit', 'schedule.algo', 'schedule.rule_edit',  -- ★ rule_edit 給 manager
   'hr_form.approve',
   'salary.view_dept',
   'probation.evaluate',
   'expense.approve', 'expense.settle',
   'project.manage', 'task.assign'
 );

-- office_staff: 只能看員工資料（最基本）
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 4, id FROM public.permissions
 WHERE code IN ('org.employee.view');

-- store_staff: 一樣只能看員工資料
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 5, id FROM public.permissions
 WHERE code IN ('org.employee.view');


COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- 驗證
-- SELECT module, COUNT(*) FROM permissions GROUP BY module ORDER BY module;
-- SELECT r.name AS role, COUNT(*) AS perm_count FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id GROUP BY r.name ORDER BY perm_count DESC;
--
-- 緊急 rollback：
-- 沒辦法乾淨 rollback（舊 15 個 perm 已被砍）。
-- 如要回去：
-- 1. TRUNCATE permissions RESTART IDENTITY CASCADE
-- 2. 重塞舊的 15 個（從 20260417000007_rbac_5_roles.sql 抄）
-- ════════════════════════════════════════════════════════════
