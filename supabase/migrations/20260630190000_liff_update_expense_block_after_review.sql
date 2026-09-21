-- liff_update_expense_request: 加 current_step = 0 守門
-- 已有人審核（current_step > 0）就不允許再編輯
-- idempotent: CREATE OR REPLACE
-- 2026-06-30

CREATE OR REPLACE FUNCTION public.liff_update_expense_request(
  p_line_user_id text,
  p_id           int,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.expense_requests SET
    title            = COALESCE(NULLIF(p_payload->>'title', ''),            title),
    description      = COALESCE(NULLIF(p_payload->>'description', ''),      description),
    estimated_amount = COALESCE(NULLIF(p_payload->>'estimated_amount', '')::numeric, estimated_amount),
    account_code     = COALESCE(NULLIF(p_payload->>'account_code', ''),     account_code),
    notes            = COALESCE(NULLIF(p_payload->>'notes', ''),            notes),
    store            = COALESCE(NULLIF(p_payload->>'store', ''),            store),
    updated_at       = now()
  WHERE id = p_id
    AND employee_id = emp.id
    AND status = '申請中'
    AND COALESCE(current_step, 0) = 0;  -- 已有人審核就擋住

  IF NOT FOUND THEN RAISE EXCEPTION '此申請已進入審核流程，無法編輯'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_expense_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_expense_request(text, int, json) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
