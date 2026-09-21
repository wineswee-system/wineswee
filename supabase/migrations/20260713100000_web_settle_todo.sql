-- Web 儀表板「待送驗收」— 驗收負責人看得到自己要送的驗收單 — 2026-07-13
-- 背景:申請核准後驗收負責人(settle_assignee_id=驗收單位主管)要去送驗收單,但此時 settle_chain
--   還沒建、他不是任何 chain 簽核人 → _expense_request_visible 沒涵蓋他 → Web RLS 看不到自己的單
--   (LIFF 能看是因 liff_list_expense_requests 是 SECURITY DEFINER 繞 RLS)。
-- 做法:① 加一條 RLS SELECT policy:settle_assignee = 我 → 看得到(點過去送驗收才開得起來);
--       ② RPC web_list_my_settle_todos() 給儀表板「待送驗收」tab 撈清單(與簽核分開)。
-- 純加法、idempotent。

-- ① 驗收負責人可見自己的單
DROP POLICY IF EXISTS expense_requests_settle_assignee_sel ON public.expense_requests;
CREATE POLICY expense_requests_settle_assignee_sel ON public.expense_requests
  FOR SELECT USING (settle_assignee_id = public.current_employee_id());

-- ② 待送驗收清單(status=已核准/核銷已退回 且 我是驗收負責人;無指定則申請人自己送)
CREATE OR REPLACE FUNCTION public.web_list_my_settle_todos()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_me int := current_employee_id();
BEGIN
  IF v_me IS NULL THEN RETURN '[]'::json; END IF;
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id',               er.id,
      'doc_type',         COALESCE(er.doc_type, 'expense'),
      'title',            er.title,
      'estimated_amount', er.estimated_amount,
      'employee',         er.employee,
      'status',           er.status,
      'settle_unit', CASE
        WHEN er.settle_store_id IS NOT NULL
          THEN (SELECT name FROM stores WHERE id = er.settle_store_id)
        WHEN er.settle_department_id IS NOT NULL
          THEN (SELECT name FROM departments WHERE id = er.settle_department_id)
        ELSE NULL END
    ) ORDER BY er.id DESC)
    FROM expense_requests er
    WHERE er.status IN ('已核准', '核銷已退回')
      AND er.deleted_at IS NULL
      AND (
        er.settle_assignee_id = v_me
        OR (er.settle_assignee_id IS NULL AND er.employee_id = v_me)
      )
  ), '[]'::json);
END $function$;

GRANT EXECUTE ON FUNCTION public.web_list_my_settle_todos() TO authenticated;
NOTIFY pgrst, 'reload schema';
