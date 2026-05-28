-- 診斷：門市報修單 LIFF 不能填的問題
-- 把全部結果貼回來，可以看出 binding row 跟 template 對不對得起來

-- 1) 全部 task_form_bindings 含「報修」字樣
SELECT id, task_id, form_type, form_template_id, form_label, form_id, status, required_status, created_at
FROM public.task_form_bindings
WHERE form_label LIKE '%報修%' OR form_label LIKE '%門市%'
ORDER BY id DESC
LIMIT 10;

-- 2) form_templates 含「報修」字樣（看 scope 對不對 + is_active）
SELECT id, name, scope, is_active, created_at
FROM public.form_templates
WHERE name LIKE '%報修%' OR name LIKE '%門市%'
ORDER BY id DESC
LIMIT 10;

-- 3) 你最新一張申請的單（看是不是有寫到 form_submissions 但沒回填 binding）
SELECT id, template_id, applicant_id, status, linked_binding_id, created_at
FROM public.form_submissions
ORDER BY created_at DESC
LIMIT 5;
