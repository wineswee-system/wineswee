-- ════════════════════════════════════════════════════════════════════════════
-- 1. liff_delete_expense_request_attachment
--    只有申請人且申請單 status=申請中 current_step=0 才能刪
-- 2. liff_update_expense_request（覆寫）
--    加入 settle_department_id / settle_store_id 可更新
-- idempotent: CREATE OR REPLACE
-- 2026-06-30
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. liff_delete_expense_request_attachment ─────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_delete_expense_request_attachment(
  p_line_user_id text,
  p_id           int
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp  employees;
  rows int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  DELETE FROM public.expense_request_attachments att
  WHERE att.id = p_id
    AND EXISTS (
      SELECT 1 FROM public.expense_requests er
      WHERE er.id = att.request_id
        AND er.employee_id = emp.id
        AND er.status = '申請中'
        AND COALESCE(er.current_step, 0) = 0
    );
  GET DIAGNOSTICS rows = ROW_COUNT;
  IF rows = 0 THEN RAISE EXCEPTION '找不到可刪除的附件（已審核或非本人）'; END IF;
  RETURN json_build_object('ok', true, 'id', p_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_expense_request_attachment(text, int) TO authenticated, anon;

-- ── 2. liff_update_expense_request（加 settle 欄位）────────────────────────
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
    title                = COALESCE(NULLIF(p_payload->>'title', ''),              title),
    description          = COALESCE(NULLIF(p_payload->>'description', ''),        description),
    estimated_amount     = COALESCE(NULLIF(p_payload->>'estimated_amount', '')::numeric, estimated_amount),
    account_code         = COALESCE(NULLIF(p_payload->>'account_code', ''),       account_code),
    notes                = COALESCE(NULLIF(p_payload->>'notes', ''),              notes),
    store                = COALESCE(NULLIF(p_payload->>'store', ''),              store),
    supplier             = COALESCE(NULLIF(p_payload->>'supplier', ''),           supplier),
    settle_department_id = CASE
                             WHEN p_payload->>'settle_department_id' IS NOT NULL
                             THEN (p_payload->>'settle_department_id')::int
                             ELSE settle_department_id
                           END,
    settle_store_id      = CASE
                             WHEN p_payload->>'settle_store_id' = '__CLEAR__' THEN NULL
                             WHEN p_payload->>'settle_store_id' IS NOT NULL
                             THEN (p_payload->>'settle_store_id')::int
                             ELSE settle_store_id
                           END,
    updated_at           = now()
  WHERE id = p_id
    AND employee_id = emp.id
    AND status = '申請中'
    AND COALESCE(current_step, 0) = 0;

  IF NOT FOUND THEN RAISE EXCEPTION '此申請已進入審核流程，無法編輯'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_expense_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_expense_request(text, int, json) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
