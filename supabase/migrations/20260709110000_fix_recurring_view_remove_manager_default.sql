-- 修正:經常性費用「檢視全部人」不該預設給店長(manager) — 2026-07-09
-- 背景:20260708300000 把 expense.recurring_view 預設給 super_admin/admin/manager
--   (當時比照裝飾性的 expense.view/approve)。但 20260709100000 已把此碼接上 RLS
--   「看全公司報帳」→ 變成每個店長自動看到全部人的報帳,過度共享。
-- 修正:比照 expense.view_all(費用申請-檢視全部人,只 super_admin/admin 預設),
--   移除 manager 的角色預設。要看全部的人,在權限頁逐人開(per-person override 不受影響)。
-- expense.recurring_approve(裝飾性、無接線)一併移除 manager 預設,保持該列預設一致。
-- 影響:店長不再「預設」看到全公司報帳;已逐人授權者(override)維持。idempotent。

DELETE FROM public.role_permissions rp
USING public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name = 'manager'
  AND p.code IN ('expense.recurring_view', 'expense.recurring_approve');

NOTIFY pgrst, 'reload schema';
