-- LIFF 收款記款 RPC 加匯款證明(附件)參數:DROP 舊版重建(加參數→避免 overload),存 attachment_path/name

DROP FUNCTION IF EXISTS public.liff_add_deposit_payment(text, uuid, date, numeric, text);
CREATE OR REPLACE FUNCTION public.liff_add_deposit_payment(
  p_line_user_id text, p_deposit_id uuid, p_paid_date date, p_amount numeric, p_note text,
  p_attachment_path text DEFAULT NULL, p_attachment_name text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees; d public.deposit_records; v_remaining numeric;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RETURN json_build_object('ok', false, 'error', '金額要 > 0'); END IF;
  SELECT * INTO d FROM public.deposit_records WHERE id = p_deposit_id AND organization_id = emp.organization_id;
  IF d.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  v_remaining := COALESCE(d.target_amount, 0) - COALESCE(d.paid_total, 0);
  IF p_amount > v_remaining + 0.5 THEN
    RETURN json_build_object('ok', false, 'error', '超過剩餘上限,最多再記 ' || to_char(v_remaining, 'FM999,999,999')); END IF;
  INSERT INTO public.deposit_payments (organization_id, deposit_id, paid_date, amount, note, attachment_path, attachment_name, created_by)
  VALUES (emp.organization_id, p_deposit_id, COALESCE(p_paid_date, CURRENT_DATE), p_amount, NULLIF(p_note, ''), NULLIF(p_attachment_path, ''), NULLIF(p_attachment_name, ''), emp.name);
  RETURN json_build_object('ok', true);
END $function$;

DROP FUNCTION IF EXISTS public.liff_add_franchise_payment(text, uuid, uuid, smallint, date, numeric, text);
CREATE OR REPLACE FUNCTION public.liff_add_franchise_payment(
  p_line_user_id text, p_ff_id uuid, p_investor_id uuid, p_stage smallint, p_paid_date date, p_amount numeric, p_note text,
  p_attachment_path text DEFAULT NULL, p_attachment_name text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees; ffi public.franchise_fee_investors; v_t1 numeric; v_t2 numeric; v_target numeric; v_paid numeric; v_remaining numeric;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RETURN json_build_object('ok', false, 'error', '金額要 > 0'); END IF;
  IF p_stage NOT IN (1, 2, 3) THEN RETURN json_build_object('ok', false, 'error', '期別錯誤'); END IF;
  SELECT * INTO ffi FROM public.franchise_fee_investors
    WHERE franchise_fee_id = p_ff_id AND investor_id = p_investor_id AND organization_id = emp.organization_id;
  IF ffi.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  v_t1 := round(COALESCE(ffi.amount, 0) * 0.45);
  v_t2 := round(COALESCE(ffi.amount, 0) * 0.45);
  v_target := CASE p_stage WHEN 1 THEN v_t1 WHEN 2 THEN v_t2 ELSE COALESCE(ffi.amount, 0) - v_t1 - v_t2 END;
  v_paid   := CASE p_stage WHEN 1 THEN COALESCE(ffi.paid_stage1, 0) WHEN 2 THEN COALESCE(ffi.paid_stage2, 0) ELSE COALESCE(ffi.paid_stage3, 0) END;
  v_remaining := v_target - v_paid;
  IF p_amount > v_remaining + 0.5 THEN
    RETURN json_build_object('ok', false, 'error', '超過本期剩餘上限,最多再記 ' || to_char(v_remaining, 'FM999,999,999')); END IF;
  INSERT INTO public.franchise_fee_payments (organization_id, franchise_fee_id, investor_id, stage, paid_date, amount, note, attachment_path, attachment_name, created_by)
  VALUES (emp.organization_id, p_ff_id, p_investor_id, p_stage, COALESCE(p_paid_date, CURRENT_DATE), p_amount, NULLIF(p_note, ''), NULLIF(p_attachment_path, ''), NULLIF(p_attachment_name, ''), emp.name);
  RETURN json_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.liff_add_deposit_payment(text, uuid, date, numeric, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.liff_add_franchise_payment(text, uuid, uuid, smallint, date, numeric, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_add_deposit_payment(text, uuid, date, numeric, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_add_franchise_payment(text, uuid, uuid, smallint, date, numeric, text, text, text) TO anon, authenticated;
