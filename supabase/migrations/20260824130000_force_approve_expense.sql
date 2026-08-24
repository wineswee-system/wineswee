-- 費用查詢:admin 壓單(強制通過)用的費用專用 RPC + expenses 補軟刪欄(抽單用)。
-- 涵蓋 expense_requests(非經常性/叫貨)與 expenses(經常性報銷)。
-- 已駁回的不放行(尊重 _guard_expense_reject_no_approve 防復活,要走重新送出);核准時清 reject_reason 並留稽核。

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS deleted_by integer;

CREATE OR REPLACE FUNCTION public.force_approve_expense(p_source text, p_id integer, p_reason text, p_actor_id integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller employees; v_status text; v_org int; v_chain int; v_cur int; v_total int; v_note text;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN SELECT * INTO v_caller FROM employees WHERE id = p_actor_id; END IF;
  IF v_caller.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND'); END IF;
  IF v_caller.role NOT IN ('admin', 'super_admin') THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED'); END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED'); END IF;
  v_note := '強制通過（管理員）：' || p_reason;

  IF p_source = 'expense_requests' THEN
    SELECT approval_chain_id, current_step, status, organization_id
      INTO v_chain, v_cur, v_status, v_org FROM public.expense_requests WHERE id = p_id AND deleted_at IS NULL;
    IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
    IF v_status = '已核准' THEN RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_APPROVED'); END IF;
    IF v_status IN ('已駁回', '已退回', '已拒絕') THEN RETURN jsonb_build_object('ok', false, 'error', 'REJECTED_NEEDS_RESUBMIT'); END IF;
    SELECT count(*) INTO v_total FROM public.approval_chain_steps WHERE chain_id = v_chain;
    PERFORM set_config('app.ash_approver_id', v_caller.id::text, true);
    UPDATE public.expense_requests
       SET status = '已核准', current_step = GREATEST(COALESCE(current_step, 0), v_total),
           approved_by = v_caller.name, approved_at = NOW(), reject_reason = NULL
     WHERE id = p_id;
    INSERT INTO public.approval_step_history
      (request_type, request_id, organization_id, chain_id, step_order, step_label, entered_at, exited_at, action, approver_id, approver_name, notes)
    VALUES ('expense_request', p_id, v_org, v_chain, COALESCE(v_cur, 0), '強制通過', NOW(), NOW(), 'approved', v_caller.id, v_caller.name, v_note);
    RETURN jsonb_build_object('ok', true, 'status', '已核准');

  ELSIF p_source = 'expenses' THEN
    SELECT status, organization_id INTO v_status, v_org FROM public.expenses WHERE id = p_id AND deleted_at IS NULL;
    IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
    IF v_status = '已核銷' THEN RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_APPROVED'); END IF;
    IF v_status IN ('已駁回', '已退回', '已拒絕') THEN RETURN jsonb_build_object('ok', false, 'error', 'REJECTED_NEEDS_RESUBMIT'); END IF;
    UPDATE public.expenses
       SET status = '已核銷', approved_by = v_caller.name, approver = COALESCE(approver, v_caller.name), reject_reason = NULL
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', '已核銷');
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SOURCE');
END $function$;

REVOKE ALL ON FUNCTION public.force_approve_expense(text, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_approve_expense(text, integer, text, integer) TO authenticated;
