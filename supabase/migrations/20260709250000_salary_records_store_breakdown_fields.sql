-- salary_records 存分項:勞保/健保/勞退自提/所得稅/特休折現(明細列才顯示得出)
-- 2026-07-09  薪資明細列讀 r.labor_insurance/health_insurance/pension_self/income_tax 但 salary_records
--   只存合併 insurance → 全 -0。特休折現也沒存 → 離職者實領虛高無依據。
--   加 5 欄 + secure_upsert_salary_v2 存入(前端 payload 一併帶值)。idempotent。

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS labor_insurance     numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_insurance    numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pension_self        numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS income_tax          numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unused_leave_payout numeric DEFAULT 0;

CREATE OR REPLACE FUNCTION public.secure_upsert_salary_v2(p_data jsonb)
 RETURNS salary_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org    INT;
  v_result salary_records;
  v_emp_id INT;
  v_emp_name TEXT;
  v_month  TEXT;
BEGIN
  v_org := current_employee_org();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶'; END IF;

  v_emp_name := p_data->>'employee';
  v_month    := p_data->>'month';
  IF v_emp_name IS NULL OR v_month IS NULL THEN
    RAISE EXCEPTION 'employee + month 必填';
  END IF;

  -- 解析 employee_id（強型別 FK）
  SELECT id INTO v_emp_id FROM employees WHERE name = v_emp_name AND organization_id = v_org LIMIT 1;
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION '員工 % 不存在或不在當前租戶', v_emp_name;
  END IF;

  -- UPSERT by (employee_id, month)
  INSERT INTO salary_records (
    employee, employee_id, month,
    base_salary,
    role_allowance, meal_allowance, transport_allowance, attendance_bonus, custom_allowances,
    overtime_pay, bonus,
    health_ins_dependents, pension_self_pct,
    absence_deduction, late_deduction, other_deduction, other_deduction_note,
    -- legacy 欄位用「合計」算進去（保持向下相容）
    allowance, overtime, insurance, deductions, net_salary,
    labor_insurance, health_insurance, pension_self, income_tax, unused_leave_payout,
    organization_id
  ) VALUES (
    v_emp_name, v_emp_id, v_month,
    COALESCE((p_data->>'base_salary')::NUMERIC, 0),
    COALESCE((p_data->>'role_allowance')::NUMERIC, 0),
    COALESCE((p_data->>'meal_allowance')::NUMERIC, 0),
    COALESCE((p_data->>'transport_allowance')::NUMERIC, 0),
    COALESCE((p_data->>'attendance_bonus')::NUMERIC, 0),
    COALESCE(p_data->'custom_allowances', '[]'::jsonb),
    COALESCE((p_data->>'overtime_pay')::NUMERIC, 0),
    COALESCE((p_data->>'bonus')::NUMERIC, 0),
    COALESCE((p_data->>'health_ins_dependents')::INT, 0),
    COALESCE((p_data->>'pension_self_pct')::NUMERIC, 0),
    COALESCE((p_data->>'absence_deduction')::NUMERIC, 0),
    COALESCE((p_data->>'late_deduction')::NUMERIC, 0),
    COALESCE((p_data->>'other_deduction')::NUMERIC, 0),
    p_data->>'other_deduction_note',
    -- legacy 合併欄位
    COALESCE((p_data->>'allowances_total')::NUMERIC, 0),
    COALESCE((p_data->>'overtime_pay')::NUMERIC, 0),
    COALESCE((p_data->>'insurance')::NUMERIC, 0),
    COALESCE((p_data->>'deductions_total')::NUMERIC, 0),
    COALESCE((p_data->>'net_salary')::NUMERIC, 0),
    COALESCE((p_data->>'labor_insurance')::NUMERIC,0), COALESCE((p_data->>'health_insurance')::NUMERIC,0), COALESCE((p_data->>'pension_self')::NUMERIC,0), COALESCE((p_data->>'income_tax')::NUMERIC,0), COALESCE((p_data->>'unused_leave_payout')::NUMERIC,0),
    v_org
  )
  ON CONFLICT (employee_id, month) DO UPDATE SET
    base_salary           = EXCLUDED.base_salary,
    role_allowance        = EXCLUDED.role_allowance,
    meal_allowance        = EXCLUDED.meal_allowance,
    transport_allowance   = EXCLUDED.transport_allowance,
    attendance_bonus      = EXCLUDED.attendance_bonus,
    custom_allowances     = EXCLUDED.custom_allowances,
    overtime_pay          = EXCLUDED.overtime_pay,
    bonus                 = EXCLUDED.bonus,
    health_ins_dependents = EXCLUDED.health_ins_dependents,
    pension_self_pct      = EXCLUDED.pension_self_pct,
    absence_deduction     = EXCLUDED.absence_deduction,
    late_deduction        = EXCLUDED.late_deduction,
    other_deduction       = EXCLUDED.other_deduction,
    other_deduction_note  = EXCLUDED.other_deduction_note,
    allowance             = EXCLUDED.allowance,
    overtime              = EXCLUDED.overtime,
    insurance             = EXCLUDED.insurance,
    deductions            = EXCLUDED.deductions,
    net_salary            = EXCLUDED.net_salary,
    labor_insurance = EXCLUDED.labor_insurance, health_insurance = EXCLUDED.health_insurance, pension_self = EXCLUDED.pension_self, income_tax = EXCLUDED.income_tax, unused_leave_payout = EXCLUDED.unused_leave_payout
  RETURNING * INTO v_result;

  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  -- ON CONFLICT 需要 UNIQUE 約束；若沒有就 fallback 到一般 update
  UPDATE salary_records SET
    base_salary           = COALESCE((p_data->>'base_salary')::NUMERIC, base_salary),
    role_allowance        = COALESCE((p_data->>'role_allowance')::NUMERIC, role_allowance),
    meal_allowance        = COALESCE((p_data->>'meal_allowance')::NUMERIC, meal_allowance),
    transport_allowance   = COALESCE((p_data->>'transport_allowance')::NUMERIC, transport_allowance),
    attendance_bonus      = COALESCE((p_data->>'attendance_bonus')::NUMERIC, attendance_bonus),
    custom_allowances     = COALESCE(p_data->'custom_allowances', custom_allowances),
    overtime_pay          = COALESCE((p_data->>'overtime_pay')::NUMERIC, overtime_pay),
    bonus                 = COALESCE((p_data->>'bonus')::NUMERIC, bonus),
    net_salary            = COALESCE((p_data->>'net_salary')::NUMERIC, net_salary)
  WHERE employee_id = v_emp_id AND month = v_month
  RETURNING * INTO v_result;
  RETURN v_result;
END $function$;

NOTIFY pgrst, 'reload schema';
