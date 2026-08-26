-- LIFF 線上預購 RPC(SECURITY DEFINER 繞 anon RLS;依 line_user_id 解析員工 → 限其 org)

CREATE OR REPLACE FUNCTION public.liff_list_preorders(p_line_user_id text)
RETURNS SETOF public.preorders
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT * FROM public.preorders
     WHERE deleted_at IS NULL
       AND (organization_id = emp.organization_id OR organization_id IS NULL)
     ORDER BY id DESC;
END $function$;

CREATE OR REPLACE FUNCTION public.liff_create_preorder(p_line_user_id text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees; new_id bigint;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF COALESCE(p_payload->>'customer_name','') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_NAME'); END IF;
  INSERT INTO public.preorders (
    organization_id, order_date, customer_name, phone, address, items,
    need_bag, need_invoice, invoice_tax_id, specific_delivery, delivery_time, notes, status, created_by
  ) VALUES (
    emp.organization_id,
    NULLIF(p_payload->>'order_date','')::date,
    p_payload->>'customer_name',
    p_payload->>'phone',
    p_payload->>'address',
    COALESCE(p_payload->'items', '[]'::jsonb),
    COALESCE((p_payload->>'need_bag')::boolean, false),
    COALESCE((p_payload->>'need_invoice')::boolean, false),
    p_payload->>'invoice_tax_id',
    COALESCE((p_payload->>'specific_delivery')::boolean, false),
    p_payload->>'delivery_time',
    p_payload->>'notes',
    COALESCE(NULLIF(p_payload->>'status',''), '未出貨'),
    emp.id
  ) RETURNING id INTO new_id;
  RETURN jsonb_build_object('ok', true, 'id', new_id);
END $function$;

CREATE OR REPLACE FUNCTION public.liff_update_preorder(p_line_user_id text, p_id bigint, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees; v_cnt int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  UPDATE public.preorders SET
    order_date        = NULLIF(p_payload->>'order_date','')::date,
    customer_name     = COALESCE(NULLIF(p_payload->>'customer_name',''), customer_name),
    phone             = p_payload->>'phone',
    address           = p_payload->>'address',
    items             = COALESCE(p_payload->'items', items),
    need_bag          = COALESCE((p_payload->>'need_bag')::boolean, need_bag),
    need_invoice      = COALESCE((p_payload->>'need_invoice')::boolean, need_invoice),
    invoice_tax_id    = p_payload->>'invoice_tax_id',
    specific_delivery = COALESCE((p_payload->>'specific_delivery')::boolean, specific_delivery),
    delivery_time     = p_payload->>'delivery_time',
    notes             = p_payload->>'notes',
    status            = COALESCE(NULLIF(p_payload->>'status',''), status)
  WHERE id = p_id AND deleted_at IS NULL
    AND (organization_id = emp.organization_id OR organization_id IS NULL);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.liff_set_preorder_status(p_line_user_id text, p_id bigint, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees; v_cnt int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF p_status NOT IN ('未出貨', '已出貨') THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_STATUS'); END IF;
  UPDATE public.preorders SET status = p_status
   WHERE id = p_id AND deleted_at IS NULL
     AND (organization_id = emp.organization_id OR organization_id IS NULL);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.liff_delete_preorder(p_line_user_id text, p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees; v_cnt int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  UPDATE public.preorders SET deleted_at = now()
   WHERE id = p_id AND deleted_at IS NULL
     AND (organization_id = emp.organization_id OR organization_id IS NULL);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.liff_list_preorders(text) FROM public;
REVOKE ALL ON FUNCTION public.liff_create_preorder(text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.liff_update_preorder(text, bigint, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.liff_set_preorder_status(text, bigint, text) FROM public;
REVOKE ALL ON FUNCTION public.liff_delete_preorder(text, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_list_preorders(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_create_preorder(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_update_preorder(text, bigint, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_set_preorder_status(text, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_preorder(text, bigint) TO anon, authenticated;
