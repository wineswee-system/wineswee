-- ============================================================
-- secure_upsert_salary_v2 — JSONB 版本，支援所有對齊後的欄位
--
-- 之前 secure_upsert_salary 只接 7 個 INT 參數（base/allowance/overtime/deductions/insurance）
-- → Salary.jsx form 填的詳細欄位（職務/餐費/交通/全勤/自訂津貼/勞退自提...）全部會被丟掉
--
-- v2 一次接 JSONB，支援所有跟 salary_structures 對齊的欄位。
-- ============================================================

CREATE OR REPLACE FUNCTION public.secure_upsert_salary_v2(
  p_data JSONB
) RETURNS salary_records
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    net_salary            = EXCLUDED.net_salary
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
END $$;

-- 確保 (employee_id, month) 有 UNIQUE 約束讓 UPSERT 安全
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'salary_records_emp_month_unique'
  ) THEN
    BEGIN
      ALTER TABLE public.salary_records
        ADD CONSTRAINT salary_records_emp_month_unique UNIQUE (employee_id, month);
    EXCEPTION WHEN OTHERS THEN
      -- 若有重複資料導致加不上約束，先告警；資料清理後手動加
      RAISE NOTICE 'Could not add unique constraint on (employee_id, month): %', SQLERRM;
    END;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.secure_upsert_salary_v2(JSONB) TO authenticated;
