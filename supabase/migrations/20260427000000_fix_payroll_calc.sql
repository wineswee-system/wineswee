-- ============================================================
-- Fix generate_payroll():
--   1. Add income_tax_withheld column + calculation
--   2. Fix OT rates: weekday tiered (1.34/1.67), rest-day tiered (1.34/1.67/2.67)
--   3. Include income_tax in total_deductions
-- ============================================================

ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS income_tax_withheld NUMERIC(10,2) DEFAULT 0;

-- ── Monthly withholding helper (mirrors calculateMonthlyWithholding in payroll.js) ──
CREATE OR REPLACE FUNCTION public._calc_monthly_withholding(p_gross NUMERIC)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT CASE
    WHEN p_gross <= 40020  THEN 0
    WHEN p_gross <= 60000  THEN ROUND((p_gross - 40020)  * 0.05)
    WHEN p_gross <= 80000  THEN ROUND(999  + (p_gross - 60000)  * 0.12)
    WHEN p_gross <= 120000 THEN ROUND(3399 + (p_gross - 80000)  * 0.20)
    ELSE                        ROUND(11399 + (p_gross - 120000) * 0.30)
  END
$$;

GRANT EXECUTE ON FUNCTION public._calc_monthly_withholding(NUMERIC) TO authenticated;

