-- 權限:經常性費用 (expense.recurring_view / expense.recurring_approve) — 2026-07-08
-- 需求:權限頁「行政庶務」加一列「經常性費用」(查詢+審核),比照現有「費用申請審核」。
-- 說明:比照 expense.view/approve —— 這些是權限頁的管理列;經常性費用報銷(expenses)的
--   實際簽核走 canApprove 動態鏈、刪除走 hr_form.delete_all,故此列與現有 expense 列同性質。
-- 純加法、idempotent。預設給 super_admin/admin/manager(對齊 expense.view/expense.approve)。

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('expense.recurring_view',    '查看經常性費用列表', '行政庶務', true),
  ('expense.recurring_approve', '審核經常性費用報銷', '行政庶務', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, module = EXCLUDED.module, is_active = EXCLUDED.is_active;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
  AND p.code IN ('expense.recurring_view', 'expense.recurring_approve')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
