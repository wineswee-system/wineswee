-- LIFF 直接新增維修廠商(anon → SECURITY DEFINER;需 repair_order.manage)。
CREATE OR REPLACE FUNCTION public.liff_add_repair_vendor(
  p_line_user_id text, p_name text, p_category_id integer DEFAULT NULL,
  p_phone text DEFAULT NULL, p_contact_person text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'repair_order.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF COALESCE(btrim(p_name),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_NAME'); END IF;
  INSERT INTO public.repair_vendors (organization_id, name, category_id, phone, contact_person, status)
  VALUES (emp.organization_id, btrim(p_name), p_category_id, NULLIF(btrim(p_phone),''), NULLIF(btrim(p_contact_person),''), '啟用')
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id, 'name', btrim(p_name), 'category_id', p_category_id, 'phone', NULLIF(btrim(p_phone),''));
END $function$;

REVOKE ALL ON FUNCTION public.liff_add_repair_vendor(text,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_add_repair_vendor(text,text,integer,text,text) TO anon, authenticated;
