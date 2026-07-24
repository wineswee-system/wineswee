-- 入帳/年終 加租戶(org)過濾 — 2026-07-24
-- ════════════════════════════════════════════════════════════════════════════
-- 續 20260724100000(打卡報表 org 掃描)。發現同類洞:
--   generate_payroll(入帳) 與 generate_year_end_bonus(年終) 選員工「無 org 過濾」→
--   會把 Demo(org2)員工也計進同一批薪資/年終。而其試算版 preview_payroll 有框(p_org),
--   造成「試算只顯示威耀、入帳卻跨租戶」的不一致(且剛加的資遣金也會跨租戶)。
-- 修:兩支選員工 WHERE 加 e.organization_id = current_employee_org()
--   (兩支皆僅前端登入 admin 呼叫、無 cron → auth 解得出租戶;對齊 preview_payroll)。
-- dump live(含資遣金變更)+ script 插一行 + diff 核對,其餘逐字一致。
-- ════════════════════════════════════════════════════════════════════════════

-- 1) 入帳
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
      AND e.organization_id = current_employee_org()
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
        severance_amount, notice_wage, severance_total, severance_record_id,
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
        (v_j->>'severance_amount')::numeric, (v_j->>'severance_notice_wage')::numeric,
        (v_j->>'severance_total')::numeric, NULLIF((v_j->>'severance_record_id'),'')::int,
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

-- 2) 年終
CREATE OR REPLACE FUNCTION public.generate_year_end_bonus(p_year integer, p_months_override numeric DEFAULT NULL::numeric, p_created_by integer DEFAULT NULL::integer)
 RETURNS TABLE(payroll_run_id integer, records_created integer, total_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_run_id   INT;
  v_count    INT := 0;
  v_total    NUMERIC(14,2) := 0;
  v_period   CHAR(7);
  rec        RECORD;
BEGIN
  v_period := p_year::TEXT || '-13';  -- 用 -13 表年終獎金

  -- 防呆：同年度不要重複跑
  IF EXISTS (SELECT 1 FROM payroll_runs WHERE pay_period = v_period) THEN
    RAISE EXCEPTION '年度 % 已有年終獎金結算紀錄，如需重跑請先刪除。', p_year;
  END IF;

  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (v_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  FOR rec IN
    SELECT
      e.id                                        AS employee_id,
      e.name,
      e.organization_id,
      COALESCE(ss.base_salary,         0)         AS base_salary,
      COALESCE(p_months_override,
               ss.year_end_bonus_months, 0)       AS bonus_months,
      e.health_ins_grade
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.organization_id = current_employee_org()
      AND (e.status = '在職'
        OR (e.status = '離職' AND EXTRACT(YEAR FROM e.resign_date) = p_year))
  LOOP
    DECLARE
      v_bonus_amount    NUMERIC(12,2);
      v_income_tax      NUMERIC(10,2) := 0;
      v_nhi_supp        NUMERIC(10,2) := 0;
      v_nhi_breakdown   JSONB         := '[]'::jsonb;
      v_insured_salary  NUMERIC(10,2) := 0;
      v_threshold_4x    NUMERIC(12,2) := 0;
      v_prev_cumul      NUMERIC(12,2) := 0;
      v_new_cumul       NUMERIC(12,2);
      v_taxable         NUMERIC(12,2) := 0;
      v_premium         NUMERIC(10,2) := 0;
      v_record_id       INT;
      v_total_deductions NUMERIC(10,2);
      v_net             NUMERIC(10,2);
    BEGIN
      v_bonus_amount := ROUND(rec.base_salary * rec.bonus_months);

      IF v_bonus_amount <= 0 THEN CONTINUE; END IF;

      -- 二代健保：年度累計超 4 倍
      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT insured_salary INTO v_insured_salary
        FROM health_ins_brackets
        WHERE year = p_year AND grade = rec.health_ins_grade;

        IF v_insured_salary IS NOT NULL AND v_insured_salary > 0 THEN
          v_threshold_4x := v_insured_salary * 4;

          SELECT cumulative_bonus INTO v_prev_cumul
            FROM annual_bonus_tracker
           WHERE employee_id = rec.employee_id AND year = p_year;
          v_prev_cumul := COALESCE(v_prev_cumul, 0);
          v_new_cumul  := v_prev_cumul + v_bonus_amount;

          IF v_new_cumul > v_threshold_4x AND v_prev_cumul < v_threshold_4x THEN
            v_taxable := v_new_cumul - v_threshold_4x;
          ELSIF v_prev_cumul >= v_threshold_4x THEN
            v_taxable := v_bonus_amount;
          END IF;

          IF v_taxable > 0 THEN
            v_premium := ROUND(v_taxable * 0.0211);
            v_nhi_supp := v_premium;
            v_nhi_breakdown := jsonb_build_array(jsonb_build_object(
              'category', '年終獎金累計',
              'income', v_bonus_amount,
              'cumulative', v_new_cumul,
              'threshold_4x', v_threshold_4x,
              'taxable', v_taxable,
              'rate', 0.0211,
              'premium', v_premium
            ));
          END IF;

          INSERT INTO annual_bonus_tracker (
            employee_id, year, organization_id,
            cumulative_bonus, insured_salary, threshold,
            exceeded_at
          ) VALUES (
            rec.employee_id, p_year, rec.organization_id,
            v_new_cumul, v_insured_salary, v_threshold_4x,
            CASE WHEN v_new_cumul > v_threshold_4x THEN NOW() ELSE NULL END
          )
          ON CONFLICT (employee_id, year) DO UPDATE SET
            cumulative_bonus = EXCLUDED.cumulative_bonus,
            insured_salary   = EXCLUDED.insured_salary,
            threshold        = EXCLUDED.threshold,
            exceeded_at      = COALESCE(annual_bonus_tracker.exceeded_at, EXCLUDED.exceeded_at),
            updated_at       = NOW();
        END IF;
      END IF;

      -- 所得稅扣繳（依年終獎金級距）
      v_income_tax := public._calc_monthly_withholding(v_bonus_amount);

      v_total_deductions := v_income_tax + v_nhi_supp;
      v_net := v_bonus_amount - v_total_deductions;

      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        year_end_bonus, gross_salary,
        income_tax_withheld,
        nhi_supplementary, nhi_supplementary_breakdown,
        total_deductions, net_salary,
        is_final_settlement
      ) VALUES (
        v_run_id, rec.employee_id, v_period,
        v_bonus_amount, v_bonus_amount,
        v_income_tax,
        v_nhi_supp, v_nhi_breakdown,
        v_total_deductions, v_net,
        false
      ) RETURNING id INTO v_record_id;

      IF v_nhi_supp > 0 THEN
        INSERT INTO nhi_supplementary_records (
          payroll_record_id, employee_id, pay_period, organization_id,
          income_category, income_amount, exempt_amount, taxable_amount,
          rate, premium_amount
        ) VALUES (
          v_record_id, rec.employee_id, v_period, rec.organization_id,
          '高額獎金', v_bonus_amount, v_bonus_amount - v_taxable, v_taxable,
          0.0211, v_premium
        );
      END IF;

      v_count := v_count + 1;
      v_total := v_total + v_bonus_amount;
    END;
  END LOOP;

  payroll_run_id  := v_run_id;
  records_created := v_count;
  total_amount    := v_total;
  RETURN NEXT;
END;
$function$;

NOTIFY pgrst, 'reload schema';
