-- 權限:訂購單申請-檢視全部人 (order.view_all) — 2026-07-09
-- 需求:比照經常性費用(expense.recurring_view)的「檢視全部人」,對訂購單申請(叫貨)也做一個。
-- 說明:叫貨/訂購單與非經常性費用同在 expense_requests 表,靠 doc_type 分('order'=叫貨)。
--   加一條 permissive SELECT policy:有 order.view_all 且 doc_type='order' 且同租戶 → 放行看全部訂購單。
--   RLS 多條 SELECT 是 OR,純加法,不動既有 can_see_request / 簽核人可見 / expense.view_all。
-- 預設只給 super_admin/admin(比照 expense.view_all,不給 manager);其餘在權限頁逐人開。idempotent。

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('order.view_all', '訂購單申請-檢視全部人', '行政庶務', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, module = EXCLUDED.module, is_active = EXCLUDED.is_active;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.code = 'order.view_all'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS expense_requests_order_viewall_sel ON public.expense_requests;
CREATE POLICY expense_requests_order_viewall_sel ON public.expense_requests
  FOR SELECT USING (
    doc_type = 'order'
    AND public.current_employee_has_permission('order.view_all')
    AND organization_id = public.current_employee_org()
  );

NOTIFY pgrst, 'reload schema';
