-- 送驗收改走 SECURITY DEFINER RPC — 2026-07-21
-- 症狀:核銷負責人(settle_assignee_id,如部門主管李英顥,非 admin)在費用頁按「送驗收」沒反應。
-- 原因:前端直接 UPDATE expense_requests,RLS 沒放行核銷負責人 → 靜默 0 列、無 error → 像沒反應。
-- 修:submit_expense_settle RPC,把關(核銷負責人 / 未指派時的申請人 / admin)後繞 RLS 更新。
--   狀態→待核銷 會觸發既有 auto_apply_expense_settle_chain 依金額掛核銷鏈。純加新 RPC。

CREATE OR REPLACE FUNCTION public.submit_expense_settle(
  p_id            int,
  p_actual_amount numeric,
  p_notes         text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me       int  := public.current_employee_id();
  v_is_admin bool := public.is_admin();
  v_er       public.expense_requests;
BEGIN
  IF v_me IS NULL AND NOT v_is_admin THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO v_er FROM public.expense_requests WHERE id = p_id;
  IF v_er.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  IF v_er.status NOT IN ('已核准', '核銷已退回') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_SETTLEABLE', 'status', v_er.status);
  END IF;

  -- 把關:核銷負責人 / 未指派時的申請人 / admin（對齊 web_list_my_settle_todos 認定）
  IF NOT (
    v_is_admin
    OR v_er.settle_assignee_id = v_me
    OR (v_er.settle_assignee_id IS NULL AND v_er.employee_id = v_me)
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_SETTLE_OWNER');
  END IF;

  IF p_actual_amount IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AMOUNT_REQUIRED');
  END IF;

  IF v_er.status = '核銷已退回' THEN
    -- 重送:清掉舊核銷鏈,讓 trigger 依新金額重抓
    UPDATE public.expense_requests
       SET actual_amount = p_actual_amount, notes = p_notes, status = '待核銷',
           settle_chain_id = NULL, settle_current_step = 0, settle_reject_reason = NULL,
           settled_by = NULL, settled_at = NULL
     WHERE id = p_id;
  ELSE
    UPDATE public.expense_requests
       SET actual_amount = p_actual_amount, notes = p_notes, status = '待核銷'
     WHERE id = p_id;
  END IF;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.submit_expense_settle(int, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
