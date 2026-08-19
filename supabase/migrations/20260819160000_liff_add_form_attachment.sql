-- 2026-08-19 修:LIFF 商品調撥附件 metadata 寫不進 form_attachments
--   LIFF(anon)直接 insert form_attachments → anon 無 table 權限/RLS 擋 → 靜默失敗 → 附件無紀錄(LIFF+web 都看不到)。
--   改走 SECURITY DEFINER RPC(繞 anon RLS),由 line_user 解出員工填 uploaded_by/org。
CREATE OR REPLACE FUNCTION public.liff_add_form_attachment(
  p_line_user_id text, p_form_type text, p_form_id integer,
  p_storage_bucket text, p_storage_path text, p_file_name text,
  p_file_size bigint DEFAULT NULL, p_mime_type text DEFAULT NULL)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_id integer;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF COALESCE(btrim(p_form_type),'') = '' OR p_form_id IS NULL OR COALESCE(btrim(p_storage_path),'') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'MISSING_FIELDS');
  END IF;
  INSERT INTO public.form_attachments (
    form_type, form_id, organization_id, storage_bucket, storage_path,
    file_name, file_size, mime_type, uploaded_by_id, uploaded_by
  ) VALUES (
    btrim(p_form_type), p_form_id, emp.organization_id, COALESCE(p_storage_bucket,'attachments'), btrim(p_storage_path),
    p_file_name, p_file_size, p_mime_type, emp.id, emp.name
  ) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.liff_add_form_attachment(text,text,integer,text,text,text,bigint,text) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_add_form_attachment(text,text,integer,text,text,text,bigint,text) TO anon, authenticated;
