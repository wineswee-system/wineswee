-- =============================================
-- 法扣加「百分比模式」
--
-- 之前只能填固定每月扣 X 元，現在加可選擇：
--   - fixed   ：每月固定金額（既有行為）
--   - percent ：每月薪資的 X%（基於 GROSS）
--
-- 例：每月薪資 1/3（33.33%）— 法院強制扣薪常見規定
--    每月薪資 25% — 養育費案件常見
-- =============================================

BEGIN;

-- ── 1. legal_deductions 加欄位 ──
ALTER TABLE public.legal_deductions
  ADD COLUMN IF NOT EXISTS deduction_type TEXT NOT NULL DEFAULT 'fixed'
    CHECK (deduction_type IN ('fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS monthly_percent NUMERIC(5,2)
    CHECK (monthly_percent IS NULL OR (monthly_percent > 0 AND monthly_percent <= 100));

-- 放寬 monthly_amount NOT NULL（百分比模式時可以為 NULL）
ALTER TABLE public.legal_deductions
  ALTER COLUMN monthly_amount DROP NOT NULL;

-- 移除舊的 monthly_amount > 0 check，改為條件式
ALTER TABLE public.legal_deductions
  DROP CONSTRAINT IF EXISTS legal_deductions_monthly_amount_check;

-- 新增複合 check：fixed 模式必填 monthly_amount > 0；percent 模式必填 monthly_percent
ALTER TABLE public.legal_deductions
  DROP CONSTRAINT IF EXISTS legal_deductions_type_amount_check;
ALTER TABLE public.legal_deductions
  ADD CONSTRAINT legal_deductions_type_amount_check CHECK (
    (deduction_type = 'fixed'   AND monthly_amount IS NOT NULL AND monthly_amount > 0)
    OR
    (deduction_type = 'percent' AND monthly_percent IS NOT NULL AND monthly_percent > 0)
  );

COMMENT ON COLUMN public.legal_deductions.deduction_type IS
  'fixed=每月固定金額 (用 monthly_amount); percent=每月薪資百分比 (用 monthly_percent，基於 gross_salary)';
COMMENT ON COLUMN public.legal_deductions.monthly_percent IS
  '百分比模式下每月扣薪比例（1-100）。例 33.33 = 1/3';


-- ── 2. 重寫 generate_payroll：法扣段落支援 percent 模式 ──
CREATE OR REPLACE FUNCTION public.generate_payroll(
  p_pay_period CHARACTER,
  p_created_by INTEGER DEFAULT NULL::INTEGER
)
RETURNS TABLE(payroll_run_id INTEGER, records_created INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
      e.id AS employee_id, e.name, e.status, e.resign_date, e.organization_id,
      COALESCE(ss.base_salary, 0)         AS base_salary,
      COALESCE(ss.role_allowance, 0)      AS role_allowance,
      COALESCE(ss.meal_allowance, 0)      AS meal_allowance,
      COALESCE(ss.transport_allowance, 0) AS transport_allowance,
      COALESCE(ss.attendance_bonus, 0)    AS attendance_bonus,
      COALESCE(ss.salary_type, 'monthly') AS salary_type,
      COALESCE(ss.hourly_rate, 0)         AS hourly_rate,
      COALESCE(ss.health_ins_dependents, 0) AS health_ins_dependents,
      COALESCE(ss.custom_allowances, '[]'::jsonb) AS custom_allowances,
      e.labor_ins_grade, e.health_ins_grade,
      COALESCE(e.labor_pension_self_rate, 0) AS pension_self_rate,
      (ss.id IS NULL) AS no_salary_structure
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.status = '在職'
       OR (e.status = '離職' AND e.resign_date IS NOT NULL
           AND e.resign_date >= v_month_start AND e.resign_date <= v_month_end)
  LOOP
    DECLARE
      v_base NUMERIC(10,2) := rec.base_salary;
      v_role_allow NUMERIC(10,2) := rec.role_allowance;
      v_meal NUMERIC(10,2) := rec.meal_allowance;
      v_transport NUMERIC(10,2) := rec.transport_allowance;
      v_attendance_bonus NUMERIC(10,2) := rec.attendance_bonus;
      v_custom_total NUMERIC(10,2) := 0;
      v_custom_breakdown JSONB := '[]'::jsonb;
      v_ot_hours_wd NUMERIC(5,2) := 0; v_ot_hours_hd NUMERIC(5,2) := 0;
      v_ot_pay_wd NUMERIC(10,2) := 0; v_ot_pay_hd NUMERIC(10,2) := 0; v_ot_pay NUMERIC(10,2) := 0;
      v_gross NUMERIC(10,2); v_income_tax NUMERIC(10,2) := 0;
      v_leave_deduction NUMERIC(10,2) := 0; v_leave_days NUMERIC(4,1) := 0;
      v_unpaid_days NUMERIC(4,1) := 0; v_half_days NUMERIC(4,1) := 0;
      v_late_deduction NUMERIC(10,2) := 0; v_late_mins INT := 0;
      v_labor_emp NUMERIC(10,2) := 0; v_labor_er NUMERIC(10,2) := 0;
      v_health_emp NUMERIC(10,2) := 0; v_health_er NUMERIC(10,2) := 0;
      v_pension_emp NUMERIC(10,2) := 0; v_pension_er NUMERIC(10,2) := 0;
      v_nhi_supp NUMERIC(10,2) := 0; v_nhi_breakdown JSONB := '[]'::jsonb;
      v_insured_salary NUMERIC(10,2) := 0; v_nhi_threshold NUMERIC(12,2) := 0;
      v_unused_leave_days NUMERIC(5,1) := 0; v_unused_leave_payout NUMERIC(10,2) := 0;
      v_is_final_settlement BOOLEAN := false;
      v_total_deductions NUMERIC(10,2); v_net_before_legal NUMERIC(10,2);
      v_legal_total NUMERIC(10,2) := 0; v_legal_breakdown JSONB := '[]'::jsonb;
      v_net NUMERIC(10,2); v_hours_worked NUMERIC(6,2) := 0;
      v_daily_rate NUMERIC(10,2); v_hourly_rate NUMERIC(10,2);
      v_legal_rec RECORD;
      v_legal_remaining NUMERIC(10,2); v_legal_to_deduct NUMERIC(10,2);
      v_legal_avail NUMERIC(10,2); v_legal_planned NUMERIC(10,2);
      v_ca JSONB; v_rd1 NUMERIC; v_rd2 NUMERIC; v_rd3 NUMERIC;
      v_record_id INT;
    BEGIN
      IF rec.no_salary_structure AND rec.base_salary = 0 THEN
        RAISE NOTICE 'Employee % (%) has no salary structure, skipping', rec.employee_id, rec.name;
        CONTINUE;
      END IF;

      v_is_final_settlement := (rec.status = '離職');

      SELECT COALESCE(SUM(total_hours), 0) INTO v_hours_worked
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end;

      IF rec.salary_type = 'hourly' THEN
        v_hourly_rate := rec.hourly_rate;
        v_base := v_hourly_rate * v_hours_worked;
      ELSE
        v_daily_rate := v_base / v_work_days;
        v_hourly_rate := v_daily_rate / 8;
      END IF;

      IF jsonb_typeof(rec.custom_allowances) = 'array' THEN
        FOR v_ca IN SELECT * FROM jsonb_array_elements(rec.custom_allowances) LOOP
          v_custom_total := v_custom_total + COALESCE((v_ca->>'amount')::numeric, 0);
        END LOOP;
        v_custom_breakdown := rec.custom_allowances;
      END IF;

      SELECT
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM request_date) NOT IN (0,6) THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM request_date) IN (0,6) THEN ot_hours ELSE 0 END), 0)
      INTO v_ot_hours_wd, v_ot_hours_hd
      FROM overtime_requests
      WHERE employee_id = rec.employee_id
        AND request_date >= v_month_start AND request_date <= v_month_end
        AND status = '已核准' AND (ot_type IS NULL OR ot_type = 'pay');

      v_ot_pay_wd := CASE
        WHEN v_ot_hours_wd <= 2 THEN ROUND(v_ot_hours_wd * v_hourly_rate * 1.34)
        ELSE ROUND(2 * v_hourly_rate * 1.34 + (v_ot_hours_wd - 2) * v_hourly_rate * 1.67)
      END;
      v_rd1 := LEAST(v_ot_hours_hd, 2);
      v_rd2 := LEAST(GREATEST(v_ot_hours_hd - 2, 0), 6);
      v_rd3 := GREATEST(v_ot_hours_hd - 8, 0);
      v_ot_pay_hd := ROUND(v_rd1 * v_hourly_rate * 1.34 + v_rd2 * v_hourly_rate * 1.67 + v_rd3 * v_hourly_rate * 2.67);
      v_ot_pay := v_ot_pay_wd + v_ot_pay_hd;

      SELECT COALESCE(SUM(LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1), 0) INTO v_unpaid_days
      FROM leave_requests
      WHERE employee_id = rec.employee_id AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准' AND leave_type IN ('事假', '事', 'personal', '無薪假', 'unpaid');

      SELECT COALESCE(SUM(LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1), 0) INTO v_half_days
      FROM leave_requests
      WHERE employee_id = rec.employee_id AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准' AND leave_type IN ('病假', '病', 'sick', '生理假', '生', 'menstrual');

      v_leave_days := v_unpaid_days + v_half_days;

      IF rec.salary_type = 'monthly' THEN
        v_leave_deduction := (v_unpaid_days * v_daily_rate) + (v_half_days * v_daily_rate * 0.5);
      END IF;

      SELECT COALESCE(SUM(late_minutes), 0) INTO v_late_mins
      FROM attendance_records
      WHERE employee_id = rec.employee_id AND date >= v_month_start AND date <= v_month_end AND is_late = true;

      v_late_deduction := FLOOR(v_late_mins / 30.0) * (v_hourly_rate * 0.5);

      IF v_late_mins > 0 OR v_leave_days > 0 THEN v_attendance_bonus := 0; END IF;

      -- 離職結算：未休完特休折現
      IF v_is_final_settlement THEN
        SELECT COALESCE(SUM(GREATEST(total_days + carry_over_days - used_days, 0)), 0) INTO v_unused_leave_days
        FROM leave_balances
        WHERE employee_id = rec.employee_id AND year = v_year
          AND leave_type IN ('特休', 'annual', '特別休假');
        IF rec.salary_type = 'monthly' THEN
          v_unused_leave_payout := ROUND(v_unused_leave_days * (rec.base_salary / v_work_days));
        ELSE
          v_unused_leave_payout := ROUND(v_unused_leave_days * v_hourly_rate * 8);
        END IF;
      END IF;

      v_gross := v_base + v_role_allow + v_meal + v_transport + v_attendance_bonus + v_ot_pay + v_custom_total + v_unused_leave_payout;

      -- 二代健保補充保費
      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT insured_salary INTO v_insured_salary
        FROM health_ins_brackets WHERE year = v_year AND grade = rec.health_ins_grade;
        v_nhi_threshold := COALESCE(v_insured_salary, 0);

        IF v_ot_pay > v_nhi_threshold AND v_nhi_threshold > 0 THEN
          DECLARE
            v_ot_excess NUMERIC(12,2) := v_ot_pay - v_nhi_threshold;
            v_ot_premium NUMERIC(10,2) := ROUND(v_ot_excess * 0.0211);
          BEGIN
            v_nhi_supp := v_nhi_supp + v_ot_premium;
            v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
              'category', '加班費超額', 'income', v_ot_pay, 'exempt', v_nhi_threshold,
              'taxable', v_ot_excess, 'rate', 0.0211, 'premium', v_ot_premium);
          END;
        END IF;

        IF v_nhi_threshold > 0 THEN
          DECLARE
            v_bonus_this_month NUMERIC(12,2) := 0;
            v_threshold_4x NUMERIC(12,2) := v_nhi_threshold * 4;
            v_prev_cumul NUMERIC(12,2) := 0;
            v_new_cumul NUMERIC(12,2);
            v_taxable_this_month NUMERIC(12,2) := 0;
            v_bonus_premium NUMERIC(10,2);
          BEGIN
            v_bonus_this_month := v_attendance_bonus;
            IF v_bonus_this_month > 0 THEN
              SELECT cumulative_bonus INTO v_prev_cumul
                FROM annual_bonus_tracker WHERE employee_id = rec.employee_id AND year = v_year;
              v_prev_cumul := COALESCE(v_prev_cumul, 0);
              v_new_cumul := v_prev_cumul + v_bonus_this_month;

              IF v_new_cumul > v_threshold_4x AND v_prev_cumul < v_threshold_4x THEN
                v_taxable_this_month := v_new_cumul - v_threshold_4x;
              ELSIF v_prev_cumul >= v_threshold_4x THEN
                v_taxable_this_month := v_bonus_this_month;
              END IF;

              IF v_taxable_this_month > 0 THEN
                v_bonus_premium := ROUND(v_taxable_this_month * 0.0211);
                v_nhi_supp := v_nhi_supp + v_bonus_premium;
                v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
                  'category', '高額獎金累計', 'income', v_bonus_this_month, 'cumulative', v_new_cumul,
                  'threshold_4x', v_threshold_4x, 'taxable', v_taxable_this_month,
                  'rate', 0.0211, 'premium', v_bonus_premium);
              END IF;

              INSERT INTO annual_bonus_tracker (employee_id, year, organization_id, cumulative_bonus, insured_salary, threshold, exceeded_at)
              VALUES (rec.employee_id, v_year, rec.organization_id, v_new_cumul, v_nhi_threshold, v_threshold_4x,
                CASE WHEN v_new_cumul > v_threshold_4x THEN NOW() ELSE NULL END)
              ON CONFLICT (employee_id, year) DO UPDATE SET
                cumulative_bonus = EXCLUDED.cumulative_bonus, insured_salary = EXCLUDED.insured_salary,
                threshold = EXCLUDED.threshold,
                exceeded_at = COALESCE(annual_bonus_tracker.exceeded_at, EXCLUDED.exceeded_at),
                updated_at = NOW();
            END IF;
          END;
        END IF;
      END IF;

      v_income_tax := public._calc_monthly_withholding(v_gross);

      IF rec.labor_ins_grade IS NOT NULL THEN
        SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
        FROM labor_ins_brackets WHERE year = v_year AND grade = rec.labor_ins_grade;
      END IF;

      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
        FROM health_ins_brackets WHERE year = v_year AND grade = rec.health_ins_grade;
        v_health_emp := v_health_emp * (1 + rec.health_ins_dependents);
      END IF;

      v_pension_er := ROUND(LEAST(v_base, 150000) * 0.06);
      v_pension_emp := ROUND(LEAST(v_base, 150000) * (rec.pension_self_rate / 100.0));

      v_total_deductions := v_leave_deduction + v_late_deduction + v_labor_emp + v_health_emp + v_pension_emp + v_income_tax + v_nhi_supp;
      v_net_before_legal := v_gross - v_total_deductions;
      v_legal_avail := GREATEST(v_net_before_legal, 0);

      -- ── 法扣（修改：支援 fixed / percent 兩種模式）──
      FOR v_legal_rec IN
        SELECT id, title, deduction_type, monthly_amount, monthly_percent,
               total_amount, paid_amount, paid_months
        FROM legal_deductions
        WHERE employee_id = rec.employee_id
          AND status = '進行中'
          AND started_month <= p_pay_period
        ORDER BY id
      LOOP
        -- 計算本月「應扣」金額
        IF v_legal_rec.deduction_type = 'percent' THEN
          v_legal_planned := ROUND(v_gross * COALESCE(v_legal_rec.monthly_percent, 0) / 100.0);
        ELSE
          v_legal_planned := COALESCE(v_legal_rec.monthly_amount, 0);
        END IF;

        v_legal_remaining := v_legal_rec.total_amount - v_legal_rec.paid_amount;
        v_legal_to_deduct := LEAST(v_legal_planned, v_legal_remaining);
        v_legal_to_deduct := LEAST(v_legal_to_deduct, v_legal_avail);
        v_legal_to_deduct := GREATEST(v_legal_to_deduct, 0);

        IF v_legal_to_deduct > 0 THEN
          UPDATE legal_deductions
            SET paid_amount = paid_amount + v_legal_to_deduct,
                paid_months = paid_months + 1,
                status = CASE WHEN (paid_amount + v_legal_to_deduct) >= total_amount THEN '已完成' ELSE status END,
                updated_at = NOW()
          WHERE id = v_legal_rec.id;
          v_legal_total := v_legal_total + v_legal_to_deduct;
          v_legal_avail := v_legal_avail - v_legal_to_deduct;
        END IF;

        v_legal_breakdown := v_legal_breakdown || jsonb_build_object(
          'id', v_legal_rec.id,
          'title', v_legal_rec.title,
          'type', v_legal_rec.deduction_type,
          'planned', v_legal_planned,
          'amount', v_legal_to_deduct,
          'shortfall', v_legal_planned - v_legal_to_deduct,
          'percent', v_legal_rec.monthly_percent
        );

        EXIT WHEN v_legal_avail <= 0;
      END LOOP;

      v_total_deductions := v_total_deductions + v_legal_total;
      v_net := v_gross - v_total_deductions;

      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        base_salary, role_allowance, meal_allowance, transport_allowance,
        attendance_bonus_earned, overtime_pay, ot_hours_weekday, ot_hours_holiday,
        custom_allowances_total, custom_allowances_breakdown,
        gross_salary, income_tax_withheld,
        leave_deduction, leave_days_deducted, late_deduction, late_minutes,
        labor_ins_employee, health_ins_employee, labor_pension_employee,
        nhi_supplementary, nhi_supplementary_breakdown,
        unused_leave_payout, unused_leave_days, is_final_settlement,
        legal_deduction_total, legal_deduction_breakdown,
        total_deductions,
        labor_ins_employer, health_ins_employer, labor_pension_employer,
        net_salary, hours_worked
      ) VALUES (
        v_run_id, rec.employee_id, p_pay_period,
        v_base, v_role_allow, v_meal, v_transport,
        v_attendance_bonus, v_ot_pay, v_ot_hours_wd, v_ot_hours_hd,
        v_custom_total, v_custom_breakdown,
        v_gross, v_income_tax,
        v_leave_deduction, v_leave_days, v_late_deduction, v_late_mins,
        v_labor_emp, v_health_emp, v_pension_emp,
        v_nhi_supp, v_nhi_breakdown,
        v_unused_leave_payout, v_unused_leave_days, v_is_final_settlement,
        v_legal_total, v_legal_breakdown,
        v_total_deductions,
        v_labor_er, v_health_er, v_pension_er,
        v_net, v_hours_worked
      ) RETURNING id INTO v_record_id;

      IF v_nhi_supp > 0 THEN
        INSERT INTO nhi_supplementary_records (
          payroll_record_id, employee_id, pay_period, organization_id,
          income_category, income_amount, exempt_amount, taxable_amount, rate, premium_amount
        )
        SELECT v_record_id, rec.employee_id, p_pay_period, rec.organization_id,
          (item->>'category'), (item->>'income')::numeric,
          COALESCE((item->>'exempt')::numeric, 0), (item->>'taxable')::numeric,
          (item->>'rate')::numeric, (item->>'premium')::numeric
        FROM jsonb_array_elements(v_nhi_breakdown) AS item
        WHERE (item->>'premium')::numeric > 0;
      END IF;

      v_count := v_count + 1;
    END;
  END LOOP;

  payroll_run_id := v_run_id;
  records_created := v_count;
  RETURN NEXT;
END;
$function$;

COMMIT;
