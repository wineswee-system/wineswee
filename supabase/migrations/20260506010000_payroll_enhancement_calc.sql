-- =============================================
-- 薪資系統 補強 Phase 2 — 重寫 generate_payroll
--
-- 新增邏輯：
--   1. 二代健保補充保費（單筆獎金/加班費高於月投保金額時扣 2.11%）
--   2. 離職員工最後一個月：未休完特休折現補錢
--   3. 勞退員工自願自提（從 employees.labor_pension_self_rate 抓）
--
-- 保留原有：底薪/加給/加班費/全薪半薪假/遲到/勞健保/所得稅/法扣
-- =============================================

BEGIN;

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

  -- 對「在職」+「當月離職」員工結算
  FOR rec IN
    SELECT
      e.id                                        AS employee_id,
      e.name,
      e.status,
      e.resign_date,
      e.organization_id,
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
      COALESCE(e.labor_pension_self_rate, 0)      AS pension_self_rate,
      (ss.id IS NULL)                             AS no_salary_structure
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.status = '在職'
       OR (e.status = '離職'
           AND e.resign_date IS NOT NULL
           AND e.resign_date >= v_month_start
           AND e.resign_date <= v_month_end)
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
      v_unpaid_days     NUMERIC(4,1)  := 0;
      v_half_days       NUMERIC(4,1)  := 0;
      v_late_deduction  NUMERIC(10,2) := 0;
      v_late_mins       INT           := 0;

      v_labor_emp  NUMERIC(10,2) := 0;
      v_labor_er   NUMERIC(10,2) := 0;
      v_health_emp NUMERIC(10,2) := 0;
      v_health_er  NUMERIC(10,2) := 0;
      v_pension_emp NUMERIC(10,2) := 0;
      v_pension_er  NUMERIC(10,2) := 0;

      -- 二代健保補充保費
      v_nhi_supp        NUMERIC(10,2) := 0;
      v_nhi_breakdown   JSONB         := '[]'::jsonb;
      v_insured_salary  NUMERIC(10,2) := 0;
      v_nhi_threshold   NUMERIC(12,2) := 0;

      -- 離職結算
      v_unused_leave_days   NUMERIC(5,1) := 0;
      v_unused_leave_payout NUMERIC(10,2) := 0;
      v_is_final_settlement BOOLEAN := false;

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
      v_record_id INT;
    BEGIN
      IF rec.no_salary_structure AND rec.base_salary = 0 THEN
        RAISE NOTICE 'Employee % (%) has no salary structure, skipping', rec.employee_id, rec.name;
        CONTINUE;
      END IF;

      v_is_final_settlement := (rec.status = '離職');

      -- ── Hours worked ──
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

      -- ── Overtime ──
      SELECT
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM request_date) NOT IN (0,6) THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM request_date) IN (0,6)     THEN ot_hours ELSE 0 END), 0)
      INTO v_ot_hours_wd, v_ot_hours_hd
      FROM overtime_requests
      WHERE employee_id = rec.employee_id
        AND request_date >= v_month_start AND request_date <= v_month_end
        AND status = '已核准'
        AND (ot_type IS NULL OR ot_type = 'pay');

      v_ot_pay_wd := CASE
        WHEN v_ot_hours_wd <= 2 THEN ROUND(v_ot_hours_wd * v_hourly_rate * 1.34)
        ELSE ROUND(2 * v_hourly_rate * 1.34 + (v_ot_hours_wd - 2) * v_hourly_rate * 1.67)
      END;

      v_rd1 := LEAST(v_ot_hours_hd, 2);
      v_rd2 := LEAST(GREATEST(v_ot_hours_hd - 2, 0), 6);
      v_rd3 := GREATEST(v_ot_hours_hd - 8, 0);
      v_ot_pay_hd := ROUND(v_rd1 * v_hourly_rate * 1.34
                         + v_rd2 * v_hourly_rate * 1.67
                         + v_rd3 * v_hourly_rate * 2.67);

      v_ot_pay := v_ot_pay_wd + v_ot_pay_hd;

      -- ── Leave deduction ──
      SELECT COALESCE(SUM(
        LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1
      ), 0) INTO v_unpaid_days
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准'
        AND leave_type IN ('事假', '事', 'personal', '無薪假', 'unpaid');

      SELECT COALESCE(SUM(
        LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1
      ), 0) INTO v_half_days
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准'
        AND leave_type IN ('病假', '病', 'sick', '生理假', '生', 'menstrual');

      v_leave_days := v_unpaid_days + v_half_days;

      IF rec.salary_type = 'monthly' THEN
        v_leave_deduction := (v_unpaid_days * v_daily_rate)
                           + (v_half_days   * v_daily_rate * 0.5);
      END IF;

      -- Late
      SELECT COALESCE(SUM(late_minutes), 0) INTO v_late_mins
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end
        AND is_late = true;

      v_late_deduction := FLOOR(v_late_mins / 30.0) * (v_hourly_rate * 0.5);

      IF v_late_mins > 0 OR v_leave_days > 0 THEN
        v_attendance_bonus := 0;
      END IF;

      -- ── 離職結算：未休完特休折現 ──
      IF v_is_final_settlement THEN
        SELECT COALESCE(SUM(GREATEST(total_days + carry_over_days - used_days, 0)), 0)
          INTO v_unused_leave_days
        FROM leave_balances
        WHERE employee_id = rec.employee_id
          AND year = v_year
          AND leave_type IN ('特休', 'annual', '特別休假');

        IF rec.salary_type = 'monthly' THEN
          v_unused_leave_payout := ROUND(v_unused_leave_days * (rec.base_salary / v_work_days));
        ELSE
          v_unused_leave_payout := ROUND(v_unused_leave_days * v_hourly_rate * 8);
        END IF;
      END IF;

      -- ── Gross（含未休假折現 + 全部都算）──
      v_gross := v_base + v_role_allow + v_meal + v_transport
               + v_attendance_bonus + v_ot_pay + v_custom_total
               + v_unused_leave_payout;

      -- ── 二代健保補充保費（員工自付 2.11%）──
      -- 健保署規定：單筆獎金 / 加班費 / 兼職等所得超過月投保金額時扣
      -- 月投保金額 = health_ins_brackets.insured_salary
      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT insured_salary INTO v_insured_salary
        FROM health_ins_brackets
        WHERE year = v_year AND grade = rec.health_ins_grade;

        v_nhi_threshold := COALESCE(v_insured_salary, 0);

        -- (a) 加班費：每月固定併計，超過月投保金額部分扣
        IF v_ot_pay > v_nhi_threshold AND v_nhi_threshold > 0 THEN
          DECLARE
            v_ot_excess NUMERIC(12,2) := v_ot_pay - v_nhi_threshold;
            v_ot_premium NUMERIC(10,2) := ROUND(v_ot_excess * 0.0211);
          BEGIN
            v_nhi_supp := v_nhi_supp + v_ot_premium;
            v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
              'category', '加班費超額',
              'income', v_ot_pay,
              'exempt', v_nhi_threshold,
              'taxable', v_ot_excess,
              'rate', 0.0211,
              'premium', v_ot_premium
            );
          END;
        END IF;

        -- (b) 高額獎金：年度累計超 4 倍級距時扣
        IF v_nhi_threshold > 0 THEN
          DECLARE
            v_bonus_this_month NUMERIC(12,2) := 0;
            v_threshold_4x NUMERIC(12,2) := v_nhi_threshold * 4;
            v_track_rec RECORD;
            v_prev_cumul NUMERIC(12,2) := 0;
            v_new_cumul NUMERIC(12,2);
            v_taxable_this_month NUMERIC(12,2) := 0;
            v_bonus_premium NUMERIC(10,2);
          BEGIN
            -- 抓 payroll_records.year_end_bonus + other_bonus 已寫入的（這裡先設 0，generate_year_end_bonus 函式會處理）
            -- 本月度的「待扣獎金」現在不從 generate_payroll 觸發（年終獎金獨立 function 處理）
            -- 但若該月有 attendance_bonus（小額全勤）也應該入 tracker — 通常不大，先納入
            v_bonus_this_month := v_attendance_bonus;

            IF v_bonus_this_month > 0 THEN
              SELECT cumulative_bonus INTO v_prev_cumul
                FROM annual_bonus_tracker
               WHERE employee_id = rec.employee_id AND year = v_year;
              v_prev_cumul := COALESCE(v_prev_cumul, 0);
              v_new_cumul := v_prev_cumul + v_bonus_this_month;

              -- 計算超出 4 倍門檻的部分
              IF v_new_cumul > v_threshold_4x AND v_prev_cumul < v_threshold_4x THEN
                v_taxable_this_month := v_new_cumul - v_threshold_4x;
              ELSIF v_prev_cumul >= v_threshold_4x THEN
                v_taxable_this_month := v_bonus_this_month;
              END IF;

              IF v_taxable_this_month > 0 THEN
                v_bonus_premium := ROUND(v_taxable_this_month * 0.0211);
                v_nhi_supp := v_nhi_supp + v_bonus_premium;
                v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
                  'category', '高額獎金累計',
                  'income', v_bonus_this_month,
                  'cumulative', v_new_cumul,
                  'threshold_4x', v_threshold_4x,
                  'taxable', v_taxable_this_month,
                  'rate', 0.0211,
                  'premium', v_bonus_premium
                );
              END IF;

              -- 更新 tracker（即使 0 元）
              INSERT INTO annual_bonus_tracker (
                employee_id, year, organization_id,
                cumulative_bonus, insured_salary, threshold,
                exceeded_at
              ) VALUES (
                rec.employee_id, v_year, rec.organization_id,
                v_new_cumul, v_nhi_threshold, v_threshold_4x,
                CASE WHEN v_new_cumul > v_threshold_4x THEN NOW() ELSE NULL END
              )
              ON CONFLICT (employee_id, year) DO UPDATE SET
                cumulative_bonus = EXCLUDED.cumulative_bonus,
                insured_salary   = EXCLUDED.insured_salary,
                threshold        = EXCLUDED.threshold,
                exceeded_at      = COALESCE(annual_bonus_tracker.exceeded_at, EXCLUDED.exceeded_at),
                updated_at       = NOW();
            END IF;
          END;
        END IF;
      END IF;

      -- ── Income tax ──
      v_income_tax := public._calc_monthly_withholding(v_gross);

      -- ── Insurance ──
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

      -- ── 勞退（雇主 6%、員工自願自提 0~6%）──
      v_pension_er  := ROUND(LEAST(v_base, 150000) * 0.06);
      v_pension_emp := ROUND(LEAST(v_base, 150000) * (rec.pension_self_rate / 100.0));

      -- ── Total deductions (before legal) ──
      v_total_deductions := v_leave_deduction + v_late_deduction
                          + v_labor_emp + v_health_emp + v_pension_emp
                          + v_income_tax + v_nhi_supp;

      v_net_before_legal := v_gross - v_total_deductions;
      v_legal_avail      := GREATEST(v_net_before_legal, 0);

      -- ── Legal deductions ──
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

      -- ── Insert payroll_record ──
      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        base_salary, role_allowance, meal_allowance, transport_allowance,
        attendance_bonus_earned, overtime_pay, ot_hours_weekday, ot_hours_holiday,
        custom_allowances_total, custom_allowances_breakdown,
        gross_salary,
        income_tax_withheld,
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
        v_gross,
        v_income_tax,
        v_leave_deduction, v_leave_days, v_late_deduction, v_late_mins,
        v_labor_emp, v_health_emp, v_pension_emp,
        v_nhi_supp, v_nhi_breakdown,
        v_unused_leave_payout, v_unused_leave_days, v_is_final_settlement,
        v_legal_total, v_legal_breakdown,
        v_total_deductions,
        v_labor_er, v_health_er, v_pension_er,
        v_net, v_hours_worked
      ) RETURNING id INTO v_record_id;

      -- ── 寫 nhi_supplementary_records 明細（給申報用）──
      IF v_nhi_supp > 0 THEN
        INSERT INTO nhi_supplementary_records (
          payroll_record_id, employee_id, pay_period, organization_id,
          income_category, income_amount, exempt_amount, taxable_amount,
          rate, premium_amount
        )
        SELECT
          v_record_id, rec.employee_id, p_pay_period, rec.organization_id,
          (item->>'category'),
          (item->>'income')::numeric,
          COALESCE((item->>'exempt')::numeric, 0),
          (item->>'taxable')::numeric,
          (item->>'rate')::numeric,
          (item->>'premium')::numeric
        FROM jsonb_array_elements(v_nhi_breakdown) AS item
        WHERE (item->>'premium')::numeric > 0;
      END IF;

      v_count := v_count + 1;
    END;
  END LOOP;

  payroll_run_id  := v_run_id;
  records_created := v_count;
  RETURN NEXT;
END;
$function$;

COMMIT;
