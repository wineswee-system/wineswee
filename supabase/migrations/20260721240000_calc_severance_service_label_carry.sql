-- 資遣試算 service_label 進位修正 — 2026-07-21
-- 純顯示 bug:round(小數年×12) 可能算出 12 個月卻沒進位成 1 年(如「2 年 12 個月」應為「3 年 0 個月」)。
-- 修:用「總月數 = round(年×12)」再拆 年=總月數/12、月=總月數%12。只改 service_label,其餘與
--   20260721230000 完全相同(平均工資本薪+固定津貼/優先 salary_records/資遣月數等一字不動)。

CREATE OR REPLACE FUNCTION public.calc_severance(p_employee_id integer, p_termination_date date, p_avg_wage_override numeric DEFAULT NULL::numeric)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_emp                employees;
  v_service_days       INT;
  v_service_years      NUMERIC;
  v_service_months     INT;
  v_avg_wage           NUMERIC;
  v_severance_months   NUMERIC;
  v_severance_amount   NUMERIC;
  v_notice_days        INT;
  v_notice_wage        NUMERIC;
  v_total              NUMERIC;
  v_sr_avg             NUMERIC;
  v_struct_base        NUMERIC;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE', 'message', '此員工沒設到職日，無法計算服務年資');
  END IF;
  IF p_termination_date <= v_emp.join_date THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TERMINATION_DATE', 'message', '離職日不可早於到職日');
  END IF;

  v_service_days  := p_termination_date - v_emp.join_date;
  v_service_years := ROUND(v_service_days::numeric / 365.25, 3);
  v_service_months := round(v_service_years * 12);   -- 總月數(用來拆年/月,含進位)

  -- 平均工資 = 本薪 + 固定津貼(主管/伙食/交通)，離職前6個月均；不含加班。優先 salary_records。
  IF p_avg_wage_override IS NOT NULL AND p_avg_wage_override > 0 THEN
    v_avg_wage := p_avg_wage_override;
  ELSE
    SELECT AVG(COALESCE(base_salary,0) + COALESCE(role_allowance,0)
             + COALESCE(meal_allowance,0) + COALESCE(transport_allowance,0))
      INTO v_sr_avg
      FROM salary_records
     WHERE employee_id = p_employee_id
       AND base_salary > 0
       AND month >= to_char(p_termination_date - INTERVAL '6 months', 'YYYY-MM')
       AND month <  to_char(p_termination_date, 'YYYY-MM');
    IF v_sr_avg IS NOT NULL AND v_sr_avg > 0 THEN
      v_avg_wage := ROUND(v_sr_avg, 2);
    ELSE
      SELECT COALESCE(base_salary,0) + COALESCE(supervisor_allowance,0) + COALESCE(role_allowance,0)
           + COALESCE(meal_allowance,0) + COALESCE(transport_allowance,0)
        INTO v_struct_base
        FROM salary_structures
       WHERE employee_id = p_employee_id
       ORDER BY effective_from DESC NULLS LAST, id DESC
       LIMIT 1;
      IF v_struct_base IS NOT NULL AND v_struct_base > 0 THEN
        v_avg_wage := ROUND(v_struct_base, 2);
      ELSE
        v_avg_wage := COALESCE(v_emp.base_salary,0) + COALESCE(v_emp.meal_allowance,0) + COALESCE(v_emp.transport_allowance,0);
      END IF;
    END IF;
  END IF;

  v_severance_months := LEAST(v_service_years * 0.5, 6.0);
  v_severance_amount := ROUND(v_severance_months * v_avg_wage, 2);

  IF v_service_days < 90 THEN
    v_notice_days := 0;
  ELSIF v_service_years < 1 THEN
    v_notice_days := 10;
  ELSIF v_service_years < 3 THEN
    v_notice_days := 20;
  ELSE
    v_notice_days := 30;
  END IF;

  v_notice_wage := ROUND(v_avg_wage / 30 * v_notice_days, 2);
  v_total := v_severance_amount + v_notice_wage;

  RETURN json_build_object(
    'ok', true,
    'employee_id', v_emp.id, 'employee_name', v_emp.name, 'employee_number', v_emp.employee_number,
    'join_date', v_emp.join_date, 'termination_date', p_termination_date,
    'service_days', v_service_days, 'service_years', v_service_years,
    'service_label', (v_service_months / 12)::text || ' 年 ' || (v_service_months % 12)::text || ' 個月',
    'average_monthly_wage', v_avg_wage,
    'avg_wage_source', CASE
      WHEN p_avg_wage_override IS NOT NULL AND p_avg_wage_override > 0 THEN 'manual'
      WHEN v_sr_avg IS NOT NULL AND v_sr_avg > 0 THEN 'salary_records_6m'
      WHEN v_struct_base IS NOT NULL AND v_struct_base > 0 THEN 'salary_structure'
      ELSE 'employee_base'
    END,
    'severance_months', v_severance_months, 'severance_amount', v_severance_amount,
    'notice_days', v_notice_days, 'notice_wage', v_notice_wage, 'total_amount', v_total
  );
END $function$;

NOTIFY pgrst, 'reload schema';
