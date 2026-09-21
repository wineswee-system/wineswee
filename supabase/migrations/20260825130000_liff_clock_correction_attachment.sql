-- LIFF 補打卡選填照片:專屬 DEFINER RPC,把附件寫進多型 form_attachments(form_type='correction')
-- 對齊 liff_add_repair_order_attachment;anon 不能直接插 form_attachments(RLS),故走 DEFINER。
-- 只有本人(該補打卡單的 employee_id)可加附件。

CREATE OR REPLACE FUNCTION public.liff_add_clock_correction_attachment(
  p_line_user_id text,
  p_id           integer,
  p_storage_path text,
  p_file_name    text,
  p_file_size    bigint,
  p_mime_type    text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emp   public.employees;
  v_cc  public.clock_corrections;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;

  SELECT * INTO v_cc FROM public.clock_corrections WHERE id = p_id AND deleted_at IS NULL;
  IF v_cc.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  IF v_cc.employee_id <> emp.id THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  INSERT INTO public.form_attachments (
    form_type, form_id, organization_id, storage_bucket, storage_path,
    file_name, file_size, mime_type, uploaded_by_id, uploaded_by
  ) VALUES (
    'correction', p_id, v_cc.organization_id, 'attachments', p_storage_path,
    p_file_name, p_file_size, p_mime_type, emp.id, emp.name
  );

  RETURN json_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.liff_add_clock_correction_attachment(text, integer, text, text, bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_add_clock_correction_attachment(text, integer, text, text, bigint, text) TO anon, authenticated;
