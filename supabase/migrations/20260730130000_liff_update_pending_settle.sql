-- LIFF:驗收(核銷)送出後、還沒人簽核前本人可編輯 — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 對應 web 的 update_pending_settle(20260730120000),改走 line_user_id 解身分。
-- Gate:status='待核銷' AND settle_current_step=0(第一關沒人簽)
--   AND 呼叫者(line_user_id 解出的 emp)= 核銷負責人 / 未指派時的申請人。
-- 只改 actual_amount + notes(收據附件走前端既有 liff_insert_expense_request_attachment)。
-- 不重挑 chain、不改狀態、不推鏈;純加新 RPC。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_update_pending_settle(
  p_line_user_id  text,
  p_id            int,
  p_actual_amount numeric,
  p_notes         text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp   employees;
  v_er  public.expense_requests;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_er FROM public.expense_requests WHERE id = p_id;
  IF v_er.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  IF v_er.status <> '待核銷' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_SETTLE', 'status', v_er.status);
  END IF;
  IF COALESCE(v_er.settle_current_step, 0) <> 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_SIGNED');
  END IF;

  IF NOT (
    v_er.settle_assignee_id = emp.id
    OR (v_er.settle_assignee_id IS NULL AND v_er.employee_id = emp.id)
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

GRANT EXECUTE ON FUNCTION public.liff_update_pending_settle(text, int, numeric, text) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
