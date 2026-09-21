-- 2026-08-14 謀職假資格判斷:資遣預告期在職者(勞基法 §16 為資遣的法定權利)。
--   eligible = resign_type='involuntary'(資遣,非自願) 且 resign_date 未到(仍在預告期)。
--   必須排在 310000/320000(create_leave_request/liff_insert 的謀職假分支會呼叫)之前。

CREATE OR REPLACE FUNCTION public._employee_job_seeking_eligible(p_emp_id int)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_emp_id
      AND e.resign_type = 'involuntary'
      AND e.resign_date IS NOT NULL
      AND e.resign_date >= (now() AT TIME ZONE 'Asia/Taipei')::date
  );
$fn$;

-- LIFF 前端用:判斷登入者可否請謀職假(→ 決定假別下拉出不出「謀職假」)
CREATE OR REPLACE FUNCTION public.liff_job_seeking_eligible(p_line_user_id text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN false; END IF;
  RETURN public._employee_job_seeking_eligible(emp.id);
END $fn$;

GRANT EXECUTE ON FUNCTION public.liff_job_seeking_eligible(text) TO anon, authenticated;
