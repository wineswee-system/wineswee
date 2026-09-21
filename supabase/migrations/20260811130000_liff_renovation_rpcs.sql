-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 裝潢報價 RPC(SECURITY DEFINER 繞 anon RLS;內部檢查 renovation.manage) — 2026-08-11
--   list / upsert / delete + 通用 liff_has_permission(給 HRHub 卡片顯示用,方案A)。
--   身分:_liff_resolve_employee(line_user) → emp;權限:liff_employee_has_permission。
--   idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- 通用:這個 line 使用者有沒有某權限碼(HRHub 決定要不要顯示卡片)
CREATE OR REPLACE FUNCTION public.liff_has_permission(p_line_user_id text, p_perm_code text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN false; END IF;
  RETURN public.liff_employee_has_permission(emp.id, p_perm_code);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_has_permission(text, text) TO anon, authenticated;

-- 列表(含明細 + 分期)
CREATE OR REPLACE FUNCTION public.liff_list_renovation_quotes(p_line_user_id text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; v json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'renovation.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  SELECT json_agg(x) INTO v FROM (
    SELECT q.*,
      COALESCE((SELECT json_agg(i ORDER BY i.seq)       FROM public.renovation_quote_items    i WHERE i.quote_id = q.id), '[]'::json) AS items,
      COALESCE((SELECT json_agg(p ORDER BY p.phase_no)  FROM public.renovation_quote_payments p WHERE p.quote_id = q.id), '[]'::json) AS payments
    FROM public.renovation_quotes q
    WHERE q.organization_id = emp.organization_id
    ORDER BY q.created_at DESC
  ) x;
  RETURN json_build_object('ok', true, 'quotes', COALESCE(v, '[]'::json));
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_list_renovation_quotes(text) TO anon, authenticated;

-- 新增/編輯(payload 帶 id 則更新;明細/分期整批重寫)
CREATE OR REPLACE FUNCTION public.liff_upsert_renovation_quote(p_line_user_id text, p_payload jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; v_id uuid; it jsonb; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'renovation.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF COALESCE(p_payload->>'store_name', '') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'STORE_REQUIRED'); END IF;

  v_id := NULLIF(p_payload->>'id', '')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.renovation_quotes
      (organization_id, store_name, address, vendor, contact_name, contact_phone,
       construction_fee, mgmt_fee_pct, mgmt_fee, tax_pct, tax, invoice_separate_total, total_amount, quote_date, note, created_by)
    VALUES (emp.organization_id, p_payload->>'store_name', NULLIF(p_payload->>'address',''), NULLIF(p_payload->>'vendor',''),
       NULLIF(p_payload->>'contact_name',''), NULLIF(p_payload->>'contact_phone',''),
       COALESCE((p_payload->>'construction_fee')::numeric,0), COALESCE((p_payload->>'mgmt_fee_pct')::numeric,0), COALESCE((p_payload->>'mgmt_fee')::numeric,0),
       COALESCE((p_payload->>'tax_pct')::numeric,0), COALESCE((p_payload->>'tax')::numeric,0), COALESCE((p_payload->>'invoice_separate_total')::numeric,0),
       COALESCE((p_payload->>'total_amount')::numeric,0), NULLIF(p_payload->>'quote_date','')::date, NULLIF(p_payload->>'note',''), emp.name)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.renovation_quotes SET
      store_name = p_payload->>'store_name', address = NULLIF(p_payload->>'address',''), vendor = NULLIF(p_payload->>'vendor',''),
      contact_name = NULLIF(p_payload->>'contact_name',''), contact_phone = NULLIF(p_payload->>'contact_phone',''),
      construction_fee = COALESCE((p_payload->>'construction_fee')::numeric,0), mgmt_fee_pct = COALESCE((p_payload->>'mgmt_fee_pct')::numeric,0),
      mgmt_fee = COALESCE((p_payload->>'mgmt_fee')::numeric,0), tax_pct = COALESCE((p_payload->>'tax_pct')::numeric,0), tax = COALESCE((p_payload->>'tax')::numeric,0),
      invoice_separate_total = COALESCE((p_payload->>'invoice_separate_total')::numeric,0), total_amount = COALESCE((p_payload->>'total_amount')::numeric,0),
      quote_date = NULLIF(p_payload->>'quote_date','')::date, note = NULLIF(p_payload->>'note',''), updated_at = now()
    WHERE id = v_id AND organization_id = emp.organization_id;
    IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
    DELETE FROM public.renovation_quote_items    WHERE quote_id = v_id;
    DELETE FROM public.renovation_quote_payments WHERE quote_id = v_id;
  END IF;

  n := 0;
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) LOOP
    n := n + 1;
    INSERT INTO public.renovation_quote_items (organization_id, quote_id, seq, name, amount, invoice_separate, note)
    VALUES (emp.organization_id, v_id, n, NULLIF(it->>'name',''), COALESCE((it->>'amount')::numeric,0),
            COALESCE((it->>'invoice_separate')::boolean,false), NULLIF(it->>'note',''));
  END LOOP;

  n := 0;
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'payments', '[]'::jsonb)) LOOP
    n := n + 1;
    INSERT INTO public.renovation_quote_payments (organization_id, quote_id, phase_no, label, pct, due_date, amount)
    VALUES (emp.organization_id, v_id, n, NULLIF(it->>'label',''), NULLIF(it->>'pct','')::numeric,
            NULLIF(it->>'due_date','')::date, NULLIF(it->>'amount','')::numeric);
  END LOOP;

  RETURN json_build_object('ok', true, 'id', v_id);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_upsert_renovation_quote(text, jsonb) TO anon, authenticated;

-- 刪除
CREATE OR REPLACE FUNCTION public.liff_delete_renovation_quote(p_line_user_id text, p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'renovation.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  DELETE FROM public.renovation_quotes WHERE id = p_id AND organization_id = emp.organization_id;
  RETURN json_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_delete_renovation_quote(text, uuid) TO anon, authenticated;
