-- ════════════════════════════════════════════════════════════
-- payroll_import_row：一鍵把月結 Excel/CSV 一行匯進系統
--
-- 老闆 Excel 流程繼續走（人工核對 + 試算），月底匯進系統當帳簿快照。
-- 完整對應 CSV 欄位：本薪 / 底薪 / 各類津貼 / 4 類加班 / 各扣項 /
-- 公司負擔。Trigger 自動算 earnings_subtotal + employer_total_cost。
--
-- gross_salary / total_deductions / net_salary 用 client 端傳入或 RPC
-- 自己算（這個 RPC 自己算，因為 Excel 來的資料每欄都明確）。
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.payroll_import_row(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run_id        int;
  v_pay_period    text;
  v_emp_id        int;
  v_org_id        int;
  v_record_id     int;
  v_gross         numeric;
  v_total_deduct  numeric;
  v_net           numeric;
BEGIN
  v_pay_period := p_payload->>'pay_period';      -- 'YYYY-MM'
  v_emp_id     := (p_payload->>'employee_id')::int;
  v_org_id     := (p_payload->>'organization_id')::int;

  IF v_pay_period IS NULL OR v_emp_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PAY_PERIOD_AND_EMPLOYEE_REQUIRED');
  END IF;

  -- 找/建 payroll_runs（一個 pay_period 一個 run）
  SELECT id INTO v_run_id FROM payroll_runs
   WHERE pay_period = v_pay_period
   LIMIT 1;

  IF v_run_id IS NULL THEN
    INSERT INTO payroll_runs (pay_period, status)
    VALUES (v_pay_period, 'draft')
    RETURNING id INTO v_run_id;
  END IF;

  -- 算 gross：所有應發 A 區
  v_gross := COALESCE((p_payload->>'base_salary')::numeric, 0)
           + COALESCE((p_payload->>'base_insured')::numeric, 0)
           + COALESCE((p_payload->>'role_allowance')::numeric, 0)
           + COALESCE((p_payload->>'supervisor_allowance')::numeric, 0)
           + COALESCE((p_payload->>'meal_allowance')::numeric, 0)
           + COALESCE((p_payload->>'transport_allowance')::numeric, 0)
           + COALESCE((p_payload->>'night_shift_allowance')::numeric, 0)
           + COALESCE((p_payload->>'cross_store_allowance')::numeric, 0)
           + COALESCE((p_payload->>'attendance_bonus_earned')::numeric, 0)
           + COALESCE((p_payload->>'overtime_pay')::numeric, 0)
           + COALESCE((p_payload->>'overtime_pay_weekday')::numeric, 0)
           + COALESCE((p_payload->>'overtime_pay_restday')::numeric, 0)
           + COALESCE((p_payload->>'overtime_pay_holiday')::numeric, 0)
           + COALESCE((p_payload->>'overtime_pay_national')::numeric, 0)
           + COALESCE((p_payload->>'rest_day_unused_pay')::numeric, 0)
           + COALESCE((p_payload->>'back_pay_adjustment')::numeric, 0)
           + COALESCE((p_payload->>'performance_bonus')::numeric, 0)
           + COALESCE((p_payload->>'commission')::numeric, 0)
           + COALESCE((p_payload->>'festival_bonus')::numeric, 0)
           + COALESCE((p_payload->>'year_end_bonus')::numeric, 0)
           + COALESCE((p_payload->>'other_bonus')::numeric, 0)
           + COALESCE((p_payload->>'unused_leave_payout')::numeric, 0)
           + COALESCE((p_payload->>'custom_allowances_total')::numeric, 0);

  -- 算 total_deductions：所有扣項 B 區
  v_total_deduct := COALESCE((p_payload->>'labor_ins_employee')::numeric, 0)
                  + COALESCE((p_payload->>'health_ins_employee')::numeric, 0)
                  + COALESCE((p_payload->>'labor_pension_employee')::numeric, 0)
                  + COALESCE((p_payload->>'income_tax_withheld')::numeric, 0)
                  + COALESCE((p_payload->>'nhi_supplementary')::numeric, 0)
                  + COALESCE((p_payload->>'leave_deduction')::numeric, 0)
                  + COALESCE((p_payload->>'paid_leave_deduction')::numeric, 0)
                  + COALESCE((p_payload->>'unpaid_leave_deduction')::numeric, 0)
                  + COALESCE((p_payload->>'late_deduction')::numeric, 0)
                  + COALESCE((p_payload->>'advance_recovery')::numeric, 0)
                  + COALESCE((p_payload->>'legal_deduction_total')::numeric, 0);

  v_net := v_gross - v_total_deduct;

  -- UPSERT (pay_period + employee_id 唯一)
  INSERT INTO payroll_records (
    payroll_run_id, employee_id, pay_period,
    base_salary, base_insured,
    role_allowance, supervisor_allowance,
    meal_allowance, transport_allowance,
    night_shift_allowance, cross_store_allowance,
    attendance_bonus_earned,
    overtime_pay,
    overtime_pay_weekday, overtime_pay_restday, overtime_pay_holiday, overtime_pay_national,
    ot_hours_weekday, ot_hours_restday, ot_hours_holiday, ot_hours_national,
    rest_day_unused_pay, back_pay_adjustment,
    performance_bonus, commission, festival_bonus, year_end_bonus, other_bonus,
    unused_leave_payout, unused_leave_days,
    custom_allowances_total, custom_allowances_breakdown,
    gross_salary,
    leave_deduction, leave_days_deducted,
    paid_leave_deduction, unpaid_leave_deduction,
    late_deduction, late_minutes, advance_recovery,
    labor_ins_employee, health_ins_employee, labor_pension_employee,
    income_tax_withheld, nhi_supplementary, nhi_supplementary_breakdown,
    legal_deduction_total, legal_deduction_breakdown,
    total_deductions,
    labor_ins_employer, health_ins_employer, labor_pension_employer,
    occupational_injury_employer, nhi_supplementary_employer,
    net_salary,
    hours_worked, attendance_days,
    insurance_grade_id, notes,
    created_at
  )
  VALUES (
    v_run_id, v_emp_id, v_pay_period,
    COALESCE((p_payload->>'base_salary')::numeric, 0),
    COALESCE((p_payload->>'base_insured')::numeric, 0),
    COALESCE((p_payload->>'role_allowance')::numeric, 0),
    COALESCE((p_payload->>'supervisor_allowance')::numeric, 0),
    COALESCE((p_payload->>'meal_allowance')::numeric, 0),
    COALESCE((p_payload->>'transport_allowance')::numeric, 0),
    COALESCE((p_payload->>'night_shift_allowance')::numeric, 0),
    COALESCE((p_payload->>'cross_store_allowance')::numeric, 0),
    COALESCE((p_payload->>'attendance_bonus_earned')::numeric, 0),
    COALESCE((p_payload->>'overtime_pay')::numeric, 0),
    COALESCE((p_payload->>'overtime_pay_weekday')::numeric, 0),
    COALESCE((p_payload->>'overtime_pay_restday')::numeric, 0),
    COALESCE((p_payload->>'overtime_pay_holiday')::numeric, 0),
    COALESCE((p_payload->>'overtime_pay_national')::numeric, 0),
    COALESCE((p_payload->>'ot_hours_weekday')::numeric, 0),
    COALESCE((p_payload->>'ot_hours_restday')::numeric, 0),
    COALESCE((p_payload->>'ot_hours_holiday')::numeric, 0),
    COALESCE((p_payload->>'ot_hours_national')::numeric, 0),
    COALESCE((p_payload->>'rest_day_unused_pay')::numeric, 0),
    COALESCE((p_payload->>'back_pay_adjustment')::numeric, 0),
    COALESCE((p_payload->>'performance_bonus')::numeric, 0),
    COALESCE((p_payload->>'commission')::numeric, 0),
    COALESCE((p_payload->>'festival_bonus')::numeric, 0),
    COALESCE((p_payload->>'year_end_bonus')::numeric, 0),
    COALESCE((p_payload->>'other_bonus')::numeric, 0),
    COALESCE((p_payload->>'unused_leave_payout')::numeric, 0),
    COALESCE((p_payload->>'unused_leave_days')::numeric, 0),
    COALESCE((p_payload->>'custom_allowances_total')::numeric, 0),
    COALESCE(p_payload->'custom_allowances_breakdown', '{}'::jsonb),
    v_gross,
    COALESCE((p_payload->>'leave_deduction')::numeric, 0),
    COALESCE((p_payload->>'leave_days_deducted')::numeric, 0),
    COALESCE((p_payload->>'paid_leave_deduction')::numeric, 0),
    COALESCE((p_payload->>'unpaid_leave_deduction')::numeric, 0),
    COALESCE((p_payload->>'late_deduction')::numeric, 0),
    COALESCE((p_payload->>'late_minutes')::int, 0),
    COALESCE((p_payload->>'advance_recovery')::numeric, 0),
    COALESCE((p_payload->>'labor_ins_employee')::numeric, 0),
    COALESCE((p_payload->>'health_ins_employee')::numeric, 0),
    COALESCE((p_payload->>'labor_pension_employee')::numeric, 0),
    COALESCE((p_payload->>'income_tax_withheld')::numeric, 0),
    COALESCE((p_payload->>'nhi_supplementary')::numeric, 0),
    COALESCE(p_payload->'nhi_supplementary_breakdown', '{}'::jsonb),
    COALESCE((p_payload->>'legal_deduction_total')::numeric, 0),
    COALESCE(p_payload->'legal_deduction_breakdown', '{}'::jsonb),
    v_total_deduct,
    COALESCE((p_payload->>'labor_ins_employer')::numeric, 0),
    COALESCE((p_payload->>'health_ins_employer')::numeric, 0),
    COALESCE((p_payload->>'labor_pension_employer')::numeric, 0),
    COALESCE((p_payload->>'occupational_injury_employer')::numeric, 0),
    COALESCE((p_payload->>'nhi_supplementary_employer')::numeric, 0),
    v_net,
    COALESCE((p_payload->>'hours_worked')::numeric, 0),
    COALESCE((p_payload->>'attendance_days')::numeric, NULL),
    (p_payload->>'insurance_grade_id')::int,
    p_payload->>'notes',
    now()
  )
  ON CONFLICT (pay_period, employee_id) DO UPDATE
    SET
      base_salary = EXCLUDED.base_salary,
      base_insured = EXCLUDED.base_insured,
      role_allowance = EXCLUDED.role_allowance,
      supervisor_allowance = EXCLUDED.supervisor_allowance,
      meal_allowance = EXCLUDED.meal_allowance,
      transport_allowance = EXCLUDED.transport_allowance,
      night_shift_allowance = EXCLUDED.night_shift_allowance,
      cross_store_allowance = EXCLUDED.cross_store_allowance,
      attendance_bonus_earned = EXCLUDED.attendance_bonus_earned,
      overtime_pay = EXCLUDED.overtime_pay,
      overtime_pay_weekday = EXCLUDED.overtime_pay_weekday,
      overtime_pay_restday = EXCLUDED.overtime_pay_restday,
      overtime_pay_holiday = EXCLUDED.overtime_pay_holiday,
      overtime_pay_national = EXCLUDED.overtime_pay_national,
      ot_hours_weekday = EXCLUDED.ot_hours_weekday,
      ot_hours_restday = EXCLUDED.ot_hours_restday,
      ot_hours_holiday = EXCLUDED.ot_hours_holiday,
      ot_hours_national = EXCLUDED.ot_hours_national,
      rest_day_unused_pay = EXCLUDED.rest_day_unused_pay,
      back_pay_adjustment = EXCLUDED.back_pay_adjustment,
      performance_bonus = EXCLUDED.performance_bonus,
      commission = EXCLUDED.commission,
      festival_bonus = EXCLUDED.festival_bonus,
      year_end_bonus = EXCLUDED.year_end_bonus,
      other_bonus = EXCLUDED.other_bonus,
      unused_leave_payout = EXCLUDED.unused_leave_payout,
      unused_leave_days = EXCLUDED.unused_leave_days,
      custom_allowances_total = EXCLUDED.custom_allowances_total,
      custom_allowances_breakdown = EXCLUDED.custom_allowances_breakdown,
      gross_salary = EXCLUDED.gross_salary,
      leave_deduction = EXCLUDED.leave_deduction,
      leave_days_deducted = EXCLUDED.leave_days_deducted,
      paid_leave_deduction = EXCLUDED.paid_leave_deduction,
      unpaid_leave_deduction = EXCLUDED.unpaid_leave_deduction,
      late_deduction = EXCLUDED.late_deduction,
      late_minutes = EXCLUDED.late_minutes,
      advance_recovery = EXCLUDED.advance_recovery,
      labor_ins_employee = EXCLUDED.labor_ins_employee,
      health_ins_employee = EXCLUDED.health_ins_employee,
      labor_pension_employee = EXCLUDED.labor_pension_employee,
      income_tax_withheld = EXCLUDED.income_tax_withheld,
      nhi_supplementary = EXCLUDED.nhi_supplementary,
      nhi_supplementary_breakdown = EXCLUDED.nhi_supplementary_breakdown,
      legal_deduction_total = EXCLUDED.legal_deduction_total,
      legal_deduction_breakdown = EXCLUDED.legal_deduction_breakdown,
      total_deductions = EXCLUDED.total_deductions,
      labor_ins_employer = EXCLUDED.labor_ins_employer,
      health_ins_employer = EXCLUDED.health_ins_employer,
      labor_pension_employer = EXCLUDED.labor_pension_employer,
      occupational_injury_employer = EXCLUDED.occupational_injury_employer,
      nhi_supplementary_employer = EXCLUDED.nhi_supplementary_employer,
      net_salary = EXCLUDED.net_salary,
      hours_worked = EXCLUDED.hours_worked,
      attendance_days = EXCLUDED.attendance_days,
      insurance_grade_id = EXCLUDED.insurance_grade_id,
      notes = EXCLUDED.notes
  RETURNING id INTO v_record_id;

  RETURN jsonb_build_object(
    'ok', true,
    'record_id', v_record_id,
    'run_id', v_run_id,
    'gross_salary', v_gross,
    'total_deductions', v_total_deduct,
    'net_salary', v_net
  );
END $$;

GRANT EXECUTE ON FUNCTION public.payroll_import_row(jsonb) TO authenticated;


-- 確保 (pay_period, employee_id) UNIQUE 才能 ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payroll_records_period_emp_uniq'
  ) THEN
    -- 先看現有資料是否有重複；有就 skip
    IF NOT EXISTS (
      SELECT 1 FROM (
        SELECT pay_period, employee_id, COUNT(*) c
          FROM payroll_records GROUP BY pay_period, employee_id
      ) s WHERE c > 1
    ) THEN
      ALTER TABLE public.payroll_records
        ADD CONSTRAINT payroll_records_period_emp_uniq UNIQUE (pay_period, employee_id);
    END IF;
  END IF;
END $$;


COMMIT;

NOTIFY pgrst, 'reload schema';
