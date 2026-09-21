-- ════════════════════════════════════════════════════════════════════════════
-- 核銷(驗收)人能在 Web 看到待他核銷的單
-- 2026-06-24
--
-- expense_requests SELECT RLS 原本:本人/主管鏈/店長/admin/expense.view_all。
-- 核銷人(settle_assignee_id,通過後 trigger 寫入)不一定在上述任一 → Web 清單看不到。
-- 加一條 permissive SELECT policy:settle_assignee_id = 我 → 放行(RLS 多條 SELECT 是 OR)。
-- 純加法,不動既有 policy。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS expense_requests_settle_assignee_sel ON public.expense_requests;
CREATE POLICY expense_requests_settle_assignee_sel ON public.expense_requests
  FOR SELECT TO authenticated
  USING (settle_assignee_id = public.current_employee_id());

NOTIFY pgrst, 'reload schema';
