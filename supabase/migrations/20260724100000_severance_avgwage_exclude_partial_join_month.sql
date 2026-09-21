-- 資遣平均工資排除「到職當月的不足月記錄」 — 2026-07-24
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:平均工資優先抓 salary_records 實發平均,但到職當月是「不足月」(proration)。
--   例:蔡沛潔 6/16 到職,6 月只做半月 → 實發 base 19500 + 伙食 1500 = 21000(=足月42000的一半)。
--   她只有這一筆記錄 → RPC 把半月薪當整月平均 = 21000 → 資遣金被低估一半(1365 應為 2730)。
-- 正解(勞基法§2):平均工資=前6月工資總額÷在職期間。(7月42000+6月21000)÷1.5月=42000。
-- 修法:salary_records 平均排除「到職當月且非1號到職」的那筆不足月記錄。剔除後若無其他實發
--   記錄 → 自動 fallback 到 salary_structures 足月值(42000,即正確月平均)。滿月員工不受影響。
-- 其餘 body 與 live(20260723170000)逐字一致,僅在 salary_records WHERE 加一條排除。
-- ════════════════════════════════════════════════════════════════════════════
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

  -- 服務年資（精確到天 → 年，無條件進位到小數第2位，對員工有利）
  v_service_days  := p_termination_date - v_emp.join_date;
  v_service_years := CEIL(v_service_days::numeric / 365.25 * 100) / 100;

  -- 平均工資 = 本薪 + 固定津貼(主管/伙食/交通)，離職前6個月均；不含加班(對齊特休折現)。
  -- 來源優先:override → salary_records(已發布實薪,最可靠) → salary_structures → employees 主檔。
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
       AND month <  to_char(p_termination_date, 'YYYY-MM')
       -- 排除到職當月的不足月記錄(非1號到職那筆半月薪會拉低平均;剔除後 fallback 薪資結構足月值)
       AND NOT (month = to_char(v_emp.join_date, 'YYYY-MM') AND EXTRACT(DAY FROM v_emp.join_date) > 1);

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

  -- 資遣月數 = min(服務年資 × 0.5, 6)
  v_severance_months := LEAST(v_service_years * 0.5, 6.0);
  v_severance_amount := ROUND(v_severance_months * v_avg_wage, 2);

  -- 預告天數（勞基法 16 條）
  IF v_service_days < 90 THEN
    v_notice_days := 0;
  ELSIF v_service_years < 1 THEN
    v_notice_days := 10;
  ELSIF v_service_years < 3 THEN
    v_notice_days := 20;
  ELSE
    v_notice_days := 30;
  END IF;

  -- 預告工資（如未實際預告才付）：平均月薪 ÷ 30 × 預告天數
  v_notice_wage := ROUND(v_avg_wage / 30 * v_notice_days, 2);
  v_total := v_severance_amount + v_notice_wage;

  RETURN json_build_object(
    'ok', true,
    'employee_id', v_emp.id, 'employee_name', v_emp.name, 'employee_number', v_emp.employee_number,
    'join_date', v_emp.join_date, 'termination_date', p_termination_date,
    'service_days', v_service_days, 'service_years', v_service_years,
    'service_label', floor(v_service_years)::text || ' 年 ' ||
                     round((v_service_years - floor(v_service_years)) * 12)::text || ' 個月',
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
