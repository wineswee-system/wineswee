-- 資遣平均工資 fallback(無6個月薪資紀錄時)改抓 本薪+津貼(對齊特休折現月工資定義)— 2026-09-11
-- 原本只取 salary_structures.base_salary→漏伙食/職務/主管/交通津貼。含經常性津貼才符平均工資。
-- 有 payroll_records 時仍用 6 個月 gross 平均(gross 本就含津貼),不受影響。

CREATE OR REPLACE FUNCTION public.calc_severance(p_employee_id integer, p_termination_date date, p_avg_wage_override numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp                employees;
  v_service_days       INT;
  v_service_years      NUMERIC;
  v_yy                 INT;
  v_mm                 INT;
  v_dd                 INT;
  v_avg_wage           NUMERIC;
  v_severance_months   NUMERIC;
  v_severance_amount   NUMERIC;
  v_notice_days        INT;
  v_notice_wage        NUMERIC;
  v_total              NUMERIC;
  v_payroll_avg        NUMERIC;
  v_struct_base        NUMERIC;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF NOT public._same_org_or_super(v_emp.organization_id) THEN RETURN json_build_object('ok',false,'error','CROSS_TENANT_DENIED'); END IF;
  IF v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE',
                             'message', '此員工沒設到職日，無法計算服務年資');
  END IF;
  IF p_termination_date <= v_emp.join_date THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TERMINATION_DATE',
                             'message', '離職日不可早於到職日');
  END IF;

  -- 服務年資：年/月/天月曆分解（含到職當日 → age 用 離職日+1），對齊勞動部
  --   年資 = 年 + (月 + 天/30) / 12
  v_yy := EXTRACT(YEAR  FROM age(p_termination_date + 1, v_emp.join_date));
  v_mm := EXTRACT(MONTH FROM age(p_termination_date + 1, v_emp.join_date));
  v_dd := EXTRACT(DAY   FROM age(p_termination_date + 1, v_emp.join_date));
  v_service_days  := (p_termination_date - v_emp.join_date) + 1;   -- 含到職當日
  v_service_years := ROUND(v_yy + (v_mm + v_dd / 30.0) / 12.0, 6);

  -- 平均工資：撈離職前 6 個月 payroll_records.gross_salary 平均
  -- pay_period 格式 'YYYY-MM'
  IF p_avg_wage_override IS NOT NULL AND p_avg_wage_override > 0 THEN
    v_avg_wage := p_avg_wage_override;
  ELSE
    SELECT AVG(gross_salary) INTO v_payroll_avg
      FROM payroll_records
     WHERE employee_id = p_employee_id
       AND gross_salary > 0
       AND pay_period >= to_char(p_termination_date - INTERVAL '6 months', 'YYYY-MM')
       AND pay_period <  to_char(p_termination_date, 'YYYY-MM');

    IF v_payroll_avg IS NOT NULL AND v_payroll_avg > 0 THEN
      v_avg_wage := ROUND(v_payroll_avg, 2);
    ELSE
      -- fallback 到 salary_structures.base_salary
      SELECT (COALESCE(base_salary,0)+COALESCE(role_allowance,0)+COALESCE(supervisor_allowance,0)+COALESCE(meal_allowance,0)+COALESCE(transport_allowance,0)) INTO v_struct_base
        FROM salary_structures
       WHERE employee_id = p_employee_id
       ORDER BY effective_from DESC NULLS LAST, id DESC
       LIMIT 1;
      v_avg_wage := COALESCE(v_struct_base, 0);
    END IF;
  END IF;

  -- 資遣月數 = min(服務年資 × 0.5, 6)；資遣金無條件進位到整數
  v_severance_months := LEAST(v_service_years * 0.5, 6.0);
  v_severance_amount := CEIL(v_severance_months * v_avg_wage);

  -- 預告天數（勞基法 16 條）
  IF v_service_days < 90 THEN
    v_notice_days := 0;  -- 未滿 3 個月不需預告
  ELSIF v_service_years < 1 THEN
    v_notice_days := 10;
  ELSIF v_service_years < 3 THEN
    v_notice_days := 20;
  ELSE
    v_notice_days := 30;
  END IF;

  -- 預告工資（如未實際預告才付）：日薪 × 預告天數；無條件進位
  -- 日薪以「平均月薪 ÷ 30」估算
  v_notice_wage := CEIL(v_avg_wage / 30 * v_notice_days);

  v_total := v_severance_amount + v_notice_wage;

  RETURN json_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'employee_name', v_emp.name,
    'employee_number', v_emp.employee_number,
    'join_date', v_emp.join_date,
    'termination_date', p_termination_date,
    'service_days', v_service_days,
    'service_years', v_service_years,
    'service_label', v_yy::text || ' 年 ' || v_mm::text || ' 個月 ' || v_dd::text || ' 天',
    'average_monthly_wage', v_avg_wage,
    'avg_wage_source', CASE
      WHEN p_avg_wage_override IS NOT NULL THEN 'manual'
      WHEN v_payroll_avg IS NOT NULL THEN 'payroll_6m_avg'
      ELSE 'salary_structure'
    END,
    'severance_months', v_severance_months,
    'severance_amount', v_severance_amount,
    'notice_days', v_notice_days,
    'notice_wage', v_notice_wage,
    'total_amount', v_total
  );
END $function$
;

NOTIFY pgrst, 'reload schema';
