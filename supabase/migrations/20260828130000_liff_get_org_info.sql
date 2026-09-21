-- LIFF 拿員工所屬公司資訊(薪資單信頭用:logo/公司名/地址/統編/電話)
CREATE OR REPLACE FUNCTION public.liff_get_org_info(p_line_user_id text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees; o public.organizations;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO o FROM public.organizations WHERE id = emp.organization_id;
  RETURN json_build_object('ok', true,
    'name', o.name, 'address', o.address, 'tax_id', o.tax_id, 'phone', o.phone, 'logo_url', o.logo_url);
END $function$;
REVOKE ALL ON FUNCTION public.liff_get_org_info(text) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_get_org_info(text) TO anon, authenticated;
