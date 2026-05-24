-- ════════════════════════════════════════════════════════════════════════════
-- 修：liff_insert_expense_request 沒寫 linked_binding_id / is_expense /
--     currency / supplier / items
-- ----------------------------------------------------------------------------
-- 原 RPC 只取 6 個欄位（account_code/name/title/description/amount/store）
-- 但前端 LIFF ExpenseRequest.jsx 傳 11 個欄位（含 binding_id 也有想塞）
-- 結果：
--   - linked_binding_id 永遠 NULL → binding 同步不到 → 顯示「未填」
--   - is_expense / currency / supplier / items 全部遺失
--   - 前端後續 UPDATE binding_id 被 RLS 擋（anon 不能改 expense_requests）
--
-- 修法：RPC 補上所有 payload 欄位 + 多收 binding_id 參數（從 URL 直接傳）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(
  p_line_user_id TEXT,
  p_payload      JSON,
  p_binding_id   INT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  new_id     INT;
  v_items    JSONB;
  v_is_exp   BOOLEAN;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  -- 預設 is_expense=true（向後相容，舊版 payload 沒帶）
  v_is_exp := COALESCE((p_payload->>'is_expense')::boolean, TRUE);

  -- items 可能是 jsonb 或字串
  BEGIN
    v_items := (p_payload->'items');
  EXCEPTION WHEN OTHERS THEN
    v_items := NULL;
  END;

  INSERT INTO public.expense_requests (
    employee, employee_id, department,
    is_expense, account_code, account_name,
    title, description, estimated_amount,
    currency, store, supplier, items,
    linked_binding_id,
    status, organization_id
  )
  VALUES (
    emp.name, emp.id, emp.dept,
    v_is_exp,
    p_payload->>'account_code',
    p_payload->>'account_name',
    p_payload->>'title',
    p_payload->>'description',
    NULLIF(p_payload->>'estimated_amount', '')::numeric,
    COALESCE(p_payload->>'currency', 'TWD'),
    COALESCE(p_payload->>'store', emp.store),
    p_payload->>'supplier',
    v_items,
    p_binding_id,
    '申請中',
    emp.organization_id
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id, 'binding_id', p_binding_id);
END $$;

-- 三參數版本 GRANT
REVOKE ALL ON FUNCTION public.liff_insert_expense_request(TEXT, JSON, INT) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_insert_expense_request(TEXT, JSON, INT) TO anon, authenticated;

-- 舊兩參數版本繼續存在（向後相容；DEFAULT NULL 處理新呼叫；舊呼叫等同 binding_id=NULL）

COMMIT;

NOTIFY pgrst, 'reload schema';
