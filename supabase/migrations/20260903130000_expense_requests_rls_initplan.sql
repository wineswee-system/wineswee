-- 效能:expense_requests 列表(常被呼叫、700-1200ms)慢在 RLS 政策的「當關使用者函式」每列重算。
-- 把 is_super_admin / current_employee_has_permission / current_employee_org / current_employee_id
-- 包成 (SELECT ...) → Postgres 當 InitPlan 算一次(非逐列),語意不變(STABLE 函式)。
-- 逐列相關的政策(can_see_request(employee_id) / _expense_request_visible(id))維持不動。
-- 參考:project_rls_initplan_perf_pattern(同手法曾 1096ms→7ms)。

ALTER POLICY expense_requests_viewall_sel ON public.expense_requests
  USING ((SELECT public.is_super_admin())
         OR ((SELECT public.current_employee_has_permission('expense.view_all'))
             AND organization_id = (SELECT public.current_employee_org())));

ALTER POLICY expense_requests_order_viewall_sel ON public.expense_requests
  USING (doc_type = 'order'
         AND (SELECT public.current_employee_has_permission('order.view_all'))
         AND organization_id = (SELECT public.current_employee_org()));

ALTER POLICY expense_requests_settle_assignee_sel ON public.expense_requests
  USING (settle_assignee_id = (SELECT public.current_employee_id()));
