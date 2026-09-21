-- 修:非 admin 的簽核人看不到要簽的費用單(非經常性/叫貨/經常性) — 2026-07-09
-- 根因:2026-06-18 RLS 大掃除(20260618100000)把 expense_requests/expenses 的 SELECT policy
--   換成 can_see_request(本人/主管鏈/店長/admin),洗掉了「簽核人可見」→ fixed_emp 指定簽核人
--   (如張庭瑋=財務會簽最後一關)若不在申請人主管鏈且非 admin,就看不到要簽的單(待我簽核撈到 id
--   但前端用她身分過 RLS 撈不到內容)。admin 繞 RLS 所以只有她卡住。
-- 修法:各加一條 permissive SELECT policy「chain 任一 step 上的簽核人/加簽人可見」。
--   RLS 多條 FOR SELECT 是 OR → 純加法,不動既有 can_see_request policy。
--   expense_requests(非經常性+叫貨,同表靠 doc_type 分)用現成 _expense_request_visible(含 settle 鏈);
--   expenses(經常性/報帳)新建 _expense_visible(同款,走 live approval_chain_steps)。
--   兩者比對 live chain(_employee_matches_chain_step),與「待我簽核」RPC 同一套判定,不靠 snapshot
--   (expense 類無 snapshot)。idempotent。

-- ── 經常性費用(expenses)的簽核人可見判定(比照 _expense_request_visible)──
CREATE OR REPLACE FUNCTION public._expense_visible(p_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_emp_id    INT;
  v_role_name TEXT;
  v_exp       expenses;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;

  IF v_role_name IN ('super_admin', 'admin', 'manager') THEN RETURN true; END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_id;
  IF v_exp.id IS NULL THEN RETURN false; END IF;

  IF v_exp.employee_id = v_emp_id THEN RETURN true; END IF;   -- 申請人本人

  -- 簽核鏈任一 step 上的簽核人
  IF v_exp.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs
    WHERE acs.chain_id = v_exp.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_exp.employee_id)
  ) THEN RETURN true; END IF;

  -- 加簽人
  IF EXISTS (
    SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'expenses' AND source_id = p_id AND assignee_id = v_emp_id
  ) THEN RETURN true; END IF;

  RETURN false;
END $function$;

GRANT EXECUTE ON FUNCTION public._expense_visible(integer) TO authenticated, anon;

-- ── 加「簽核人可見」SELECT policy(OR 疊加)──
DROP POLICY IF EXISTS expense_requests_approver_sel ON public.expense_requests;
CREATE POLICY expense_requests_approver_sel ON public.expense_requests
  FOR SELECT USING (public._expense_request_visible(id));

DROP POLICY IF EXISTS expenses_approver_sel ON public.expenses;
CREATE POLICY expenses_approver_sel ON public.expenses
  FOR SELECT USING (public._expense_visible(id));

NOTIFY pgrst, 'reload schema';
