-- 人事異動後算上個月薪資:批次計薪頁的門市篩選原本用 e.store(現況門市),
-- 轉調的人算上個月會被歸到「現在的新門市」、在舊門市篩不到。改用 point-in-time:
-- 依帳務月份回推 position_history 當月有效的門市(比照引擎 _compute_payroll_for_employee 的做法)。
CREATE OR REPLACE FUNCTION public._pit_store_name(p_emp_id int, p_period text)
RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT s.name FROM public.position_history ph
  JOIN public.stores s ON s.id = ph.store_id
  WHERE ph.employee_id = p_emp_id
    AND ph.effective_date <= (make_date(split_part(p_period,'-',1)::int, split_part(p_period,'-',2)::int, 1) + interval '1 month - 1 day')::date
    AND (ph.end_date IS NULL OR ph.end_date >= make_date(split_part(p_period,'-',1)::int, split_part(p_period,'-',2)::int, 1))
  ORDER BY ph.effective_date DESC LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION public.preview_payroll(p_period text, p_org integer, p_store_filter text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year   INT  := split_part(p_period,'-',1)::int;
  v_month  INT  := split_part(p_period,'-',2)::int;
  v_mstart date := make_date(v_year, v_month, 1);
  v_mend   date := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_result json;
BEGIN
  SELECT COALESCE(json_agg(public._compute_payroll_for_employee(e.id, p_period) ORDER BY e.name), '[]'::json)
    INTO v_result
  FROM employees e
  WHERE e.organization_id = p_org
    AND (e.in_payroll IS NOT FALSE)
    AND (e.join_date IS NULL OR e.join_date <= v_mend)
    AND (
      e.status = '在職' OR e.status = '留停'
      OR (e.status = '離職' AND e.resign_date IS NOT NULL AND e.resign_date >= v_mstart)
    )
    AND (
      p_store_filter IS NULL
      OR COALESCE(public._pit_store_name(e.id, p_period), e.store) = p_store_filter
      OR (COALESCE(e.store,'') = '' AND EXISTS (
            SELECT 1 FROM public.schedules s
             WHERE s.employee_id = e.id
               AND s.date >= v_mstart AND s.date <= v_mend
               AND s.source_store = p_store_filter))
    );
  RETURN v_result;
END $function$

