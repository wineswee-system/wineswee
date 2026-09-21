-- 經常性費用「檢視全部人」:有 expense.recurring_view 就看得到全公司報帳 — 2026-07-09
-- 需求:某些人(非 admin)只看得到自己送的 + 要驗收的 expenses;要讓他看到全部人的單。
-- 做法:比照 expense_requests_viewall_sel(20260624180000)——expenses 多一條 permissive
--   SELECT policy「有此權限就放行(限本租戶)」。RLS 多條 FOR SELECT 是 OR,不動既有
--   自己/驗收人/主管鏈 的 policy。前端 getExpenses 無寫死 filter,純靠 RLS → 不用改前端。
-- 純加法、idempotent。org 範圍鎖本租戶,避免跨公司外洩。

DROP POLICY IF EXISTS expenses_viewall_sel ON public.expenses;
CREATE POLICY expenses_viewall_sel ON public.expenses
  FOR SELECT USING (
    public.current_employee_has_permission('expense.recurring_view')
    AND organization_id = public.current_employee_org()
  );

NOTIFY pgrst, 'reload schema';
