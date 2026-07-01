-- form_templates 加 super_admin_only 旗標
-- 標記後：在 FormBindingsPicker（綁定選擇）和 TaskFormsTab（填寫狀態列表）
-- 兩處都只對 super_admin 顯示。

ALTER TABLE public.form_templates
  ADD COLUMN IF NOT EXISTS super_admin_only BOOLEAN NOT NULL DEFAULT FALSE;

-- 指定 HR 表單：只有 super_admin 可看
UPDATE public.form_templates
SET super_admin_only = TRUE
WHERE organization_id = 1
  AND name IN (
    '提早下班登記',
    '試用期評核',
    '績效考核',
    '出差申請'
  );

-- 「其他」類別 (category = 'other') 除了人力需求申請，其餘也標 super_admin_only
UPDATE public.form_templates
SET super_admin_only = TRUE
WHERE organization_id = 1
  AND category = 'other'
  AND name <> '人力需求申請'
  AND super_admin_only = FALSE;  -- 避免重複設

NOTIFY pgrst, 'reload schema';
