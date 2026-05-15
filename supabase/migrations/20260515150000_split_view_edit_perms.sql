-- ════════════════════════════════════════════════════════════
-- 「查詢/修改」分離：補缺少的查詢 perm
-- 2026-05-15
--
-- 需求：權限頁照 104 樣式，每個主功能拆成「查詢」「修改」兩個 toggle
--   - 查詢 ON = 看得到，不能改
--   - 修改 ON = 看得到 + 可以改（自動帶上查詢）
--
-- 目前許多 perm 只有「修改/動作」版本，沒有獨立「查詢」。
-- 補齊以下 view perm：
--
--   hr_form.view       — 看 HR 表單（離職/留停/異動）待簽列表
--   expense.view       — 看費用申請列表（不能審核）
--   expense.settle_view — 看核銷單列表（不能核銷）
--   expense.account_view — 看會計科目
--   severance.view     — 看資遣紀錄
--   legal_deduction.view — 看法扣紀錄
--   bonus.view         — 看績效獎金
--   insurance_rate.view — 看勞健保級距
--   approval_chain.view — 看簽核鏈設定
--   recruit.view       — 看招募進度
--   training.view      — 看教育訓練紀錄
--   probation.view     — 看試用期評核
--   project.view       — 看專案
--   doc.view           — 看文件列表（doc.delete 已有，但 view 需求等同）
--   system.user_view   — 看使用者列表（不能改角色）
--   system.permission_view — 看員工權限設定（不能改）
--
-- 這些 view perm 預設給 manager+（跟對應 edit perm 的預設一致或略寬）
-- ════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('hr_form.view',          '查看 HR 表單待簽列表',         'HR 表單', true),
  ('expense.view',          '查看費用申請列表',             '行政庶務', true),
  ('expense.settle_view',   '查看費用核銷列表',             '行政庶務', true),
  ('expense.account_view',  '查看會計科目',                 '行政庶務', true),
  ('severance.view',        '查看資遣紀錄',                 '薪酬與福利', true),
  ('legal_deduction.view',  '查看法扣紀錄',                 '薪酬與福利', true),
  ('bonus.view',            '查看績效獎金',                 '薪酬與福利', true),
  ('insurance_rate.view',   '查看勞健保級距',               '薪酬與福利', true),
  ('approval_chain.view',   '查看簽核鏈設定',               '專案流程', true),
  ('recruit.view',          '查看招募進度',                 '人才發展', true),
  ('training.view',         '查看教育訓練紀錄',             '人才發展', true),
  ('probation.view',        '查看試用期評核',               '人才發展', true),
  ('project.view',          '查看專案',                     '專案流程', true),
  ('doc.view',              '查看文件列表',                 '行政庶務', true),
  ('system.user_view',      '查看使用者列表',               '系統設定', true),
  ('system.permission_view','查看員工權限設定',             '系統設定', true);


-- 對應角色預設 grant
-- super_admin: 全給
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 1, id FROM public.permissions
 WHERE code IN (
   'hr_form.view','expense.view','expense.settle_view','expense.account_view',
   'severance.view','legal_deduction.view','bonus.view','insurance_rate.view',
   'approval_chain.view','recruit.view','training.view','probation.view',
   'project.view','doc.view','system.user_view','system.permission_view'
 )
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 1 AND rp.permission_id = permissions.id
   );

-- admin: 全給（除了 super_admin 專屬，但這批沒有 super-only）
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 2, id FROM public.permissions
 WHERE code IN (
   'hr_form.view','expense.view','expense.settle_view','expense.account_view',
   'severance.view','legal_deduction.view','bonus.view','insurance_rate.view',
   'approval_chain.view','recruit.view','training.view','probation.view',
   'project.view','doc.view','system.user_view','system.permission_view'
 )
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 2 AND rp.permission_id = permissions.id
   );

-- manager: 給能看的（不含系統設定 view）
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 3, id FROM public.permissions
 WHERE code IN (
   'hr_form.view','expense.view','expense.settle_view','expense.account_view',
   'severance.view','legal_deduction.view','bonus.view',
   'approval_chain.view','recruit.view','training.view','probation.view',
   'project.view','doc.view'
 )
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 3 AND rp.permission_id = permissions.id
   );

COMMIT;

NOTIFY pgrst, 'reload schema';
