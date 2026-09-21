-- generate_payroll 補寫加班費 per-category 細分欄(薪條完整)
-- 2026-07-09  入帳原本只寫 overtime_pay 總額,per-category(平日/休息日/例假/國定)全 0 → 薪條細分空。
--   補寫 overtime_pay_weekday/restday/holiday(例假)/national(國定) + ot_hours_restday/national。
--   對映:otPayWeekday→平日、otPayRestday→休息日、otPayWeeklyOff→例假(holiday欄)、otPayHoliday→國定(national欄)。
--   dump live + 錨點插入,CREATE OR REPLACE 全覆蓋。idempotent。

CREATE OR REPLACE FUNCTION public.generate_payroll(p_pay_period character, p_created_by integer DEFAULT NULL::integer)
 RETURNS TABLE(payroll_run_id integer, records_created integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_run_id      INT;
  v_count       INT := 0;
  v_year        INT;
  v_month       INT;
  v_month_end   DATE;
  rec           RECORD;
BEGIN
  v_year      := SPLIT_PART(p_pay_period, '-', 1)::INT;
  v_month     := SPLIT_PART(p_pay_period, '-', 2)::INT;
  v_month_end := (MAKE_DATE(v_year, v_month, 1) + INTERVAL '1 month - 1 day')::DATE;

  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (p_pay_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  FOR rec IN
    SELECT e.id AS employee_id, e.organization_id,
           COALESCE(ss.base_salary, 0) AS base_salary,
           (ss.id IS NULL) AS no_salary_structure
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE (e.in_payroll IS NOT FALSE)
      AND (e.join_date IS NULL OR e.join_date <= v_month_end)
      AND (
        e.status = '在職'
        OR (e.status = '離職' AND e.resign_date IS NOT NULL
            AND e.resign_date >= MAKE_DATE(v_year, v_month, 1)
            AND e.resign_date <= v_month_end)
      )
  LOOP
    DECLARE
      v_j            jsonb;
      v_gross        numeric;
      v_eng_legal    numeric;
      v_eng_total    numeric;
      v_eng_net      numeric;
      -- 法扣(保留餘額感知副作用)
      v_legal_total     numeric := 0;
      v_legal_breakdown jsonb   := '[]'::jsonb;
      v_legal_avail     numeric;
      v_legal_rec       RECORD;
      v_legal_remaining numeric;
      v_legal_to_deduct numeric;
      -- 年終獎金累計(annual_bonus_tracker 副作用)
      v_bonus_this   numeric;
      v_nhi_thresh   numeric;
      v_thresh_4x    numeric;
      v_prev_cumul   numeric;
      v_new_cumul    numeric;
      -- 最終
      v_total_ded    numeric;
      v_net          numeric;
      v_record_id    INT;
    BEGIN
      IF rec.no_salary_structure AND rec.base_salary = 0 THEN
        CONTINUE;
      END IF;

      -- ★ 算數字:全部交給引擎(與 preview 同一顆)
      v_j := public._compute_payroll_for_employee(rec.employee_id, p_pay_period);
      IF v_j IS NULL THEN CONTINUE; END IF;

      v_gross     := (v_j->>'gross')::numeric;
      v_eng_legal := (v_j->>'legal_deduction')::numeric;
      v_eng_total := (v_j->>'totalDeductions')::numeric;
      v_eng_net   := (v_j->>'netSalary')::numeric;

      -- ── 副作用 1:法扣餘額感知扣帳(引擎唯讀做不到)──
      --   可扣上限 = 法扣前可支配所得 = 引擎淨額 + 引擎(預估)法扣
      v_legal_avail := GREATEST(v_eng_net + v_eng_legal, 0);
      FOR v_legal_rec IN
        SELECT id, title, monthly_amount, total_amount, paid_amount, paid_months
        FROM legal_deductions
        WHERE employee_id = rec.employee_id AND status = '進行中'
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
                 status      = CASE WHEN (paid_amount + v_legal_to_deduct) >= total_amount THEN '已完成' ELSE status END,
                 updated_at  = NOW()
           WHERE id = v_legal_rec.id;
          v_legal_total := v_legal_total + v_legal_to_deduct;
          v_legal_avail := v_legal_avail - v_legal_to_deduct;
        END IF;

        v_legal_breakdown := v_legal_breakdown || jsonb_build_object(
          'id', v_legal_rec.id, 'title', v_legal_rec.title,
          'monthly_amount', v_legal_rec.monthly_amount, 'amount', v_legal_to_deduct,
          'shortfall', v_legal_rec.monthly_amount - v_legal_to_deduct);

        EXIT WHEN v_legal_avail <= 0;
      END LOOP;

      -- ── 副作用 2:年終獎金累計(引擎唯讀讀此表算二代健保,由此處負責寫入)──
      v_bonus_this := (v_j->>'attendance_bonus')::numeric;
      v_nhi_thresh := COALESCE((v_j->>'insuredHealth')::numeric, 0);
      IF v_nhi_thresh > 0 AND v_bonus_this > 0 THEN
        v_thresh_4x := v_nhi_thresh * 4;
        SELECT cumulative_bonus INTO v_prev_cumul
          FROM annual_bonus_tracker WHERE employee_id = rec.employee_id AND year = v_year;
        v_prev_cumul := COALESCE(v_prev_cumul, 0);
        v_new_cumul  := v_prev_cumul + v_bonus_this;
        INSERT INTO annual_bonus_tracker (
          employee_id, year, organization_id, cumulative_bonus, insured_salary, threshold, exceeded_at
        ) VALUES (
          rec.employee_id, v_year, rec.organization_id, v_new_cumul, v_nhi_thresh, v_thresh_4x,
          CASE WHEN v_new_cumul > v_thresh_4x THEN NOW() ELSE NULL END
        )
        ON CONFLICT (employee_id, year) DO UPDATE SET
          cumulative_bonus = EXCLUDED.cumulative_bonus,
          insured_salary   = EXCLUDED.insured_salary,
          threshold        = EXCLUDED.threshold,
          exceeded_at      = COALESCE(annual_bonus_tracker.exceeded_at, EXCLUDED.exceeded_at),
          updated_at       = NOW();
      END IF;

      -- ── total/net:引擎值換掉法扣(引擎預估→generate 實扣);法扣相同時 = 引擎值 ──
      v_total_ded := v_eng_total - v_eng_legal + v_legal_total;
      v_net       := v_eng_net   + v_eng_legal - v_legal_total;

      -- ── INSERT payroll_records:34 欄讀引擎 + 法扣/total/net 用上面換算 ──
      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        base_salary, role_allowance, meal_allowance, transport_allowance,
        attendance_bonus_earned, overtime_pay, ot_hours_weekday, ot_hours_holiday,
    overtime_pay_weekday, overtime_pay_restday, overtime_pay_holiday, overtime_pay_national, ot_hours_restday, ot_hours_national,
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
        net_salary, hours_worked,
        prorate_ratio, actual_work_days
      ) VALUES (
        v_run_id, rec.employee_id, p_pay_period,
        (v_j->>'base_salary')::numeric, (v_j->>'role_allowance')::numeric,
        (v_j->>'meal_allowance')::numeric, (v_j->>'transport_allowance')::numeric,
        (v_j->>'attendance_bonus')::numeric, (v_j->>'overtimePay')::numeric,
        (v_j->>'otWeekday')::numeric,
        (v_j->>'otHoliday')::numeric + (v_j->>'otRestday')::numeric + (v_j->>'otWeeklyOff')::numeric,
    (v_j->>'otPayWeekday')::numeric, (v_j->>'otPayRestday')::numeric, (v_j->>'otPayWeeklyOff')::numeric, (v_j->>'otPayHoliday')::numeric, (v_j->>'otRestday')::numeric, (v_j->>'otHoliday')::numeric,
        (v_j->>'custom_allowances_total')::numeric, COALESCE(v_j->'custom_allowances','[]'::jsonb),
        v_gross,
        (v_j->>'incomeTax')::numeric,
        (v_j->>'absenceDeduction')::numeric, (v_j->>'absenceDays')::numeric,
        (v_j->>'lateDeduction')::numeric, (v_j->>'lateMins')::int,
        (v_j->>'laborInsurance')::numeric, (v_j->>'healthInsurance')::numeric, (v_j->>'pension')::numeric,
        (v_j->>'nhi_supplementary')::numeric, COALESCE(v_j->'nhi_supplementary_breakdown','[]'::jsonb),
        (v_j->>'unused_leave_payout')::numeric, (v_j->>'unused_leave_days')::numeric,
        (v_j->>'is_final_settlement')::boolean,
        v_legal_total, v_legal_breakdown,
        v_total_ded,
        (v_j->>'laborEmployer')::numeric, (v_j->>'healthEmployer')::numeric, (v_j->>'pensionEmployer')::numeric,
        v_net, (v_j->>'workHours')::numeric,
        (v_j->>'proration_ratio')::numeric, round((v_j->>'salary_actual_wd')::numeric)::int
      ) RETURNING id INTO v_record_id;

      -- ── 副作用 3:二代健保補充保費明細(引擎算好 breakdown,這裡寫檔)──
      IF (v_j->>'nhi_supplementary')::numeric > 0 THEN
        INSERT INTO nhi_supplementary_records (
          payroll_record_id, employee_id, pay_period, organization_id,
          income_category, income_amount, exempt_amount, taxable_amount, rate, premium_amount
        )
        SELECT
          v_record_id, rec.employee_id, p_pay_period, rec.organization_id,
          (item->>'category'), (item->>'income')::numeric,
          COALESCE((item->>'exempt')::numeric, 0), (item->>'taxable')::numeric,
          (item->>'rate')::numeric, (item->>'premium')::numeric
        FROM jsonb_array_elements(COALESCE(v_j->'nhi_supplementary_breakdown','[]'::jsonb)) AS item
        WHERE (item->>'premium')::numeric > 0;
      END IF;

      v_count := v_count + 1;
    END;
  END LOOP;

  payroll_run_id  := v_run_id;
  records_created := v_count;
  RETURN NEXT;
END $function$;

NOTIFY pgrst, 'reload schema';
