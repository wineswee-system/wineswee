-- 驗收(核銷)送出後、還沒人簽核前可編輯 — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:申請人 10:28 送了驗收單直接進驗收鏈(停第一關),送錯金額/備註/收據沒得改,
--   只能等簽核人「退回」→ 重送。加一支 RPC 讓「還沒人簽」時本人能就地修。
-- Gate(對齊申請階段 liff_update_expense_request 的 current_step=0 概念):
--   status='待核銷' AND settle_current_step=0(第一關待簽=沒人簽過)
--   AND 呼叫者 = 核銷負責人 / 未指派時的申請人 / admin(對齊 submit_expense_settle)
-- 只改 actual_amount + notes(收據附件走前端既有 uploadFiles stage='settlement')。
-- ★ 不重挑 chain:維持同一條驗收鏈(避免換鏈→要重通知第一關的複雜度)。
--   若金額大改到需換不同金額級距的鏈,請走「簽核人退回 → 重送驗收單」(submit_expense_settle 會清鏈重挑)。
-- 純加新 RPC,不動 submit_expense_settle / expense_settle_step_advance / 任何 trigger。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_pending_settle(
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

  -- 只能在「待核銷 + 第一關還沒人簽」時改
  IF v_er.status <> '待核銷' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_SETTLE', 'status', v_er.status);
  END IF;
  IF COALESCE(v_er.settle_current_step, 0) <> 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_SIGNED');
  END IF;

  -- 把關:核銷負責人 / 未指派時的申請人 / admin
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

  UPDATE public.expense_requests
     SET actual_amount = p_actual_amount,
         notes         = p_notes,
         updated_at    = now()
   WHERE id = p_id;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.update_pending_settle(int, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
