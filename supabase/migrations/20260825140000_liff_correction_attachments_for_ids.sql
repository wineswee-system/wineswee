-- LIFF 審核端批次撈補打卡附件(對齊 liff_leave_attachments_for_ids)
-- 主管在手機審核補打卡時要看得到申請人上傳的照片。回 storage_bucket/path 由前端 getPublicUrl 組 URL。
-- 限同 org(對齊 form_attachments_read_same_org),caller 必須是有效員工。

CREATE OR REPLACE FUNCTION public.liff_correction_attachments_for_ids(
  p_line_user_id text,
  p_ids          integer[]
)
RETURNS TABLE(form_id integer, storage_bucket text, storage_path text, file_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT fa.form_id, fa.storage_bucket, fa.storage_path, fa.file_name
    FROM public.form_attachments fa
    WHERE fa.form_type = 'correction'
      AND fa.form_id = ANY(p_ids)
      AND (fa.organization_id IS NULL OR fa.organization_id = emp.organization_id)
    ORDER BY fa.id;
END $function$;

REVOKE ALL ON FUNCTION public.liff_correction_attachments_for_ids(text, integer[]) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_correction_attachments_for_ids(text, integer[]) TO anon, authenticated;
