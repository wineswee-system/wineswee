-- LIFF 手機:學員看自己的結業證照(含金/銀/銅級別)。
CREATE OR REPLACE FUNCTION public.liff_lms_my_certificates(p_line_user_id text)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN json_build_object('ok', true, 'certificates', (
    SELECT COALESCE(json_agg(json_build_object(
      'id', cert.id, 'course_title', c.title, 'tier', cert.tier, 'score', cert.score,
      'certificate_number', cert.certificate_number, 'issued_at', cert.issued_at
    ) ORDER BY cert.issued_at DESC), '[]'::json)
    FROM lms_certificates cert LEFT JOIN lms_courses c ON c.id = cert.course_id
    WHERE cert.employee_id = emp.id
  ));
END $function$;
GRANT EXECUTE ON FUNCTION public.liff_lms_my_certificates(text) TO anon, authenticated;
