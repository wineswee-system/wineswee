-- 修:LIFF 門市報修找鏈 category 字串錯 — 2026-07-21
-- liff_insert_store_repair_request 找 category='門市報修',但 #22 實際 category='門市報修申請單'
-- → 對不上拿 NULL 鏈(潛伏:目前 0 筆,第一張 LIFF 報修單會無鏈)。修:字串改對。
-- (emp_id 本來就有帶,僅鏈的問題;逐字重現 live + 只替換該字串)

CREATE OR REPLACE FUNCTION public.liff_insert_store_repair_request(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp      employees;
  v_chain  int;
  new_id   int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  IF emp.store_id IS NULL THEN RAISE EXCEPTION '員工未設定門市'; END IF;

  SELECT id INTO v_chain FROM public.approval_chains
   WHERE category = '門市報修申請單' AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
   ORDER BY id DESC LIMIT 1;

  INSERT INTO public.store_repair_requests (
    organization_id, store_id, employee_id,
    category, title, description, location, urgency, attachment_url,
    status, approval_chain_id, current_step
  ) VALUES (
    emp.organization_id,
    COALESCE(NULLIF(p_payload->>'store_id','')::int, emp.store_id),
    emp.id,
    COALESCE(NULLIF(p_payload->>'category',''), '其他'),
    p_payload->>'title',
    NULLIF(p_payload->>'description', ''),
    NULLIF(p_payload->>'location', ''),
    COALESCE(NULLIF(p_payload->>'urgency',''), '一般'),
    NULLIF(p_payload->>'attachment_url', ''),
    '待處理', v_chain, 0
  ) RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_insert_store_repair_request] %', SQLERRM; RAISE;
END $function$;

NOTIFY pgrst, 'reload schema';