-- ── Rebuild generate_payroll with all fixes ──
CREATE OR REPLACE FUNCTION public.generate_payroll(
  p_pay_period CHAR(7),
  p_created_by INT DEFAULT NULL
)
RETURNS TABLE(payroll_run_id INT, records_created INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_id      INT;
  v_count       INT := 0;
  v_year        INT;
  v_month       INT;
  v_month_start DATE;
  v_month_end   DATE;
  v_work_days   INT;
  rec           RECORD;
BEGIN
  v_year        := SPLIT_PART(p_pay_period, '-', 1)::INT;
  v_month       := SPLIT_PART(p_pay_period, '-', 2)::INT;
  v_month_start := MAKE_DATE(v_year, v_month, 1);
  v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  SELECT COUNT(*) INTO v_work_days
  FROM generate_series(v_month_start, v_month_end, '1 day') d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    AND NOT EXISTS (
      SELECT 1 FROM holidays h
      WHERE h.date = d::date AND h.is_workday = false
    );
  IF v_work_days < 1 THEN v_work_days := 1; END IF;

  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (p_pay_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  FOR rec IN
    SELECT
      e.id                                        AS employee_id,
      e.name,
      COALESCE(ss.base_salary,          0)        AS base_salary,
      COALESCE(ss.role_allowance,       0)        AS role_allowance,
      COALESCE(ss.meal_allowance,       0)        AS meal_allowance,
      COALESCE(ss.transport_allowance,  0)        AS transport_allowance,
      COALESCE(ss.attendance_bonus,     0)        AS attendance_bonus,
      COALESCE(ss.salary_type, 'monthly')         AS salary_type,
      COALESCE(ss.hourly_rate,          0)        AS hourly_rate,
      COALESCE(ss.health_ins_dependents,0)        AS health_ins_dependents,
      COALESCE(ss.custom_allowances, '[]'::jsonb) AS custom_allowances,
      e.labor_ins_grade,
      e.health_ins_grade,
      (ss.id IS NULL)                             AS no_salary_structure
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.status = '在職'
  LOOP
    DECLARE
      v_base             NUMERIC(10,2) := rec.base_salary;
      v_role_allow       NUMERIC(10,2) := rec.role_allowance;
      v_meal             NUMERIC(10,2) := rec.meal_allowance;
      v_transport        NUMERIC(10,2) := rec.transport_allowance;
      v_attendance_bonus NUMERIC(10,2) := rec.attendance_bonus;
      v_custom_total     NUMERIC(10,2) := 0;
      v_custom_breakdown JSONB         := '[]'::jsonb;

      v_ot_hours_wd  NUMERIC(5,2)  := 0;
      v_ot_hours_hd  NUMERIC(5,2)  := 0;
      v_ot_pay_wd    NUMERIC(10,2) := 0;
      v_ot_pay_hd    NUMERIC(10,2) := 0;
      v_ot_pay       NUMERIC(10,2) := 0;

      v_gross         NUMERIC(10,2);
      v_income_tax    NUMERIC(10,2) := 0;

      v_leave_deduction NUMERIC(10,2) := 0;
      v_leave_days      NUMERIC(4,1)  := 0;
      v_late_deduction  NUMERIC(10,2) := 0;
      v_late_mins       INT           := 0;

      v_labor_emp  NUMERIC(10,2) := 0;
      v_labor_er   NUMERIC(10,2) := 0;
      v_health_emp NUMERIC(10,2) := 0;
      v_health_er  NUMERIC(10,2) := 0;
      v_pension_emp NUMERIC(10,2) := 0;
      v_pension_er  NUMERIC(10,2) := 0;

      v_total_deductions NUMERIC(10,2);
      v_net_before_legal NUMERIC(10,2);
      v_legal_total      NUMERIC(10,2) := 0;
      v_legal_breakdown  JSONB         := '[]'::jsonb;
      v_net              NUMERIC(10,2);
      v_hours_worked     NUMERIC(6,2)  := 0;

      v_daily_rate  NUMERIC(10,2);
      v_hourly_rate NUMERIC(10,2);
      v_legal_rec   RECORD;
      v_legal_remaining NUMERIC(10,2);
      v_legal_to_deduct NUMERIC(10,2);
      v_legal_avail     NUMERIC(10,2);
      v_ca  JSONB;
      v_rd1 NUMERIC; v_rd2 NUMERIC; v_rd3 NUMERIC;
    BEGIN
      IF rec.no_salary_structure AND rec.base_salary = 0 THEN
        RAISE NOTICE 'Employee % (%) has no salary structure, skipping', rec.employee_id, rec.name;
        CONTINUE;
      END IF;

      -- Hours worked
      SELECT COALESCE(SUM(total_hours), 0) INTO v_hours_worked
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end;

      IF rec.salary_type = 'hourly' THEN
        v_hourly_rate := rec.hourly_rate;
        v_base        := v_hourly_rate * v_hours_worked;
      ELSE
        v_daily_rate  := v_base / v_work_days;
        v_hourly_rate := v_daily_rate / 8;
      END IF;

      -- Custom allowances
      IF jsonb_typeof(rec.custom_allowances) = 'array' THEN
        FOR v_ca IN SELECT * FROM jsonb_array_elements(rec.custom_allowances)
        LOOP
          v_custom_total := v_custom_total + COALESCE((v_ca->>'amount')::numeric, 0);
        END LOOP;
        v_custom_breakdown := rec.custom_allowances;
      END IF;

      -- Overtime — split weekday vs rest-day by DOW
      SELECT
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM request_date) NOT IN (0,6) THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM request_date) IN (0,6)     THEN ot_hours ELSE 0 END), 0)
      INTO v_ot_hours_wd, v_ot_hours_hd
      FROM overtime_requests
      WHERE employee_id = rec.employee_id
        AND request_date >= v_month_start AND request_date <= v_month_end
        AND status = '已核准'
        AND (ot_type IS NULL OR ot_type = 'pay');

      -- Weekday tiered: first 2h × 1.34, remaining × 1.67
      v_ot_pay_wd := CASE
        WHEN v_ot_hours_wd <= 2 THEN ROUND(v_ot_hours_wd * v_hourly_rate * 1.34)
        ELSE ROUND(2 * v_hourly_rate * 1.34 + (v_ot_hours_wd - 2) * v_hourly_rate * 1.67)
      END;

      -- Rest-day tiered: 0–2h × 1.34, 3–8h × 1.67, 9h+ × 2.67
      v_rd1 := LEAST(v_ot_hours_hd, 2);
      v_rd2 := LEAST(GREATEST(v_ot_hours_hd - 2, 0), 6);
      v_rd3 := GREATEST(v_ot_hours_hd - 8, 0);
      v_ot_pay_hd := ROUND(v_rd1 * v_hourly_rate * 1.34
                         + v_rd2 * v_hourly_rate * 1.67
                         + v_rd3 * v_hourly_rate * 2.67);

      v_ot_pay := v_ot_pay_wd + v_ot_pay_hd;

      -- Leave deduction (unpaid/personal leave)
      SELECT COALESCE(SUM(
        LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1
      ), 0) INTO v_leave_days
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准'
        AND leave_type IN ('事假', 'personal', '無薪假', 'unpaid');

      IF rec.salary_type = 'monthly' THEN
        v_leave_deduction := v_leave_days * v_daily_rate;
      END IF;

      -- Late deduction: FLOOR(mins/30) × hourly × 0.5
      SELECT COALESCE(SUM(late_minutes), 0) INTO v_late_mins
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end
        AND is_late = true;

      v_late_deduction := FLOOR(v_late_mins / 30.0) * (v_hourly_rate * 0.5);

      -- Zero attendance bonus if any tardiness or absence
      IF v_late_mins > 0 OR v_leave_days > 0 THEN
        v_attendance_bonus := 0;
      END IF;

      -- Gross
      v_gross := v_base + v_role_allow + v_meal + v_transport
               + v_attendance_bonus + v_ot_pay + v_custom_total;

      -- Income tax withholding
      v_income_tax := public._calc_monthly_withholding(v_gross);

      -- Insurance
      IF rec.labor_ins_grade IS NOT NULL THEN
        SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
        FROM labor_ins_brackets
        WHERE year = v_year AND grade = rec.labor_ins_grade;
      END IF;

      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
        FROM health_ins_brackets
        WHERE year = v_year AND grade = rec.health_ins_grade;
        v_health_emp := v_health_emp * (1 + rec.health_ins_dependents);
      END IF;

      v_pension_er := ROUND(LEAST(v_base, 150000) * 0.06);

      -- Total deductions (before legal)
      v_total_deductions := v_leave_deduction + v_late_deduction
                          + v_labor_emp + v_health_emp + v_pension_emp
                          + v_income_tax;

      v_net_before_legal := v_gross - v_total_deductions;
      v_legal_avail      := GREATEST(v_net_before_legal, 0);

      -- Legal deductions
      FOR v_legal_rec IN
        SELECT id, title, monthly_amount, total_amount, paid_amount, paid_months
        FROM legal_deductions
        WHERE employee_id = rec.employee_id
          AND status = '進行中'
          AND started_month <= p_pay_period
        ORDER BY id
      LOOP
        v_legal_remaining := v_legal_rec.total_amount - v_legal_rec.paid_amount;
        v_legal_to_deduct := LEAST(v_legal_rec.monthly_amount, v_legal_remaining);
        v_legal_to_deduct := LEAST(v_legal_to_deduct, v_legal_avail);
        v_legal_to_deduct := GREATEST(v_legal_to_deduct, 0);

        IF v_legal_to_deduct > 0 THEN
          UPDATE legal_deductions
             SET paid_amount = paid_amount + v_legal_to_deduct,
                 paid_months = paid_months + 1,
                 status      = CASE
                                 WHEN (paid_amount + v_legal_to_deduct) >= total_amount THEN '已完成'
                                 ELSE status
                               END,
                 updated_at  = NOW()
           WHERE id = v_legal_rec.id;

          v_legal_total := v_legal_total + v_legal_to_deduct;
          v_legal_avail := v_legal_avail - v_legal_to_deduct;
        END IF;

        v_legal_breakdown := v_legal_breakdown || jsonb_build_object(
          'id',             v_legal_rec.id,
          'title',          v_legal_rec.title,
          'monthly_amount', v_legal_rec.monthly_amount,
          'amount',         v_legal_to_deduct,
          'shortfall',      v_legal_rec.monthly_amount - v_legal_to_deduct
        );

        EXIT WHEN v_legal_avail <= 0;
      END LOOP;

      v_total_deductions := v_total_deductions + v_legal_total;
      v_net              := v_gross - v_total_deductions;

      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        base_salary, role_allowance, meal_allowance, transport_allowance,
        attendance_bonus_earned, overtime_pay, ot_hours_weekday, ot_hours_holiday,
        custom_allowances_total, custom_allowances_breakdown,
        gross_salary,
        income_tax_withheld,
        leave_deduction, leave_days_deducted, late_deduction, late_minutes,
        labor_ins_employee, health_ins_employee, labor_pension_employee,
        legal_deduction_total, legal_deduction_breakdown,
        total_deductions,
        labor_ins_employer, health_ins_employer, labor_pension_employer,
        net_salary, hours_worked
      ) VALUES (
        v_run_id, rec.employee_id, p_pay_period,
        v_base, v_role_allow, v_meal, v_transport,
        v_attendance_bonus, v_ot_pay, v_ot_hours_wd, v_ot_hours_hd,
        v_custom_total, v_custom_breakdown,
        v_gross,
        v_income_tax,
        v_leave_deduction, v_leave_days, v_late_deduction, v_late_mins,
        v_labor_emp, v_health_emp, v_pension_emp,
        v_legal_total, v_legal_breakdown,
        v_total_deductions,
        v_labor_er, v_health_er, v_pension_er,
        v_net, v_hours_worked
      );

      v_count := v_count + 1;
    END;
  END LOOP;

  payroll_run_id  := v_run_id;
  records_created := v_count;
  RETURN NEXT;
END;
$$;
